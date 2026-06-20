import type { TenantContext } from "@lms/types";

/**
 * Granular, org-scoped authorization (issue #18).
 *
 * Permissions follow the org hierarchy (district -> school -> course ->
 * section). A role assigned at an org unit grants its permissions there, and —
 * when the assignment has `cascade` — to every descendant org unit too. Access
 * is DENY-BY-DEFAULT: only an explicit grant whose scope covers the target
 * allows the action.
 *
 * The store returns raw grants + org-unit ancestry; the decision itself is pure
 * (no I/O), so it is trivially testable and identical in dev/test and prod.
 */

/** One (permission, scope) a user holds via a role assignment. */
export interface Grant {
  roleId: string;
  roleName: string;
  permission: string;
  /** Org unit the role was assigned at. */
  orgUnitId: string;
  /** Whether the grant cascades to descendant org units. */
  cascade: boolean;
}

/** An org unit plus its materialised ancestor path (root-first, excluding self). */
export interface OrgUnitAncestry {
  id: string;
  path: string[];
}

/**
 * Does a grant's scope cover the target org unit? True when the grant is at the
 * target itself, or at an ancestor and the grant cascades.
 */
export function isGrantApplicable(
  grant: Grant,
  target: OrgUnitAncestry,
): boolean {
  if (grant.orgUnitId === target.id) return true;
  return grant.cascade && target.path.includes(grant.orgUnitId);
}

export interface AccessDecision {
  allowed: boolean;
  reason: "granted" | "deny_by_default";
  /** The grant that allowed the action, when allowed. */
  via?: Grant;
}

/**
 * Deny-by-default permission check at an org-unit scope. Allows only when some
 * grant for exactly this permission has a scope that covers the target.
 */
export function checkAccess(
  grants: Grant[],
  permission: string,
  target: OrgUnitAncestry,
): AccessDecision {
  const via = grants.find(
    (g) => g.permission === permission && isGrantApplicable(g, target),
  );
  return via
    ? { allowed: true, reason: "granted", via }
    : { allowed: false, reason: "deny_by_default" };
}

/** An effective permission entry for the debugging endpoint. */
export interface EffectivePermission {
  permission: string;
  orgUnitId: string;
  cascade: boolean;
  roleName: string;
}

/**
 * The user's effective permissions, de-duplicated by (permission, orgUnitId,
 * cascade). Pure — for the effective-permissions debug endpoint.
 */
export function effectivePermissions(grants: Grant[]): EffectivePermission[] {
  const seen = new Set<string>();
  const out: EffectivePermission[] = [];
  for (const g of grants) {
    const key = `${g.permission}@${g.orgUnitId}:${g.cascade}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      permission: g.permission,
      orgUnitId: g.orgUnitId,
      cascade: g.cascade,
      roleName: g.roleName,
    });
  }
  return out;
}

/** Tenant-scoped authorization reads (RLS via withTenant). */
export interface AuthzStore {
  /** All (permission, scope) grants a user holds, via their role assignments. */
  listGrants(ctx: TenantContext, userId: string): Promise<Grant[]>;
  /** Resolve an org unit + its ancestor path, or null if unknown. */
  getAncestry(
    ctx: TenantContext,
    orgUnitId: string,
  ): Promise<OrgUnitAncestry | null>;
}
