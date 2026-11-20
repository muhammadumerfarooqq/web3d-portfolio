// Supabase through its REST API (PostgREST) with plain fetch: no supabase-js. Server only: it uses the
// service role key, which bypasses RLS. Errors never echo response bodies (they may contain data).

/** A failed Supabase REST call. `status` is the HTTP status, `code` the short PostgREST / Postgres code (for example
 *  21000, PGRST202, 42501), reduced to [A-Za-z0-9_]: safe to log. The message text of the response is never kept. */
export class SupabaseError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The log line reason for a failed call: `<where>_db_<status>_<code>`. */
export const dbReason = (where, error) => (error instanceof SupabaseError ? `${where}_db_${Number(error.status) || 0}_${error.code}` : `${where}_exception`);

export function createSupabase({ url, key, fetch }) {
  const base = `${url.replace(/\/+$/, '')}/rest/v1`;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  async function call(path, init) {
    const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      let code = 'none';
      try {
        const raw = (await res.json())?.code;
        if (typeof raw === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(raw)) code = raw;
      } catch {
        /* no JSON body */
      }
      throw new SupabaseError(`supabase ${init.method} ${path.split('?')[0]} → ${res.status}`, res.status, code);
    }
    if (res.status === 204) return null;
    const text = await res.text(); // return=minimal answers 201 with an empty body
    return text ? JSON.parse(text) : null;
  }
  return {
    /** Call a SQL function: POST /rest/v1/rpc/<name>. */
    rpc: (name, args) => call(`/rpc/${name}`, { method: 'POST', body: JSON.stringify(args) }),
    /** PATCH rows matching `query` (PostgREST filter syntax); returns nothing. */
    patch: (table, query, values) => call(`/${table}?${query}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(values) }),
    /** P5: GET rows (`query` = PostgREST select/filter string). */
    select: (table, query) => call(`/${table}?${query}`, { method: 'GET' }),
    /** P5: INSERT … ON CONFLICT (onConflict) DO UPDATE; returns the rows (representation). */
    upsert: (table, rows, onConflict) =>
      call(`/${table}?on_conflict=${encodeURIComponent(onConflict)}`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(rows) }),
    /** P5: INSERT rows; returns nothing. */
    insert: (table, rows) => call(`/${table}`, { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(rows) }),
    /** P5: DELETE rows matching `query`; returns nothing. */
    remove: (table, query) => call(`/${table}?${query}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }),
  };
}
