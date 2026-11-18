// Shared HTTP helpers for the Vercel Functions in api/ (plain Node req/res, so the same handler runs on
// Vercel and in the Vite dev middleware). No CORS headers anywhere: the API is same-origin only.

export const ALLOWED_ORIGINS = ['https://umerfarooq-ai.vercel.app', 'https://web3d-portfolio-three.vercel.app'];
/** This project's Vercel preview URLs, and local development. */
const PREVIEW = /^https:\/\/web3d-portfolio-[a-z0-9-]+-umer-134e\.vercel\.app$/;
const LOCAL = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/;

export const isAllowedOrigin = (origin) => typeof origin === 'string' && (ALLOWED_ORIGINS.includes(origin) || PREVIEW.test(origin) || LOCAL.test(origin));

/** Hostnames Turnstile may report for a solved challenge (same list, without scheme and port). */
export function isAllowedHostname(hostname) {
  if (typeof hostname !== 'string' || !hostname) return false;
  return isAllowedOrigin(`https://${hostname}`) || hostname === 'localhost' || hostname === '127.0.0.1';
}

const header = (req, name) => {
  const v = req.headers?.[name];
  return Array.isArray(v) ? v[0] : v;
};

/** Same-origin check on Origin, falling back to the Referer's origin. Missing both → not allowed. */
export function requestOrigin(req) {
  const origin = header(req, 'origin');
  if (origin && origin !== 'null') return origin;
  const referer = header(req, 'referer');
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/** The visitor's IP as Vercel reports it (x-real-ip / first x-forwarded-for), else the socket. */
export function clientIp(req) {
  const real = header(req, 'x-real-ip');
  if (real) return String(real).trim();
  const fwd = header(req, 'x-forwarded-for');
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress ?? '';
}

export function sendJson(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

export class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

/** Read the raw body, refusing more than `limit` bytes (413) before and while reading. */
export async function readBody(req, limit) {
  const declared = Number(header(req, 'content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, 'payload_too_large');
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
    const buf = Buffer.from(req.body);
    if (buf.length > limit) throw new HttpError(413, 'payload_too_large');
    return buf.toString('utf8');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'payload_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export { header as getHeader };
