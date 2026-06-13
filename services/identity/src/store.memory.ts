import { hashPassword } from "@lms/auth";
import type { TenantContext } from "@lms/types";

import type {
  AuthUserRecord,
  IdentityProviderRecord,
  IdentityStore,
  NewRefreshRecord,
  RefreshRecord,
  RolesAndScopes,
  SsoProvisionInput,
} from "./store.js";

/**
 * In-memory IdentityStore. Mirrors the RLS-backed Prisma store against plain
 * arrays so the auth surface can run (and be tested) with no Postgres. Used by
 * the test suite and by the `IDENTITY_STORE=memory` local dev mode.
 */
export class MemoryStore implements IdentityStore {
  private usersByEmail = new Map<string, AuthUserRecord>();
  private roles = new Map<string, RolesAndScopes>();
  private providers = new Map<string, IdentityProviderRecord>();
  private identities = new Map<string, string>(); // `${providerId}:${subject}` -> userId
  tokens: RefreshRecord[] = [];
  private seq = 0;

  seedUser(
    email: string,
    record: AuthUserRecord,
    rolesAndScopes: RolesAndScopes,
  ): void {
    this.usersByEmail.set(email, record);
    this.roles.set(record.id, rolesAndScopes);
  }

  seedProvider(provider: IdentityProviderRecord): void {
    this.providers.set(provider.id, provider);
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

  async findIdentityProvider(
    _ctx: TenantContext,
    providerId: string,
  ): Promise<IdentityProviderRecord | null> {
    return this.providers.get(providerId) ?? null;
  }

  async upsertSsoUser(
    _ctx: TenantContext,
    input: SsoProvisionInput,
  ): Promise<AuthUserRecord> {
    const linkKey = `${input.providerId}:${input.subject}`;

    // 1. Already linked via user_identity.
    const linkedId = this.identities.get(linkKey);
    if (linkedId) {
      const existing = [...this.usersByEmail.values()].find(
        (u) => u.id === linkedId,
      );
      if (existing) return existing;
    }

    // 2. An existing local user with the same email — link a new identity.
    const byEmail = this.usersByEmail.get(input.email);
    if (byEmail) {
      this.identities.set(linkKey, byEmail.id);
      return byEmail;
    }

    // 3. Brand-new JIT user (no local password; external_id = subject).
    const user: AuthUserRecord = {
      id: `sso-user-${++this.seq}`,
      tenantId: _ctx.tenantId,
      displayName: input.displayName,
      status: "active",
      passwordHash: null,
    };
    this.usersByEmail.set(input.email, user);
    this.roles.set(user.id, {
      roles: input.defaultRoles ?? [],
      scopes: input.defaultScopes ?? [],
    });
    this.identities.set(linkKey, user.id);
    return user;
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

/** A demo OIDC provider for `IDENTITY_STORE=memory` local dev. */
export const DEMO_OIDC_PROVIDER_ID = "22222222-2222-2222-2222-222222222222";

/** Build a MemoryStore pre-seeded with the demo accounts and SSO provider. */
export async function createSeededMemoryStore(): Promise<MemoryStore> {
  const store = new MemoryStore();
  for (const acct of await demoAccounts()) {
    store.seedUser(acct.email, acct.user, acct.roles);
  }
  store.seedProvider({
    id: DEMO_OIDC_PROVIDER_ID,
    tenantId: DEMO_TENANT_ID,
    kind: "oidc",
    displayName: "Demo School SSO",
    isEnabled: true,
    config: {
      issuer: "https://demo-idp.example.com",
      authorizationEndpoint: "https://demo-idp.example.com/authorize",
      tokenEndpoint: "https://demo-idp.example.com/token",
      jwksUri: "https://demo-idp.example.com/.well-known/jwks.json",
      clientId: "demo-lms-client",
      redirectUri: "http://localhost:3000/api/auth/sso/callback",
      scopes: ["openid", "email", "profile"],
    },
  });
  return store;
}
