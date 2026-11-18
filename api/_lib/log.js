// Server logs: one JSON line per event with a fixed set of safe fields. Never names, emails, messages,
// IPs, IP hashes, tokens or env values (no PII, no secrets): only what happened and how long it took.

// bytes / seconds / lang / model: audio size, audio length, chat language and model id (P6 transcribe); none is personal.
const SAFE = new Set(['event', 'status', 'reason', 'ms', 'missing', 'bytes', 'seconds', 'lang', 'model']);

export function logEvent(event, fields = {}) {
  const line = { event };
  for (const [k, v] of Object.entries(fields)) if (SAFE.has(k)) line[k] = v;
  console.log(JSON.stringify(line));
}
