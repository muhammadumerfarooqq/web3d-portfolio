-- P6 voice: rate limit for POST /api/transcribe (speech to text).
-- Run once in the Supabase SQL editor AFTER 0002_rag.sql (idempotent). Nothing else changes in the schema:
--   * chat_hits gets a `kind` column ('chat' | 'stt'); existing rows are 'chat'.
--   * stt_submit(): 10 transcriptions per rolling 10 minutes per ip_hash, and the SAME site-wide daily cap as
--     the chat (every accepted chat question and every accepted transcription counts as one hit).
--   * chat_submit() is redefined only so that its per-IP 20-in-10-minutes count looks at kind = 'chat'
--     (voice requests do not eat the chat quota); its daily count covers every kind.
-- Same locks, same lock-down as 0002: RLS stays forced with no policies, service role only.

alter table public.chat_hits add column if not exists kind text not null default 'chat';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chat_hits_kind_check') then
    alter table public.chat_hits add constraint chat_hits_kind_check check (kind in ('chat', 'stt'));
  end if;
end $$;
create index if not exists chat_hits_ip_kind_created_at on public.chat_hits (ip_hash, kind, created_at desc);

create or replace function public.chat_submit(p_ip_hash text, p_daily_cap int) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_recent int;
  v_oldest timestamptz;
  v_today int;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
begin
  perform pg_advisory_xact_lock(hashtextextended('chat_submit:global', 0));
  perform pg_advisory_xact_lock(hashtextextended('chat_submit:' || p_ip_hash, 0));

  delete from public.chat_hits where created_at < now() - interval '2 days';

  select count(*) into v_today from public.chat_hits where created_at >= v_day_start;
  if v_today >= greatest(p_daily_cap, 0) then
    return jsonb_build_object('allowed', false, 'reason', 'daily',
      'retry_after', greatest(1, ceil(extract(epoch from (v_day_start + interval '1 day' - now())))::int));
  end if;

  select count(*), min(created_at) into v_recent, v_oldest
    from public.chat_hits
    where ip_hash = p_ip_hash and kind = 'chat' and created_at > now() - interval '10 minutes';
  if v_recent >= 20 then
    return jsonb_build_object('allowed', false, 'reason', 'rate',
      'retry_after', greatest(1, ceil(extract(epoch from (v_oldest + interval '10 minutes' - now())))::int));
  end if;

  insert into public.chat_hits (ip_hash, kind) values (p_ip_hash, 'chat');
  return jsonb_build_object('allowed', true);
end;
$$;

-- Returns {"allowed": true} or {"allowed": false, "reason": "rate" | "daily", "retry_after": <seconds>}.
create or replace function public.stt_submit(p_ip_hash text, p_daily_cap int) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_recent int;
  v_oldest timestamptz;
  v_today int;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
begin
  -- same lock order as chat_submit (global, then this IP): no deadlock, no race past either limit
  perform pg_advisory_xact_lock(hashtextextended('chat_submit:global', 0));
  perform pg_advisory_xact_lock(hashtextextended('chat_submit:' || p_ip_hash, 0));

  delete from public.chat_hits where created_at < now() - interval '2 days';

  select count(*) into v_today from public.chat_hits where created_at >= v_day_start;
  if v_today >= greatest(p_daily_cap, 0) then
    return jsonb_build_object('allowed', false, 'reason', 'daily',
      'retry_after', greatest(1, ceil(extract(epoch from (v_day_start + interval '1 day' - now())))::int));
  end if;

  select count(*), min(created_at) into v_recent, v_oldest
    from public.chat_hits
    where ip_hash = p_ip_hash and kind = 'stt' and created_at > now() - interval '10 minutes';
  if v_recent >= 10 then
    return jsonb_build_object('allowed', false, 'reason', 'rate',
      'retry_after', greatest(1, ceil(extract(epoch from (v_oldest + interval '10 minutes' - now())))::int));
  end if;

  insert into public.chat_hits (ip_hash, kind) values (p_ip_hash, 'stt');
  return jsonb_build_object('allowed', true);
end;
$$;

revoke all on function public.chat_submit(text, int) from public, anon, authenticated;
grant execute on function public.chat_submit(text, int) to service_role;
revoke all on function public.stt_submit(text, int) from public, anon, authenticated;
grant execute on function public.stt_submit(text, int) to service_role;
