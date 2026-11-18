-- P4 · Contact system (Module 5). Paste into the Supabase SQL editor once (idempotent).
--
-- contact_messages holds every telegram sent through /api/contact. Row Level Security is ENABLED with
-- NO policies for anon or authenticated: the public anon key can neither read nor write this table.
-- Only the server (service role key, which bypasses RLS) touches it, through contact_submit() and one
-- status update. IPs are never stored: ip_hash = SHA-256(ip + IP_HASH_SALT), computed by the server.
--
-- Rate limit (5 per hour, 20 per day per hashed IP): the simplest correct option is to count this
-- table's own rows. No extra table, no cron clean-up, and it only counts messages that passed every
-- other check (so a bot failing Turnstile cannot burn a real visitor's quota). The count and the
-- insert run inside ONE function under a per-IP transaction advisory lock, so two parallel requests
-- cannot both see "4 sent" and both insert (no race).

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 2 and 80),
  email text not null check (char_length(email) between 3 and 120),
  subject text not null check (subject in ('General', 'Job / interview', 'Freelance project', 'Collaboration', 'Other')),
  message text not null check (char_length(message) between 20 and 4000),
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  user_agent text check (char_length(user_agent) <= 200),
  status text not null default 'new' check (status in ('new', 'email_failed', 'read', 'replied', 'spam'))
);

create index if not exists contact_messages_ip_hash_created_at on public.contact_messages (ip_hash, created_at desc);

alter table public.contact_messages enable row level security;
alter table public.contact_messages force row level security;
-- No policies on purpose. And no table privileges for the public roles either (belt and braces).
revoke all on table public.contact_messages from public, anon, authenticated;
grant select, insert, update on table public.contact_messages to service_role;

-- Rate limit + store, atomically. Returns {"allowed": true, "id": "<uuid>"} or
-- {"allowed": false, "retry_after": <seconds until the oldest message in the full window expires>}.
create or replace function public.contact_submit(
  p_ip_hash text,
  p_name text,
  p_email text,
  p_subject text,
  p_message text,
  p_user_agent text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_hour int;
  v_day int;
  v_oldest_hour timestamptz;
  v_oldest_day timestamptz;
  v_retry int := 0;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('contact_submit:' || p_ip_hash, 0));

  select count(*), min(created_at) into v_hour, v_oldest_hour
    from public.contact_messages
    where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
  select count(*), min(created_at) into v_day, v_oldest_day
    from public.contact_messages
    where ip_hash = p_ip_hash and created_at > now() - interval '1 day';

  if v_hour >= 5 then
    v_retry := greatest(v_retry, ceil(extract(epoch from (v_oldest_hour + interval '1 hour' - now())))::int);
  end if;
  if v_day >= 20 then
    v_retry := greatest(v_retry, ceil(extract(epoch from (v_oldest_day + interval '1 day' - now())))::int);
  end if;
  if v_hour >= 5 or v_day >= 20 then
    return jsonb_build_object('allowed', false, 'retry_after', greatest(v_retry, 1));
  end if;

  insert into public.contact_messages (name, email, subject, message, ip_hash, user_agent)
    values (p_name, p_email, p_subject, p_message, p_ip_hash, left(p_user_agent, 200))
    returning id into v_id;
  return jsonb_build_object('allowed', true, 'id', v_id);
end;
$$;

-- Only the server may call it (Supabase grants EXECUTE to public roles by default: take it back).
revoke all on function public.contact_submit(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.contact_submit(text, text, text, text, text, text) to service_role;
