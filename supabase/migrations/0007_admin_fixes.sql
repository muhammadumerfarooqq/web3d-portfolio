-- P7 final fix · Paste into the Supabase SQL editor once, after 0006_analytics.sql (idempotent).
--
-- Found on 20-Nov-2026 by running every admin route against the REAL database: "Save order" failed with
-- PostgreSQL error 21000 "DELETE requires a WHERE clause". Supabase installs the pg_safeupdate extension for the
-- API roles; it refuses a DELETE (or UPDATE) without a WHERE clause, also inside a function the API calls.
-- project_order_save() in 0005_admin.sql replaced the saved order with a bare `delete from public.project_order`.
--
-- This migration redefines the function with a WHERE clause that matches every row (position >= 0 is a CHECK on the
-- table, so it is every row). Same validation, same transaction, same return value. 0005 is not edited: it was
-- already run in production, and `create or replace` is how a function is changed.
--
-- Everything else the admin routes use was exercised against the real database in the same run and needed no change
-- (admins, admin_login_hits, admin_login_submit, contact_messages, analytics_daily, analytics_bump).
--
-- Hardening is unchanged and re-stated: RLS enabled and forced, no policies, nothing for public / anon /
-- authenticated, service role only.

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
  -- WHERE is required by pg_safeupdate (code 21000); position >= 0 holds for every row (CHECK on the table).
  delete from public.project_order where position >= 0;
  insert into public.project_order (slug, position)
    select s, (i - 1)::int from unnest(p_slugs) with ordinality as t(s, i);
  return cardinality(p_slugs);
end;
$$;

-- re-state the lock-down (no change; a replaced function keeps its grants, this makes it explicit and idempotent)
alter table public.project_order enable row level security;
alter table public.project_order force row level security;

revoke all on table public.project_order from public, anon, authenticated;
grant select, insert, delete on table public.project_order to service_role;

revoke all on function public.project_order_save(text[]) from public, anon, authenticated;
grant execute on function public.project_order_save(text[]) to service_role;
