import { createHash } from "node:crypto";

/**
 * The immutable fields of an audit row that are bound into the hash chain. Any
 * change to these after the fact breaks the chain and is detectable.
 */
export interface ChainableEntry {
  id: string;
  tenantId: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
}

export interface ChainLink {
  prevHash: string | null;
  rowHash: string;
}

/** Deterministic, key-order-stable JSON so the hash is reproducible. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

/** Canonical serialization of an entry's immutable fields. */
export function canonicalPayload(entry: ChainableEntry): string {
  return stableStringify({
    id: entry.id,
    tenantId: entry.tenantId,
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    metadata: entry.metadata,
    ipAddress: entry.ipAddress,
    createdAt: entry.createdAt,
  });
}

/**
 * `row_hash = SHA-256( prevHashHex || canonicalPayload )`, lowercase hex. The
 * first row in a tenant's chain has `prevHashHex = null` (treated as "").
 */
export function computeRowHash(
  prevHashHex: string | null,
  entry: ChainableEntry,
): string {
  return createHash("sha256")
    .update((prevHashHex ?? "") + canonicalPayload(entry))
    .digest("hex");
}

export type VerifyReason = "hash_mismatch" | "broken_link";

export interface VerifyResult {
  ok: boolean;
  /** Number of rows checked before stopping (all rows when ok). */
  checked: number;
  /** Id of the first tampered/broken row, or null when the chain is intact. */
  brokenAt: string | null;
  reason?: VerifyReason;
}

/**
 * Verify a tenant's chain. `entries` must be in insertion (chain) order. Detects
 * both a recomputed-hash mismatch (a field was altered) and a broken link (a row
 * was inserted/removed/reordered so `prev_hash` no longer matches the prior
 * `row_hash`).
 */
export function verifyChain(
  entries: (ChainableEntry & ChainLink)[],
): VerifyResult {
  let prev: string | null = null;
  let checked = 0;
  for (const entry of entries) {
    if ((entry.prevHash ?? null) !== prev) {
      return { ok: false, checked, brokenAt: entry.id, reason: "broken_link" };
    }
    const expected = computeRowHash(prev, entry);
    if (expected !== entry.rowHash) {
      return { ok: false, checked, brokenAt: entry.id, reason: "hash_mismatch" };
    }
    prev = entry.rowHash;
    checked += 1;
  }
  return { ok: true, checked, brokenAt: null };
}
