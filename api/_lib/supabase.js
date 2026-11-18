// Supabase through its REST API (PostgREST) with plain fetch: no supabase-js. Server only: it uses the
// service role key, which bypasses RLS. Errors never echo response bodies (they may contain data).

export function createSupabase({ url, key, fetch }) {
  const base = `${url.replace(/\/+$/, '')}/rest/v1`;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  async function call(path, init) {
    const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`supabase ${init.method} ${path.split('?')[0]} → ${res.status}`);
    return res.status === 204 ? null : res.json();
  }
  return {
    /** Call a SQL function: POST /rest/v1/rpc/<name>. */
    rpc: (name, args) => call(`/rpc/${name}`, { method: 'POST', body: JSON.stringify(args) }),
    /** PATCH rows matching `query` (PostgREST filter syntax); returns nothing. */
    patch: (table, query, values) => call(`/${table}?${query}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(values) }),
  };
}
