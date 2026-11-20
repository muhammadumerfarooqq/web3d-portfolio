// P5 part A: the RAG migration (RLS, functions, indexes), the knowledge-base chunker (sources, anchors,
// sizes, overlap, PII guard), the Gemini embeddings client (key in a header, normalised vectors) and the
// portrait-cover fix (P6: cover-fit, top centre).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { assertChunksClean, buildKnowledgeBase, chunkDocument, MAX_TOKENS, PUBLIC_EMAIL, tail } from '../scripts/rag/chunk.mjs';
import { embedTexts, normalise, toPgVector } from '../api/_lib/embed.js';
import { buildSite } from './helpers/build-site.js';

const ROOT = join(import.meta.dirname, '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

describe('P5 migration 0002_rag.sql', () => {
  const sql = read('supabase/migrations/0002_rag.sql');
  const tables = ['documents', 'chunks', 'chat_logs', 'chat_hits'];

  it('pgvector in the extensions schema; 768-d embeddings; generated tsvector; HNSW (cosine) + GIN indexes', () => {
    expect(sql).toMatch(/create extension if not exists vector with schema extensions;/);
    expect(sql).toMatch(/embedding extensions\.vector\(768\)/);
    expect(sql).toMatch(/tsv tsvector generated always as \(to_tsvector\('english', coalesce\(heading, ''\) \|\| ' ' \|\| content\)\) stored/);
    expect(sql).toMatch(/using hnsw \(embedding extensions\.vector_cosine_ops\)/);
    expect(sql).toMatch(/using gin \(tsv\)/);
    expect(sql).toMatch(/content_hash text not null unique/);
    expect(sql).toMatch(/references public\.documents \(id\) on delete cascade/);
  });

  it('match_chunks: vector top-k + full-text top-k fused with RRF (k = 60), explicit search_path', () => {
    expect(sql).toMatch(/create or replace function public\.match_chunks\(\s*query_embedding extensions\.vector\(768\),\s*query_text text,\s*match_count int default 6,\s*min_similarity float default 0/);
    expect(sql).toMatch(/1\.0 \/ \(60 \+ v\.rank\)/);
    expect(sql).toMatch(/1\.0 \/ \(60 \+ f\.rank\)/);
    expect(sql).toMatch(/full outer join fts/);
    expect(sql).toMatch(/websearch_to_tsquery\('english'/);
    expect(sql).toMatch(/set search_path = public, extensions, pg_temp/);
    for (const col of ['id bigint', 'heading text', 'content text', 'anchor text', 'title text', 'similarity float', 'rrf_score float']) expect(sql).toContain(col);
  });

  it('chat_logs keeps no raw IP: hashed IP, question ≤ 500, user agent ≤ 200', () => {
    expect(sql).toMatch(/ip_hash text not null check \(ip_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    expect(sql).toMatch(/question text not null check \(char_length\(question\) <= 500\)/);
    expect(sql).toMatch(/user_agent text check \(char_length\(user_agent\) <= 200\)/);
    expect(sql).not.toMatch(/\bip\s+(?:text|inet)\b/);
  });

  it('chat_submit: 20 per 10 minutes per ip_hash + a global daily cap, atomic under advisory locks', () => {
    expect(sql).toMatch(/create or replace function public\.chat_submit\(p_ip_hash text, p_daily_cap int\) returns jsonb/);
    expect(sql).toMatch(/pg_advisory_xact_lock\(hashtextextended\('chat_submit:global', 0\)\)/);
    expect(sql).toMatch(/pg_advisory_xact_lock\(hashtextextended\('chat_submit:' \|\| p_ip_hash, 0\)\)/);
    expect(sql).toMatch(/v_recent >= 20/);
    expect(sql).toMatch(/interval '10 minutes'/);
    expect(sql).toMatch(/v_today >= greatest\(p_daily_cap, 0\)/);
    expect(sql).toMatch(/'reason', 'daily'/);
    expect(sql).toMatch(/'reason', 'rate'/);
  });

  it.each(tables)('%s: RLS enabled + forced, no policies, revoked from public/anon/authenticated, service role only', (t) => {
    expect(sql).toContain(`alter table public.${t} enable row level security;`);
    expect(sql).toContain(`alter table public.${t} force row level security;`);
    expect(sql).toContain(`revoke all on table public.${t} from public, anon, authenticated;`);
    expect(sql).toMatch(new RegExp(`grant [a-z, ]+ on table public\\.${t} to service_role;`));
    expect(sql).not.toMatch(/create\s+policy/i);
  });

  it('EXECUTE on match_chunks and chat_submit: revoked from public roles, granted to service_role', () => {
    for (const fn of ['match_chunks(extensions.vector, text, int, float)', 'chat_submit(text, int)']) {
      expect(sql).toContain(`revoke all on function public.${fn} from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${fn} to service_role;`);
    }
  });
});

describe('P5 knowledge base (scripts/rag/chunk.mjs)', () => {
  const kb = buildKnowledgeBase(ROOT);
  let html;
  beforeAll(async () => {
    ({ indexHtml: html } = await buildSite());
  }, 180_000);

  it('indexes the rendered content only: no README / OPEN_QUESTIONS, no drafts; the CV text is indexed (P12-CV)', () => {
    const paths = kb.docs.map((d) => d.source_path);
    expect(paths).not.toContain('content/README.md');
    expect(paths).not.toContain('content/OPEN_QUESTIONS.md');
    expect(paths.some((p) => p.includes('overdrive'))).toBe(false); // draft: true
    expect(kb.docs.filter((d) => d.slug.startsWith('project-'))).toHaveLength(8);
    for (const slug of ['profile', 'about', 'skills', 'experience', 'education', 'achievements', 'faq']) expect(kb.docs.map((d) => d.slug)).toContain(slug);
    expect(kb.cvFiles).toEqual(['cv.md']); // P12-CV: the redacted CV text (the PDF itself is never indexed)
    expect(kb.docs.map((d) => d.slug)).toContain('cv');
  });

  it('every chunk cites an anchor that exists on the Classic page', () => {
    const anchors = new Set(kb.chunks.map((c) => c.anchor));
    for (const a of anchors) expect(html, a).toContain(`id="${a}"`);
    expect(anchors.has('contact')).toBe(true); // the FAQ's contact answer cites the Telegraph
    expect(anchors.has('achievement-best-fydp')).toBe(true);
  });

  it('chunks: ≤ 600 tokens, prefixed with who "I" is, front-matter facts included, unique hashes', () => {
    for (const c of kb.chunks) {
      expect(c.token_estimate, `${c.slug}#${c.ord}`).toBeLessThanOrEqual(MAX_TOKENS);
      expect(c.content.startsWith('Muhammad Umer Farooq — ')).toBe(true);
      expect(c.content_hash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(new Set(kb.chunks.map((c) => c.content_hash)).size).toBe(kb.chunks.length);
    const taleem = kb.chunks.filter((c) => c.slug === 'project-taleem360').map((c) => c.content).join('\n');
    expect(taleem).toMatch(/Stack: React, Vite, Capacitor/);
    expect(taleem).toMatch(/1st of 70\+ teams/);
  });

  it('a long section is split with ~15% overlap carried into the next chunk', () => {
    const long = Array.from({ length: 120 }, (_, i) => `Sentence number ${i} talks about retrieval and evaluation in detail.`).join(' ');
    const chunks = chunkDocument({ slug: 'x', title: 'Test', anchor: 'about', sections: [{ heading: 'Long', text: long, anchor: 'about' }] });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.token_estimate).toBeLessThanOrEqual(MAX_TOKENS);
    expect(chunks[1].content).toContain('(continued)');
    expect(tail('a '.repeat(400)).length).toBeGreaterThan(50);
  });

  it('the PII guard aborts on a phone number or a non-public email, and allows the public address', () => {
    const chunk = (content) => [{ slug: 't', ord: 0, content }];
    expect(() => assertChunksClean(chunk(`Reach me at ${PUBLIC_EMAIL}.`))).not.toThrow();
    for (const bad of ['Call 0315 1234567 any time.', 'WhatsApp: +92 315 1234567', 'Mail private.me@example.org']) {
      expect(() => assertChunksClean(chunk(bad)), bad).toThrow(/RAG PII guard/);
      try {
        assertChunksClean(chunk(bad));
      } catch (e) {
        expect(e.message).not.toMatch(/1234567|private\.me/); // the guard never echoes the value
      }
    }
    for (const c of kb.chunks) expect(c.content).not.toMatch(/\+92|tel:/);
  });

  it('hashes include the model and dimension (changing either re-embeds everything)', () => {
    const other = buildKnowledgeBase(ROOT, { model: 'gemini-embedding-002', dim: 768 });
    expect(other.chunks[0].content_hash).not.toBe(kb.chunks[0].content_hash);
  });
});

describe('P5 Gemini embeddings client (api/_lib/embed.js)', () => {
  it('sends the key in the x-goog-api-key header (never the URL), batches, and L2-normalises', async () => {
    const calls = [];
    const fetch = vi.fn(async (url, init) => {
      calls.push({ url, init });
      const { requests } = JSON.parse(init.body);
      return new Response(JSON.stringify({ embeddings: requests.map(() => ({ values: Array.from({ length: 768 }, (_, i) => (i === 0 ? 3 : i === 1 ? 4 : 0)) })) }), { status: 200 });
    });
    const texts = Array.from({ length: 60 }, (_, i) => `text ${i}`);
    const vectors = await embedTexts({ texts, titles: texts, taskType: 'RETRIEVAL_DOCUMENT', apiKey: 'secret-test-key', fetch });
    expect(calls).toHaveLength(2); // 50 + 10
    for (const c of calls) {
      expect(c.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents');
      expect(c.url).not.toContain('secret-test-key');
      expect(c.init.headers['x-goog-api-key']).toBe('secret-test-key');
      const body = JSON.parse(c.init.body);
      expect(body.requests[0]).toMatchObject({ model: 'models/gemini-embedding-001', taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: 768, content: { parts: [{ text: expect.any(String) }] } });
    }
    expect(vectors).toHaveLength(60);
    expect(vectors[0][0]).toBeCloseTo(0.6);
    expect(vectors[0][1]).toBeCloseTo(0.8);
    expect(Math.hypot(...normalise([3, 4]))).toBeCloseTo(1);
    expect(toPgVector([0.5, -0.25])).toBe('[0.5,-0.25]');
  });

  it('queries use RETRIEVAL_QUERY without a title; a bad response throws', async () => {
    const fetch = vi.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      expect(body.requests[0].taskType).toBe('RETRIEVAL_QUERY');
      expect(body.requests[0].title).toBeUndefined();
      return new Response(JSON.stringify({ embeddings: [{ values: [1, 2] }] }), { status: 200 });
    });
    await expect(embedTexts({ texts: ['q'], titles: ['t'], taskType: 'RETRIEVAL_QUERY', apiKey: 'k', fetch })).rejects.toThrow(/unexpected response shape/);
  });
});

describe('P6 fix: portrait covers fill the frame (cover, top centre)', () => {
  let html;
  beforeAll(async () => {
    ({ indexHtml: html } = await buildSite());
  }, 180_000);
  const card = (slug) => html.slice(html.indexOf(`data-project="${slug}"`), html.indexOf('</li>', html.indexOf(`data-project="${slug}"`)));

  it('images.mjs records each image’s size and orientation (manifest); orientation = height > width', () => {
    const m = JSON.parse(read('scripts/content/images.json'));
    // 19-Nov-2026: Umer replaced the TALEEM360 phone screenshot with a wide composed cover (landscape).
    expect(m['/images/projects/taleem360-1600.webp']).toMatchObject({ orientation: 'landscape' });
    expect(m['/images/projects/tiny-village-1600.webp'].orientation).toBe('landscape');
    for (const [file, v] of Object.entries(m)) expect(v.orientation, file).toBe(v.height > v.width ? 'portrait' : 'landscape');
  });

  it('a portrait cover is a plain image with the portrait class (no letterbox wrapper); landscape covers are unchanged', () => {
    expect(card('taleem360')).toMatch(/<img class="project-card__img" src="\/images\/projects\/taleem360-800\.webp"/);
    expect(card('taleem360')).not.toContain('cover-fit');
    // the portrait path is still in the generator (a portrait image gets the class)
    expect(read('scripts/content/gallery.mjs')).toMatch(/project-card__img\$\{portrait \? ' project-card__img--portrait' : ''\}/);
    expect(card('tiny-village')).toMatch(/<img class="project-card__img" src=/);
    expect(card('tiny-village')).not.toContain('--portrait');
    expect(html).not.toContain('cover-fit');
    const css = read('src/styles/main.css');
    expect(css).toMatch(/\.project-card__img--portrait,[\s\S]*?\.modal__hero > img\.project-card__img--portrait \{[\s\S]*?object-fit: cover;\s*object-position: 50% 0;/);
    expect(css).not.toMatch(/cover-fit/);
  });

  it('the bounty poster covers its photo box and anchors a portrait photo to the top (no blurred backdrop)', () => {
    const src = read('src/explore/bounty-posters.js');
    expect(src).toMatch(/const scale = Math\.max\(box\.w \/ iw, box\.h \/ ih\)/);
    expect(src).toMatch(/const sy = ih > iw \? 0 : \(ih - sh\) \/ 2;/);
    expect(src).not.toMatch(/blur\(/);
  });
});
