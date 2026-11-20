// P7 admin: the request schemas, shared by the server (api/admin/[...path].js) and, for the field limits, the
// admin page. Every schema is strict: an unknown key (for example "ip_hash" or "role") is refused. zod runs
// without code generation (jitless), like the other schemas, so the strict CSP stays clean.
import { z } from 'zod';

z.config({ jitless: true });

export const ADMIN_LIMITS = { body: 4 * 1024, email: 254, password: 200, token: 2048, orderBody: 8 * 1024 };
export const MESSAGE_STATUSES = ['new', 'reading', 'replied', 'archived'];
/** What the database may hold (0005_admin.sql) and the board column it is shown in. */
export const STATUS_COLUMN = { new: 'new', email_failed: 'new', read: 'reading', reading: 'reading', replied: 'replied', archived: 'archived', spam: 'archived' };

const NOCTRL = /^[^\u0000-\u001F\u007F-\u009F]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const loginSchema = z
  .object({
    email: z.string().trim().min(3).max(ADMIN_LIMITS.email).email().regex(NOCTRL),
    password: z.string().min(1).max(ADMIN_LIMITS.password),
    token: z.string().min(1).max(ADMIN_LIMITS.token),
  })
  .strict();

export const mfaVerifySchema = z
  .object({
    code: z.string().regex(/^\d{6}$/),
    factorId: z.string().regex(UUID).optional(),
  })
  .strict();

export const messagePatchSchema = z
  .object({
    id: z.string().regex(UUID),
    status: z.enum(MESSAGE_STATUSES),
  })
  .strict();

export const orderSaveSchema = z
  .object({
    order: z.array(z.string().regex(/^[a-z0-9-]{1,80}$/)).min(1).max(100),
  })
  .strict();
