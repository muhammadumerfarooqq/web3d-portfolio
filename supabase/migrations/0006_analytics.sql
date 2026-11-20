-- P10 · Privacy-friendly analytics. Paste into the Supabase SQL editor once, after 0005_admin.sql (idempotent).
--
-- analytics_daily holds ONE row per (day, event) with a counter. No IP, no hash, no user id, no user agent, no
-- referrer, no path, no timestamp finer than the day: nothing that could identify a visitor, by design.
-- analytics_bump(event, cap) increments atomically (INSERT ... ON CONFLICT DO UPDATE) and refuses to go past a
-- per-event daily sanity cap, so a bot posting in a loop cannot inflate a counter or grow the table (the table can
-- hold at most 9 rows a day).
-- Same hardening as 0002 to 0005: RLS ENABLED and FORCED with NO policies, no privileges for public / anon /
-- authenticated, service role only. The browser never talks to Supabase; it posts to /api/collect.

create table if not exists public.analytics_daily (
  day date not null,
  event text not null check (event in ('pageview_classic', 'pageview_explore', 'chat_open', 'chat_message', 'contact_submit_ok', 'voice_used', 'cv_download', 'lang_ur', 'a11y_menu_used')),
  count bigint not null default 0 check (count >= 0),
  primary key (day, event)
);

-- Returns true when the counter was incremented, false when the daily cap for that event was already reached.
create or replace function public.analytics_bump(p_event text, p_cap int default 5000) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_count bigint;
begin
  insert into public.analytics_daily as a (day, event, count)
  values (v_day, p_event, 1)
  on conflict (day, event) do update
    set count = a.count + 1
    where a.count < greatest(p_cap, 0)
  returning a.count into v_count;
  return v_count is not null;
end;
$$;

alter table public.analytics_daily enable row level security;
alter table public.analytics_daily force row level security;
-- No policies on purpose.

revoke all on table public.analytics_daily from public, anon, authenticated;
grant select, insert, update on table public.analytics_daily to service_role;

revoke all on function public.analytics_bump(text, int) from public, anon, authenticated;
grant execute on function public.analytics_bump(text, int) to service_role;
