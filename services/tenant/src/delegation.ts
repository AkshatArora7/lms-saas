/**
 * Sub-tenant admin delegation (issue #5).
 *
 * A district administrator can grant a user admin rights limited to one school
 * (sub-tenant), so schools self-manage without seeing sibling schools' data.
 * The heart of this is the pure {@link tenantAccessDecision} policy:
 *
 * - own tenant            -> allow
 * - ancestor (district)   -> allow (district override visibility over its subtree)
 * - delegated to the user -> allow (scoped to exactly that sub-tenant)
 * - otherwise (siblings)  -> deny
 *
 * Data isolation between sub-tenants is still enforced by Postgres RLS on the
 * domain tables; this policy governs WHO may administer WHICH sub-tenant.
 */

export interface DelegationRecord {
  id: string;
  delegatorTenantId: string;
  scopeTenantId: string;
  delegateUserId: string;
  role: string;
  createdAt: string;
  revokedAt: string | null;
}

export interface NewDelegationInput {
  delegatorTenantId: string;
  scopeTenantId: string;
  delegateUserId: string;
  role?: string;
}

/** A tenant node in the hierarchy (id + its parent), for descendant checks. */
export interface TenantNode {
  id: string;
  parentId: string | null;
}

export type CreateDelegationResult =
  | { ok: true; delegation: DelegationRecord }
  | { ok: false; reason: "scope_not_descendant" | "unknown_tenant" };

/**
 * Is `targetId` a descendant of `ancestorId` in the hierarchy? Walks parent
 * links up from the target. Pure, so the memory store and tests share it.
 */
export function isDescendantOf(
  targetId: string,
  ancestorId: string,
  nodes: TenantNode[],
): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let current = byId.get(targetId);
  let guard = 0;
  while (current?.parentId && guard < 64) {
    if (current.parentId === ancestorId) return true;
    current = byId.get(current.parentId);
    guard += 1;
  }
  return false;
}

export interface AccessActor {
  tenantId: string;
  userId: string;
}

export type AccessReason =
  | "own_tenant"
  | "ancestor_override"
  | "delegated"
  | "denied_cross_tenant";

export interface AccessDecision {
  allowed: boolean;
  reason: AccessReason;
}

/**
 * Decide whether `actor` may administer `targetTenantId`. Inputs are reduced to
 * booleans by the caller (computed from the hierarchy + delegations) so this
 * policy is trivially testable and has no I/O.
 */
export function tenantAccessDecision(args: {
  actor: AccessActor;
  targetTenantId: string;
  /** Is the target a descendant of the actor's tenant? (district override) */
  targetIsDescendant: boolean;
  /** Does an active delegation grant this user the target scope? */
  hasDelegation: boolean;
}): AccessDecision {
  if (args.actor.tenantId === args.targetTenantId) {
    return { allowed: true, reason: "own_tenant" };
  }
  if (args.targetIsDescendant) {
    return { allowed: true, reason: "ancestor_override" };
  }
  if (args.hasDelegation) {
    return { allowed: true, reason: "delegated" };
  }
  return { allowed: false, reason: "denied_cross_tenant" };
}

/**
 * Control-plane persistence for delegations + hierarchy lookups. Not
 * tenant-scoped (it links tenants across the hierarchy), so the Prisma
 * implementation runs against `controlPlane()`, never `withTenant`.
 */
export interface DelegationStore {
  /** Create a delegation; rejects if scope is not a descendant of the delegator. */
  createDelegation(input: NewDelegationInput): Promise<CreateDelegationResult>;
  /** Active (non-revoked) delegations for a scope tenant. */
  listDelegations(scopeTenantId: string): Promise<DelegationRecord[]>;
  revokeDelegation(id: string): Promise<DelegationRecord | null>;
  /** Is `targetTenantId` a descendant of `ancestorTenantId`? */
  isDescendant(targetTenantId: string, ancestorTenantId: string): Promise<boolean>;
  /** Does an active delegation grant `userId` admin of `scopeTenantId`? */
  hasActiveDelegation(scopeTenantId: string, userId: string): Promise<boolean>;
}
