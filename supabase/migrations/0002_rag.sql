-- P5 · RAG chatbot "Ask my AI" (Module 4). Paste into the Supabase SQL editor once (idempotent: safe to
-- re-run). Requires 0001_contact_messages.sql (it only shares conventions, not objects).
--
-- documents / chunks: the knowledge base built by scripts/rag/ingest.mjs from /content (Gemini
-- gemini-embedding-001, 768 dimensions, L2-normalised). match_chunks(): hybrid retrieval (vector top-k +
-- full-text top-k fused with Reciprocal Rank Fusion, k = 60). chat_logs: one PII-free row per question.
-- chat_hits + chat_submit(): rate limit (20 per 10 minutes per salted IP hash) and a global daily cap,
-- atomic under advisory locks (same pattern as contact_submit).
-- Every table has RLS ENABLED and FORCED with NO policies, and no privileges for public / anon /
-- authenticated: only the server (service role key) can read or write. Same for EXECUTE on the functions.

-- pgvector lives in the "extensions" schema (Supabase convention).
create extension if not exists vector with schema extensions;

-- ── knowledge base ──
create table if not exists public.documents (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  title text not null,
  anchor text not null check (anchor ~ '^[a-z0-9-]+$'),
  source_path text not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);

create table if not exists public.chunks (
  id bigint generated always as identity primary key,
  document_id bigint not null references public.documents (id) on delete cascade,
  ord int not null,
  heading text not null default '',
  content text not null,
  anchor text not null check (anchor ~ '^[a-z0-9-]+$'),
  token_estimate int not null,
  embedding extensions.vector(768),
  tsv tsvector generated always as (to_tsvector('english', coalesce(heading, '') || ' ' || content)) stored,
  content_hash text not null unique check (content_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists chunks_document_id on public.chunks (document_id);
create index if not exists chunks_embedding_hnsw on public.chunks using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists chunks_tsv_gin on public.chunks using gin (tsv);

-- Hybrid retrieval. similarity = cosine similarity (1 − cosine distance) of every returned chunk; the
-- API's relevance gate looks at the best one. Results below min_similarity are dropped.
create or replace function public.match_chunks(
  query_embedding extensions.vector(768),
  query_text text,
  match_count int default 6,
  min_similarity float default 0
) returns table (
  id bigint,
  heading text,
  content text,
  anchor text,
  title text,
  similarity float,
  rrf_score float
)
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  with vec as (
    select c.id, row_number() over (order by c.embedding <=> query_embedding) as rank
    from public.chunks c
    where c.embedding is not null
    order by c.embedding <=> query_embedding
    limit greatest(match_count, 1) * 4
  ),
  fts as (
    select c.id, row_number() over (order by ts_rank_cd(c.tsv, q) desc) as rank
    from public.chunks c, websearch_to_tsquery('english', coalesce(query_text, '')) q
    where c.tsv @@ q
    order by ts_rank_cd(c.tsv, q) desc
    limit greatest(match_count, 1) * 4
  ),
  fused as (
    select coalesce(v.id, f.id) as id,
           coalesce(1.0 / (60 + v.rank), 0) + coalesce(1.0 / (60 + f.rank), 0) as rrf_score
    from vec v
    full outer join fts f on f.id = v.id
  )
  select c.id, c.heading, c.content, c.anchor, d.title,
         (1 - (c.embedding <=> query_embedding))::float as similarity,
         fu.rrf_score::float as rrf_score
  from fused fu
  join public.chunks c on c.id = fu.id
  join public.documents d on d.id = c.document_id
  where c.embedding is not null
    and (1 - (c.embedding <=> query_embedding)) >= min_similarity
  order by fu.rrf_score desc, similarity desc
  limit greatest(match_count, 1);
$$;

-- ── chat logs (no raw IP; the question is truncated and kept for evaluation, see docs/security.md) ──
create table if not exists public.chat_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  lang text not null check (lang in ('en', 'ur', 'roman')),
  question text not null check (char_length(question) <= 500),
  answer_chars int not null default 0 check (answer_chars >= 0),
  source_slugs text[] not null default '{}',
  refused boolean not null default false,
  flagged boolean not null default false,
  provider text check (char_length(provider) <= 40),
  model text check (char_length(model) <= 120),
  latency_ms int check (latency_ms >= 0),
  user_agent text check (char_length(user_agent) <= 200)
);

create index if not exists chat_logs_created_at on public.chat_logs (created_at desc);

-- ── rate limit: one row per accepted question ──
create table if not exists public.chat_hits (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists chat_hits_ip_created_at on public.chat_hits (ip_hash, created_at desc);
create index if not exists chat_hits_created_at on public.chat_hits (created_at);

-- Returns {"allowed": true} or {"allowed": false, "reason": "rate" | "daily", "retry_after": <seconds>}.
-- 20 questions per rolling 10 minutes per ip_hash; p_daily_cap questions per UTC day for the whole site.
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
  -- global lock first (daily cap), then the per-IP lock (rate): no two requests race past either limit
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
    where ip_hash = p_ip_hash and created_at > now() - interval '10 minutes';
  if v_recent >= 20 then
    return jsonb_build_object('allowed', false, 'reason', 'rate',
      'retry_after', greatest(1, ceil(extract(epoch from (v_oldest + interval '10 minutes' - now())))::int));
  end if;

  insert into public.chat_hits (ip_hash) values (p_ip_hash);
  return jsonb_build_object('allowed', true);
end;
$$;

-- ── lock everything down: service role only ──
alter table public.documents enable row level security;
alter table public.documents force row level security;
alter table public.chunks enable row level security;
alter table public.chunks force row level security;
alter table public.chat_logs enable row level security;
alter table public.chat_logs force row level security;
alter table public.chat_hits enable row level security;
alter table public.chat_hits force row level security;
-- No policies on purpose.

revoke all on table public.documents from public, anon, authenticated;
revoke all on table public.chunks from public, anon, authenticated;
revoke all on table public.chat_logs from public, anon, authenticated;
revoke all on table public.chat_hits from public, anon, authenticated;
grant select, insert, update, delete on table public.documents to service_role;
grant select, insert, update, delete on table public.chunks to service_role;
grant select, insert on table public.chat_logs to service_role;
grant select, insert, delete on table public.chat_hits to service_role;

revoke all on function public.match_chunks(extensions.vector, text, int, float) from public, anon, authenticated;
grant execute on function public.match_chunks(extensions.vector, text, int, float) to service_role;
revoke all on function public.chat_submit(text, int) from public, anon, authenticated;
grant execute on function public.chat_submit(text, int) to service_role;
