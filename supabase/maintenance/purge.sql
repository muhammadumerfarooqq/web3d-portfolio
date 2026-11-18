-- P11 · Retention purge. NOT run automatically and not part of the migrations: copy it into the Supabase SQL
-- editor when you want to apply the retention periods in docs/security.md (§1d):
--   chat_logs         questions, answers' metadata, hashed IP: 90 days
--   contact_messages  telegrams from visitors (name, email, message): 365 days
-- chat_hits (the rate-limit rows) already deletes itself after 2 days inside chat_submit() / stt_submit().
-- Run section 1 first to see what would go, then section 2 to delete. Both are safe to repeat.

-- 1. DRY RUN: how many rows are older than the retention period.
select 'chat_logs' as "table", count(*) as rows_to_delete, min(created_at) as oldest from public.chat_logs where created_at < now() - interval '90 days'
union all
select 'contact_messages', count(*), min(created_at) from public.contact_messages where created_at < now() - interval '365 days';

-- 2. DELETE (uncomment, run once you have read the numbers above; answered messages you want to keep forever
--    should be exported first: Table editor -> contact_messages -> Export).
-- delete from public.chat_logs where created_at < now() - interval '90 days';
-- delete from public.contact_messages where created_at < now() - interval '365 days';
