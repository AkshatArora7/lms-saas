import { TENANT_ID } from "./auth";

/**
 * Org-unit hierarchy for the admin console.
 *
 * In production this comes from the org microservice (tenant-scoped, via the
 * gateway). Until that read path is wired in, we resolve a small, deterministic
 * demo tree for the seeded demo tenant and an empty tree for everyone else, so
 * the console renders a real happy path and a real empty state with no backend
 * dependency.
 */

/** The kind of an org unit, shown as a badge. */
export type OrgUnitType = "district" | "school" | "department" | "grade";

export interface OrgUnit {
  id: string;
  name: string;
  type: OrgUnitType;
  /** Number of members directly assigned to this unit. */
  memberCount: number;
  children: OrgUnit[];
}

const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

const DEMO_TREE: OrgUnit[] = [
  {
    id: "ou-district",
    name: "Demo Unified District",
    type: "district",
    memberCount: 4,
    children: [
      {
        id: "ou-north-high",
        name: "North High School",
        type: "school",
        memberCount: 2,
        children: [
          {
            id: "ou-math",
            name: "Mathematics",
            type: "department",
            memberCount: 6,
            children: [],
          },
          {
            id: "ou-science",
            name: "Science",
            type: "department",
            memberCount: 5,
            children: [],
          },
          {
            id: "ou-humanities",
            name: "Humanities",
            type: "department",
            memberCount: 7,
            children: [],
          },
        ],
      },
      {
        id: "ou-west-elementary",
        name: "West Elementary",
        type: "school",
        memberCount: 1,
        children: [
          {
            id: "ou-grade-9",
            name: "Grade 9",
            type: "grade",
            memberCount: 28,
            children: [],
          },
          {
            id: "ou-grade-10",
            name: "Grade 10",
            type: "grade",
            memberCount: 31,
            children: [],
          },
        ],
      },
    ],
  },
];

export interface OrgTreeStats {
  unitCount: number;
  depth: number;
}

/**
 * Resolve the org-unit tree for the given tenant. Returns an empty array
 * (driving the empty state) for tenants without seeded demo data.
 */
export function getOrgUnits(tenantId: string = TENANT_ID): OrgUnit[] {
  return tenantId === DEMO_TENANT_ID ? DEMO_TREE : [];
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
