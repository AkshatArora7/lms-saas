import { TENANT_ID } from "./auth";

/**
 * Directory data for the admin console.
 *
 * In production these come from the identity + org microservices (tenant-scoped,
 * via the gateway). Until that read path is wired into this surface, we resolve a
 * small, deterministic set of demo users for the seeded demo tenant and an empty
 * collection for everyone else, so the console renders a real happy path and a
 * real empty state with no backend dependency.
 */

/** The lifecycle state of a user account within the tenant. */
export type UserStatus = "active" | "invited" | "suspended";

export interface DirectoryUser {
  id: string;
  name: string;
  email: string;
  roles: string[];
  status: UserStatus;
  /** The org unit the user primarily belongs to. */
  orgUnit: string;
}

const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

const DEMO_USERS: DirectoryUser[] = [
  {
    id: "u-amelia",
    name: "Amelia Stone",
    email: "amelia.stone@demo.edu",
    roles: ["org_admin"],
    status: "active",
    orgUnit: "District Office",
  },
  {
    id: "u-priya",
    name: "Dr. Priya Natarajan",
    email: "priya.natarajan@demo.edu",
    roles: ["instructor"],
    status: "active",
    orgUnit: "Mathematics",
  },
  {
    id: "u-daniel",
    name: "Daniel Okoro",
    email: "daniel.okoro@demo.edu",
    roles: ["instructor"],
    status: "active",
    orgUnit: "Science",
  },
  {
    id: "u-aisha",
    name: "Aisha Rahman",
    email: "aisha.rahman@demo.edu",
    roles: ["instructor", "org_admin"],
    status: "active",
    orgUnit: "Humanities",
  },
  {
    id: "u-marcus",
    name: "Marcus Bell",
    email: "marcus.bell@demo.edu",
    roles: ["instructor"],
    status: "suspended",
    orgUnit: "Humanities",
  },
  {
    id: "u-jordan",
    name: "Jordan Lee",
    email: "jordan.lee@demo.edu",
    roles: ["student"],
    status: "active",
    orgUnit: "Grade 9",
  },
  {
    id: "u-sam",
    name: "Sam Carter",
    email: "sam.carter@demo.edu",
    roles: ["student"],
    status: "invited",
    orgUnit: "Grade 10",
  },
  {
    id: "u-nina",
    name: "Nina Alvarez",
    email: "nina.alvarez@demo.edu",
    roles: ["support"],
    status: "invited",
    orgUnit: "District Office",
  },
];

const ADMIN_ROLES = ["org_admin", "super_admin"];

export interface DirectorySummary {
  total: number;
  admins: number;
  pendingInvites: number;
}

/**
 * Resolve the users to show in the admin directory for the given tenant. Returns
 * an empty array (driving the empty state) for tenants without seeded demo data.
 */
export function getDirectoryUsers(
  tenantId: string = TENANT_ID,
): DirectoryUser[] {
  return tenantId === DEMO_TENANT_ID ? DEMO_USERS : [];
}

/** Derive the headline counts shown above the directory. */
export function summarizeDirectory(users: DirectoryUser[]): DirectorySummary {
  return {
    total: users.length,
    admins: users.filter((u) => u.roles.some((r) => ADMIN_ROLES.includes(r)))
      .length,
    pendingInvites: users.filter((u) => u.status === "invited").length,
  };
}

/**
 * Resolve a single user for the given tenant. Returns null for unknown tenants
 * or user ids, driving the not-found path.
 */
export function getDirectoryUser(
  userId: string,
  tenantId: string = TENANT_ID,
): DirectoryUser | null {
  if (tenantId !== DEMO_TENANT_ID) return null;
  return DEMO_USERS.find((u) => u.id === userId) ?? null;
}
