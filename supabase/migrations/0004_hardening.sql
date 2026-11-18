-- P11 · Database hardening. Paste into the Supabase SQL editor once, after 0003_voice.sql (idempotent).
--
-- Found by `npm run rls:verify` on 19-Nov-2026: the anon key could EXECUTE public.rls_auto_enable(), the helper
-- Supabase installs for "automatically enable RLS on new tables". Called directly it fails ("cannot display a
-- value of type event_trigger") and changes nothing, but it is still listed in the public API and the Security
-- Advisor flags functions that the anon / authenticated roles can execute. Nothing in this project calls it.
--
-- 1. Remove EXECUTE on it from PUBLIC, anon and authenticated. The event trigger that uses it keeps working:
--    PostgreSQL checks the EXECUTE privilege when an event trigger is CREATED, not each time it fires.
-- 2. Deny by default for FUTURE objects created by the postgres role in schema public: new functions, tables
--    and sequences get no privileges for anon / authenticated, so a table added later (P7 admin) is private
--    until a migration grants something on purpose. Existing objects are not touched.

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
