import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { apiKeys } from '@/db/schema';
import { encrypt, decrypt } from '@/lib/crypto';
import { generateApiKey, maskApiKey, type ApiScope } from '@/lib/apikey';
import type { ApiKey } from '@/db/schema';

/**
 * API key management for the manager UI.
 *
 * The plaintext key exists in exactly two places: the creation response (shown
 * once) and the audited reveal. Every listing goes through `toSummary`, which
 * drops both the hash and the ciphertext — so no read path can leak a key by
 * accident.
 */

export type KeyStatus = 'active' | 'revoked' | 'expired';

export interface ApiKeySummary {
  id: number;
  name: string;
  description: string | null;
  keyPrefix: string;
  masked: string;
  scopes: string[];
  status: KeyStatus;
  isActive: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  usageCount: number;
  createdByLabel: string | null;
  createdAt: string;
}

/** Derived, not stored: an expired key stays `isActive` but must not read as usable. */
export function keyStatus(k: Pick<ApiKey, 'isActive' | 'revokedAt' | 'expiresAt'>): KeyStatus {
  if (!k.isActive || k.revokedAt) return 'revoked';
  if (k.expiresAt && k.expiresAt.getTime() <= Date.now()) return 'expired';
  return 'active';
}

/** Strip every secret-bearing column. The ONLY way a key row reaches a client. */
export function toSummary(k: ApiKey): ApiKeySummary {
  return {
    id: k.id,
    name: k.name,
    description: k.description,
    keyPrefix: k.keyPrefix,
    masked: maskApiKey(k.keyPrefix),
    scopes: k.scopes ?? [],
    status: keyStatus(k),
    isActive: k.isActive,
    expiresAt: k.expiresAt?.toISOString() ?? null,
    revokedAt: k.revokedAt?.toISOString() ?? null,
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    lastUsedIp: k.lastUsedIp,
    usageCount: k.usageCount,
    createdByLabel: k.createdByLabel,
    createdAt: k.createdAt.toISOString(),
  };
}

export async function listApiKeys(opts: {
  q?: string;
  status?: KeyStatus | '';
}): Promise<ApiKeySummary[]> {
  const q = opts.q?.trim();
  const conds = [];
  if (q) {
    conds.push(or(ilike(apiKeys.name, `%${q}%`), ilike(apiKeys.keyPrefix, `%${q}%`))!);
  }
  const rows = await db
    .select()
    .from(apiKeys)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(apiKeys.createdAt));

  const summaries = rows.map(toSummary);
  // `expired` is computed, so status filtering happens here rather than in SQL.
  return opts.status ? summaries.filter((s) => s.status === opts.status) : summaries;
}

export async function createApiKey(input: {
  name: string;
  description?: string | null;
  scopes: ApiScope[];
  expiresAt?: Date | null;
  createdByLabel?: string | null;
}): Promise<{ summary: ApiKeySummary; plain: string }> {
  const gen = generateApiKey();
  const [row] = await db
    .insert(apiKeys)
    .values({
      name: input.name,
      description: input.description ?? null,
      keyPrefix: gen.prefix,
      keyHash: gen.hash,
      keyEncrypted: encrypt(gen.plain)!, // non-null: gen.plain is never empty
      scopes: input.scopes,
      expiresAt: input.expiresAt ?? null,
      createdByLabel: input.createdByLabel ?? null,
    })
    .returning();

  return { summary: toSummary(row), plain: gen.plain };
}

export async function updateApiKey(
  id: number,
  patch: {
    name?: string;
    description?: string | null;
    scopes?: ApiScope[];
    isActive?: boolean;
    expiresAt?: Date | null;
  },
): Promise<ApiKeySummary | null> {
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.scopes !== undefined) set.scopes = patch.scopes;
  if (patch.expiresAt !== undefined) set.expiresAt = patch.expiresAt;
  if (patch.isActive !== undefined) {
    set.isActive = patch.isActive;
    // Re-enabling must clear the tombstone, or keyStatus() would keep reporting
    // `revoked` for a key the admin just switched back on.
    set.revokedAt = patch.isActive ? null : new Date();
  }
  if (Object.keys(set).length === 0) return getApiKey(id);

  const [row] = await db.update(apiKeys).set(set).where(eq(apiKeys.id, id)).returning();
  return row ? toSummary(row) : null;
}

export async function getApiKey(id: number): Promise<ApiKeySummary | null> {
  const row = await db.query.apiKeys.findFirst({ where: eq(apiKeys.id, id) });
  return row ? toSummary(row) : null;
}

/** Permanent delete. Prefer `updateApiKey({isActive:false})` — revoking keeps the audit trail. */
export async function deleteApiKey(id: number): Promise<ApiKeySummary | null> {
  const [row] = await db.delete(apiKeys).where(eq(apiKeys.id, id)).returning();
  return row ? toSummary(row) : null;
}

/** Decrypt a stored key. Callers MUST audit — see the reveal route. */
export async function revealApiKey(id: number): Promise<{ plain: string; name: string } | null> {
  const row = await db.query.apiKeys.findFirst({ where: eq(apiKeys.id, id) });
  if (!row) return null;
  const plain = decrypt(row.keyEncrypted);
  return plain ? { plain, name: row.name } : null;
}

/**
 * Replace a key's secret in place, keeping its id/name/scopes. Used when a key
 * leaks: consumers get a new value without the integration being re-created.
 */
export async function rotateApiKey(
  id: number,
): Promise<{ summary: ApiKeySummary; plain: string } | null> {
  const gen = generateApiKey();
  const [row] = await db
    .update(apiKeys)
    .set({
      keyPrefix: gen.prefix,
      keyHash: gen.hash,
      keyEncrypted: encrypt(gen.plain)!,
      // A rotated key is usable immediately — clear any prior revocation and
      // reset telemetry, since usage counts belong to the old secret.
      isActive: true,
      revokedAt: null,
      lastUsedAt: null,
      lastUsedIp: null,
      usageCount: 0,
    })
    .where(eq(apiKeys.id, id))
    .returning();

  return row ? { summary: toSummary(row), plain: gen.plain } : null;
}

/** Counters for the manager page header. */
export async function apiKeyStats(): Promise<{ total: number; active: number; calls: number }> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)`,
      active: sql<number>`count(*) filter (where ${apiKeys.isActive} and ${apiKeys.revokedAt} is null)`,
      calls: sql<number>`coalesce(sum(${apiKeys.usageCount}), 0)`,
    })
    .from(apiKeys);
  return {
    total: Number(row?.total ?? 0),
    active: Number(row?.active ?? 0),
    calls: Number(row?.calls ?? 0),
  };
}
