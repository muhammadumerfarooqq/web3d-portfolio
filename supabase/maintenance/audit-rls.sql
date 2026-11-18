-- P11 · READ-ONLY audit of the database lockdown. Paste into the Supabase SQL editor (Run). Nothing here
-- changes anything. `npm run rls:verify` proves the same thing from the outside with the anon key; this shows
-- the catalog behind it. Expected result under each query.

-- 1. Every table in public: RLS enabled AND forced.  Expected: every row true / true.
select c.relname as "table", c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
order by 1;

-- 2. Policies in public.  Expected: ZERO rows (RLS with no policy = nobody but the service role gets in).
select schemaname, tablename, policyname, roles, cmd from pg_policies where schemaname = 'public';

-- 3. Table privileges held by anon, authenticated or PUBLIC.  Expected: ZERO rows.
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC');

-- 4. Functions in public: who may execute them.  Expected: anon_can_execute and authenticated_can_execute false
--    for every function (after 0004_hardening.sql); search_path set on ours (proconfig contains search_path).
select p.proname as "function", p.prosecdef as security_definer, p.proconfig as settings,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by 1;

-- 5. Views in public (a view runs with its owner's rights unless security_invoker).  Expected: ZERO rows.
select table_name from information_schema.views where table_schema = 'public';

-- 6. Extensions installed in public (the Advisor warns about them; ours is in "extensions").  Expected: none.
select e.extname, n.nspname as schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace where n.nspname = 'public';

-- 7. Any column that could hold audio or files.  Expected: ZERO rows.
select table_name, column_name, data_type from information_schema.columns
where table_schema = 'public' and data_type in ('bytea', 'oid');

-- 8. Default privileges for new objects (after 0004_hardening.sql the postgres role grants none to anon/authenticated).
select defaclrole::regrole as owner, defaclobjtype as kind, defaclacl from pg_default_acl;
