import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Reversible field encryption — AES-256-GCM.
 *
 * Why reversible (not a bcrypt/argon2 hash): the school requires that an admin
 * (`teacher-admin`) can *reveal* the original student/teacher password to hand
 * back to the person. A one-way hash cannot do that. The security trade-off is
 * handled by keeping the key OUT of the DB (env / secret manager), gating
 * decryption behind `teacher-admin`, and audit-logging every reveal.
 *
 * Stored format (base64 of):  [12-byte IV][16-byte auth tag][ciphertext]
 * Only used in Node runtime (API routes / scripts), never in edge middleware.
 */

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'FIELD_ENCRYPTION_KEY is not set. Generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  // Accept base64 (preferred) or a raw 32-char utf8 key.
  let key = Buffer.from(raw, 'base64');
  if (key.length !== 32) key = Buffer.from(raw, 'utf8');
  if (key.length !== 32) {
    throw new Error(
      `FIELD_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}). ` +
        'Use a base64-encoded 32-byte key.',
    );
  }
  cachedKey = key;
  return key;
}

/** Encrypt a plaintext string. Returns null for null/undefined/empty input. */
export function encrypt(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined || plain === '') return null;
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/** Decrypt a stored ciphertext. Returns null for null/empty input. Throws on tamper. */
export function decrypt(payload: string | null | undefined): string | null {
  if (payload === null || payload === undefined || payload === '') return null;
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** Best-effort decrypt that never throws (returns null on failure). */
export function tryDecrypt(payload: string | null | undefined): string | null {
  try {
    return decrypt(payload);
  } catch {
    return null;
  }
}

/**
 * Constant-time string compare. Used for password verification so the decrypt-
 * then-compare login path does not leak, via response timing, how many leading
 * characters of a guess were correct. A length mismatch short-circuits (it only
 * reveals the length, not the content), so equal-length inputs are compared in
 * time independent of where they first differ.
 */
export function safeStrEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Mask a citizen id for display: keep first 1 and last 4 -> 1-2345-XXXXX-XX-1 style. */
export function maskCitizenId(id: string | null): string | null {
  if (!id) return null;
  const digits = id.replace(/\D/g, '');
  if (digits.length < 5) return '••••';
  return `${digits[0]}-XXXX-XXXXX-XX-${digits.slice(-1)}`;
}
