-- P7 · Admin dashboard. Paste into the Supabase SQL editor once, after 0004_hardening.sql (idempotent).
--
--   admins            the single admin: a row per Supabase Auth user that may use /admin (Umer inserts his own, see the
--                     SQL at the bottom of this file).
--   project_order     the saved order of the Classic project gallery ("Featured" sort), written by the admin API.
--   admin_login_hits  one row per login / MFA attempt, for the rate limit.
--   admin_login_submit(ip_hash, kind)   5 logins or 10 MFA codes per rolling 10 minutes per salted IP hash.
--   project_order_save(slugs)           replaces the saved order in one transaction.
--   contact_messages.status             the CHECK also allows 'reading' and 'archived' (the admin board's columns);
--                                       every existing value stays allowed, so no existing row is affected.
--
-- Same hardening as 0002 to 0004: RLS ENABLED and FORCED with NO policies, no privileges for public / anon /
-- authenticated, grants to service_role only (the server). The browser never talks to Supabase.

-- ── tables ──
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.project_order (
  slug text primary key check (slug ~ '^[a-z0-9-]{1,80}$'),
  position int not null check (position >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_login_hits (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('login', 'mfa'))
);
create index if not exists admin_login_hits_ip_kind_created_at on public.admin_login_hits (ip_hash, kind, created_at desc);

-- ── contact_messages.status: add the board's values without touching existing rows ──
do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.contact_messages'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%status%'
  loop
    execute format('alter table public.contact_messages drop constraint %I', c);
  end loop;
  alter table public.contact_messages
    add constraint contact_messages_status_check
    check (status in ('new', 'email_failed', 'read', 'reading', 'replied', 'archived', 'spam'));
end $$;

-- ── login rate limit ──
-- Returns {"allowed": true} or {"allowed": false, "retry_after": <seconds>}. Counts every attempt (successful or not),
-- under a per-IP advisory lock so two parallel attempts cannot both slip under the limit.
create or replace function public.admin_login_submit(p_ip_hash text, p_kind text) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_limit int := case when p_kind = 'mfa' then 10 else 5 end;
  v_recent int;
  v_oldest timestamptz;
begin
  if p_kind not in ('login', 'mfa') then
    raise exception 'bad kind';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('admin_login:' || p_kind || ':' || p_ip_hash, 0));

  delete from public.admin_login_hits where created_at < now() - interval '1 day';

  select count(*), min(created_at) into v_recent, v_oldest
    from public.admin_login_hits
    where ip_hash = p_ip_hash and kind = p_kind and created_at > now() - interval '10 minutes';
  if v_recent >= v_limit then
    return jsonb_build_object('allowed', false,
      'retry_after', greatest(1, ceil(extract(epoch from (v_oldest + interval '10 minutes' - now())))::int));
  end if;

  insert into public.admin_login_hits (ip_hash, kind) values (p_ip_hash, p_kind);
  return jsonb_build_object('allowed', true);
end;
$$;

-- ── saved project order: validate everything first, then replace in one transaction ──
create or replace function public.project_order_save(p_slugs text[]) returns int
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_slugs is null or cardinality(p_slugs) = 0 or cardinality(p_slugs) > 100 then
    raise exception 'bad order';
  end if;
  if exists (select 1 from unnest(p_slugs) s where s is null or s !~ '^[a-z0-9-]{1,80}$') then
    raise exception 'bad slug';
  end if;
  if (select count(distinct s) from unnest(p_slugs) s) <> cardinality(p_slugs) then
    raise exception 'duplicate slug';
  end if;
  delete from public.project_order;
  insert into public.project_order (slug, position)
    select s, (i - 1)::int from unnest(p_slugs) with ordinality as t(s, i);
  return cardinality(p_slugs);
end;
$$;

-- ── lock everything down: service role only ──
alter table public.admins enable row level security;
alter table public.admins force row level security;
alter table public.project_order enable row level security;
alter table public.project_order force row level security;
alter table public.admin_login_hits enable row level security;
alter table public.admin_login_hits force row level security;
-- No policies on purpose.

revoke all on table public.admins from public, anon, authenticated;
revoke all on table public.project_order from public, anon, authenticated;
revoke all on table public.admin_login_hits from public, anon, authenticated;
grant select on table public.admins to service_role;
grant select, insert, delete on table public.project_order to service_role;
grant select, insert, delete on table public.admin_login_hits to service_role;

revoke all on function public.admin_login_submit(text, text) from public, anon, authenticated;
grant execute on function public.admin_login_submit(text, text) to service_role;
revoke all on function public.project_order_save(text[]) from public, anon, authenticated;
grant execute on function public.project_order_save(text[]) to service_role;

-- ── AFTER you created the admin user in Authentication → Users (Add user, auto-confirm), run this ONCE with
--    your own email to make that user the admin (it inserts nothing if the email is not found):
--
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'YOUR-ADMIN-EMAIL@example.com'
--   on conflict do nothing;
--
--   select a.user_id, u.email from public.admins a join auth.users u on u.id = a.user_id;   -- check: exactly one row
