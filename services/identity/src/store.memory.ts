import { hashPassword } from "@lms/auth";
import type { TenantContext } from "@lms/types";

import type {
  AuthUserRecord,
  IdentityStore,
  NewRefreshRecord,
  RefreshRecord,
  RolesAndScopes,
} from "./store.js";

/**
 * In-memory IdentityStore. Mirrors the RLS-backed Prisma store against plain
 * arrays so the auth surface can run (and be tested) with no Postgres. Used by
 * the test suite and by the `IDENTITY_STORE=memory` local dev mode.
 */
export class MemoryStore implements IdentityStore {
  private usersByEmail = new Map<string, AuthUserRecord>();
  private roles = new Map<string, RolesAndScopes>();
  tokens: RefreshRecord[] = [];

  seedUser(
    email: string,
    record: AuthUserRecord,
    rolesAndScopes: RolesAndScopes,
  ): void {
    this.usersByEmail.set(email, record);
    this.roles.set(record.id, rolesAndScopes);
  }

  async findUserByEmail(
    _ctx: TenantContext,
    email: string,
  ): Promise<AuthUserRecord | null> {
    return this.usersByEmail.get(email) ?? null;
  }

  async getRolesAndScopes(
    _ctx: TenantContext,
    userId: string,
  ): Promise<RolesAndScopes> {
    return this.roles.get(userId) ?? { roles: [], scopes: [] };
  }

  async insertRefreshToken(
    _ctx: TenantContext,
    rec: NewRefreshRecord,
  ): Promise<void> {
    this.tokens.push({ ...rec, revokedAt: null, replacedBy: null });
  }

  async findRefreshByHash(
    _ctx: TenantContext,
    tokenHash: string,
  ): Promise<RefreshRecord | null> {
    return this.tokens.find((t) => t.tokenHash === tokenHash) ?? null;
  }

  async revokeRefreshToken(
    _ctx: TenantContext,
    id: string,
    replacedBy: string | null = null,
  ): Promise<void> {
    const t = this.tokens.find((x) => x.id === id && x.revokedAt === null);
    if (t) {
      t.revokedAt = new Date();
      t.replacedBy = replacedBy;
    }
  }

  async revokeFamily(_ctx: TenantContext, familyId: string): Promise<void> {
    for (const t of this.tokens) {
      if (t.familyId === familyId && t.revokedAt === null) {
        t.revokedAt = new Date();
      }
    }
  }
}

/** The demo tenant the local dev seed and the web BFFs agree on. */
export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

export interface DemoAccount {
  email: string;
  password: string;
  user: AuthUserRecord;
  roles: RolesAndScopes;
}

/** Demo accounts for local sign-in: one admin/teacher, one plain student. */
export async function demoAccounts(): Promise<DemoAccount[]> {
  return [
    {
      email: "admin@demo.school",
      password: "password123",
      user: {
        id: "demo-admin",
        tenantId: DEMO_TENANT_ID,
        displayName: "Dana Admin",
        status: "active",
        passwordHash: await hashPassword("password123"),
      },
      roles: {
        roles: ["org_admin"],
        scopes: ["users:manage", "courses:manage", "attendance:manage"],
      },
    },
    {
      email: "student@demo.school",
      password: "password123",
      user: {
        id: "demo-student",
        tenantId: DEMO_TENANT_ID,
        displayName: "Sam Student",
        status: "active",
        passwordHash: await hashPassword("password123"),
      },
      roles: { roles: ["learner"], scopes: ["courses:read"] },
    },
  ];
}

/** Build a MemoryStore pre-seeded with the demo accounts. */
export async function createSeededMemoryStore(): Promise<MemoryStore> {
  const store = new MemoryStore();
  for (const acct of await demoAccounts()) {
    store.seedUser(acct.email, acct.user, acct.roles);
  }
  return store;
}
