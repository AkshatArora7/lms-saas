/**
 * Domain types and persistence boundary for the tenant control plane.
 *
 * NOTE: unlike the tenant-scoped domain services (enrollment, grading, ...),
 * the `tenant` table is CONTROL-PLANE: it is the registry of tenants itself
 * and is deliberately OUTSIDE Postgres RLS (it is not in the `tenant_tables`
 * RLS loop). Consequently the store methods here do NOT take a `TenantContext`
 * and the Prisma implementation runs against `controlPlane()` (a non
 * tenant-scoped client), never `withTenant`. Provisioning a tenant is the act
 * of creating the very row RLS would otherwise scope to.
 */

export type TenantTier = "pool" | "silo";
export type TenantStatus = "provisioning" | "active" | "suspended" | "deleted";
export type TenantKind = "standalone" | "parent" | "sub";

/** A row in the control-plane tenant registry, with a derived subdomain. */
export interface TenantRecord {
  id: string;
  slug: string;
  name: string;
  kind: TenantKind;
  tier: TenantTier;
  status: TenantStatus;
  region: string;
  planId: string | null;
  /** Derived routing host: `${slug}.lms.app`. Not stored; computed on read. */
  subdomain: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProvisionTenantInput {
  slug: string;
  name: string;
  /** Defaults to "us-east" when omitted. */
  region?: string;
  /** Optional plan *code* (e.g. "core"); resolved to a plan id. */
  plan?: string;
}

export type ProvisionTenantResult =
  | { ok: true; tenant: TenantRecord }
  | { ok: false; reason: "slug_taken" | "unknown_plan" };

/**
 * The shape of a `tenant.provisioned` row written to the transactional outbox
 * in the SAME transaction as the tenant insert. The Prisma store persists this
 * to `event_outbox`; the memory store records it in memory for assertions.
 */
export interface OutboxEvent {
  tenantId: string;
  type: string;
  payload: Record<string, unknown>;
}

/**
 * Persistence boundary for the tenant control plane. Routes depend only on this
 * interface, so production uses a control-plane Postgres implementation while
 * tests inject an in-memory one.
 */
export interface TenantStore {
  /** Provision a new pool-tier tenant + emit `tenant.provisioned` atomically. */
  provisionTenant(input: ProvisionTenantInput): Promise<ProvisionTenantResult>;
  getTenant(id: string): Promise<TenantRecord | null>;
  getTenantBySlug(slug: string): Promise<TenantRecord | null>;
  listTenants(): Promise<TenantRecord[]>;
  /** Transition a tenant's lifecycle status (e.g. to `deleted` on offboarding). */
  setStatus(id: string, status: TenantStatus): Promise<TenantRecord | null>;
}

/** Derived routing host for a tenant slug. Pure so stores and tests share it. */
export function subdomainFor(slug: string): string {
  return `${slug}.lms.app`;
}

/**
 * Normalise a slug the way the `citext` column compares it: trimmed and
 * lowercased. Slug routing is case-insensitive, so "Acme" and "acme" collide.
 */
export function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

/**
 * Validate a tenant slug: non-empty, lowercase alphanumerics and hyphens only,
 * no leading/trailing/double hyphens, and a sane length (it becomes a DNS
 * label in `${slug}.lms.app`). Pure so routes and tests share one rule.
 */
export function isValidSlug(slug: unknown): slug is string {
  if (typeof slug !== "string") return false;
  const normalized = normalizeSlug(slug);
  if (normalized.length === 0 || normalized.length > 63) return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized);
}
