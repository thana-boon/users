import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * API key primitives for the machine-to-machine `/api/public/v1/*` surface.
 *
 * A key is only ever *matched* by its SHA-256 hash (deterministic → uniquely
 * indexable). The reversible AES copy stored alongside it exists solely so the
 * API Manager can re-reveal the value to an admin; it is never consulted during
 * request auth. Plain SHA-256 (no bcrypt/argon2) is correct here: unlike a
 * human password these are 32 bytes of CSPRNG output, so there is no dictionary
 * to attack and per-request hashing must stay cheap.
 */

/** Human-visible prefix. `sk` = secret key; kept short so logs stay readable. */
const KEY_PREFIX = 'sk_live_';
const KEY_BYTES = 32;

// Scopes live in a Node-free module so client components can import them; they
// are re-exported here for server callers that want one import.
export {
  API_SCOPES,
  SCOPE_LABEL_TH,
  PII_SCOPES,
  isApiScope,
  hasScope,
  type ApiScope,
} from './api-scopes';

// -- Generation / hashing -------------------------------------------

export interface GeneratedKey {
  /** Full secret — shown once at creation, and again only via an audited reveal. */
  plain: string;
  /** SHA-256 hex of `plain` — what the DB matches on. */
  hash: string;
  /** Display-safe leading chunk, e.g. `sk_live_9f3c`. */
  prefix: string;
}

export function generateApiKey(): GeneratedKey {
  // base64url keeps the key copy-pasteable and header-safe (no +/= padding).
  const plain = KEY_PREFIX + randomBytes(KEY_BYTES).toString('base64url');
  return { plain, hash: hashApiKey(plain), prefix: displayPrefix(plain) };
}

export function hashApiKey(plain: string): string {
  return createHash('sha256').update(plain, 'utf8').digest('hex');
}

/** First 4 chars of the random part — enough to tell keys apart, not to guess one. */
export function displayPrefix(plain: string): string {
  return plain.slice(0, KEY_PREFIX.length + 4);
}

/** `sk_live_9f3c••••••••4a2f` — the manager's at-rest rendering. */
export function maskApiKey(prefix: string, plain?: string | null): string {
  const tail = plain ? plain.slice(-4) : '';
  return `${prefix}${'•'.repeat(8)}${tail}`;
}

/** Constant-time compare of two hex digests (defence against timing oracles). */
export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Pull the presented key out of a request. Accepts either
 *   Authorization: Bearer sk_live_...
 *   X-API-Key: sk_live_...
 * Only values carrying the key prefix are returned, so a *session* JWT sent as
 * a Bearer token is never mistaken for an API key (see requireApiScope).
 */
export function extractApiKey(headers: Headers): string | null {
  const xk = headers.get('x-api-key')?.trim();
  if (xk && xk.startsWith(KEY_PREFIX)) return xk;

  const auth = headers.get('authorization');
  const m = auth?.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1]?.trim();
  if (token && token.startsWith(KEY_PREFIX)) return token;

  return null;
}
