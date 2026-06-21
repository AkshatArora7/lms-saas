import { TENANT_ID } from "./auth";
import {
  listOrgUnits,
  type OrgUnitRecord,
  type OrgUnitType,
} from "./user-org-api";

/**
 * Org-unit hierarchy presentation layer for the admin console.
 *
 * Resolves the org tree from the user-org microservice (tenant-scoped, via the
 * BFF client in `user-org-api.ts`). The service returns a flat set of units;
 * we assemble the tree from `parentId`. Returns `null` when the service is
 * unreachable so the page can render an offline state — there is no demo
 * fallback.
 */

export type { OrgUnitType };

export interface OrgUnit {
  id: string;
  name: string;
  type: OrgUnitType;
  children: OrgUnit[];
}

export interface OrgTreeStats {
  unitCount: number;
  depth: number;
}

/** Assemble the flat unit list into a root-first tree via `parentId`. */
function buildTree(records: OrgUnitRecord[]): OrgUnit[] {
  const nodes = new Map<string, OrgUnit>();
  for (const r of records) {
    nodes.set(r.id, { id: r.id, name: r.name, type: r.type, children: [] });
  }
  const roots: OrgUnit[] = [];
  for (const r of records) {
    const node = nodes.get(r.id)!;
    const parent = r.parentId ? nodes.get(r.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/**
 * Resolve the org-unit tree for the given tenant. Returns `null` when the
 * service is unreachable (driving an offline state) and an empty array when the
 * tenant has no units yet (driving the empty state).
 */
export async function getOrgUnits(
  tenantId: string = TENANT_ID,
): Promise<OrgUnit[] | null> {
  const res = await listOrgUnits(tenantId);
  if (!res.ok) return null;
  return buildTree(res.orgUnits);
}

/** Count total units and maximum depth across the tree. */
export function summarizeOrgTree(units: OrgUnit[]): OrgTreeStats {
  let unitCount = 0;
  let depth = 0;

  const walk = (nodes: OrgUnit[], level: number): void => {
    if (nodes.length) depth = Math.max(depth, level);
    for (const node of nodes) {
      unitCount += 1;
      walk(node.children, level + 1);
    }
  };

  walk(units, 1);
  return { unitCount, depth };
}
