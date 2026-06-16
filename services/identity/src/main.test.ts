import { hashPassword } from "@lms/auth";
import type { TenantContext } from "@lms/types";
import { beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "./main.js";
import type {
  AuthUserRecord,
  IdentityProviderRecord,
  IdentityStore,
  NewRefreshRecord,
  RefreshRecord,
  RolesAndScopes,
  SsoProvisionInput,
} from "./store.js";
import type { OidcExchanger } from "./sso.js";

/**
 * In-memory IdentityStore so the auth surface can be tested end-to-end with
 * Fastify's `inject` — no Postgres, no network. This mirrors exactly what the
 * RLS-backed Prisma store does, just against arrays.
 */
class MemoryStore implements IdentityStore {
  private usersByEmail = new Map<string, AuthUserRecord>();
  private roles = new Map<string, RolesAndScopes>();
  private providers = new Map<string, IdentityProviderRecord>();
  private identities = new Map<string, string>();
  private parents = new Map<string, string>();
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

  seedParent(tenantId: string, parentTenantId: string): void {
    this.parents.set(tenantId, parentTenantId);
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

  async getParentTenantId(ctx: TenantContext): Promise<string | null> {
    return this.parents.get(ctx.tenantId) ?? ctx.parentTenantId ?? null;
  }

  async insertRefreshToken(
    _ctx: TenantContext,
    rec: NewRefreshRecord,
  ): Promise<void> {
    this.tokens.push({ ...rec, revokedAt: null, replacedBy: null });
  }

  async findRefreshByHash(
    ctx: TenantContext,
    tokenHash: string,
  ): Promise<RefreshRecord | null> {
    // Mirror RLS: a tenant can only ever see its own refresh-token rows.
    return (
      this.tokens.find(
        (t) => t.tokenHash === tokenHash && t.tenantId === ctx.tenantId,
      ) ?? null
    );
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

  async revokeFamily(
    _ctx: TenantContext,
    familyId: string,
  ): Promise<void> {
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
    ctx: TenantContext,
    input: SsoProvisionInput,
  ): Promise<AuthUserRecord> {
    const linkKey = `${input.providerId}:${input.subject}`;
    const linkedId = this.identities.get(linkKey);
    if (linkedId) {
      const existing = [...this.usersByEmail.values()].find(
        (u) => u.id === linkedId,
      );
      if (existing) return existing;
    }
    const byEmail = this.usersByEmail.get(input.email);
    if (byEmail) {
      this.identities.set(linkKey, byEmail.id);
      return byEmail;
    }
    const user: AuthUserRecord = {
      id: `sso-user-${++this.seq}`,
      tenantId: ctx.tenantId,
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

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const tenant: TenantContext = {
  tenantId: TENANT_ID,
  tier: "pool",
  databaseUrl: "postgres://user:pass@localhost:5432/lms_test",
};

async function makeStore(): Promise<MemoryStore> {
  const store = new MemoryStore();
  store.seedUser(
    "teacher@school.test",
    {
      id: "user-active",
      tenantId: TENANT_ID,
      displayName: "Active Teacher",
      status: "active",
      passwordHash: await hashPassword("correct horse battery"),
    },
    { roles: ["org_admin"], scopes: ["discussions:posts:manage"] },
  );
  store.seedUser("invited@school.test", {
    id: "user-invited",
    tenantId: TENANT_ID,
    displayName: "Invited User",
    status: "invited",
    passwordHash: await hashPassword("pending-activation"),
  }, { roles: [], scopes: [] });
  return store;
}

function buildWithStore(store: MemoryStore) {
  let counter = 0;
  return buildApp({
    store,
    resolveTenant: () => tenant,
    now: () => new Date("2030-01-01T00:00:00.000Z"),
    generateId: () => `id-${++counter}`,
  });
}

describe("identity service", () => {
  beforeAll(() => {
    process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/lms_test";
    process.env.JWT_SECRET ??= "test-secret-at-least-16-chars";
  });

  it("GET /health reports the service as ok", async () => {
    const app = buildWithStore(await makeStore());
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().service).toBe("identity");
    await app.close();
  });

  it("logs in with valid credentials and issues a usable access token", async () => {
    const app = buildWithStore(await makeStore());

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "x-tenant-id": TENANT_ID },
      payload: { email: "teacher@school.test", password: "correct horse battery" },
    });
    expect(login.statusCode).toBe(200);
    const body = login.json();
    expect(body.tokenType).toBe("Bearer");
    expect(typeof body.accessToken).toBe("string");
    expect(typeof body.refreshToken).toBe("string");
    expect(body.expiresIn).toBeGreaterThan(0);

    const me = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${body.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    const claims = me.json();
    expect(claims.userId).toBe("user-active");
    expect(claims.tenantId).toBe(TENANT_ID);
    expect(claims.parentTenantId).toBeNull();
    expect(claims.roles).toContain("org_admin");
    expect(claims.scopes).toContain("discussions:posts:manage");

    await app.close();
  });

  it("carries the owning parent tenant in the access token for a sub-tenant", async () => {
    const store = await makeStore();
    const PARENT_ID = "22222222-2222-2222-2222-222222222222";
    store.seedParent(TENANT_ID, PARENT_ID);
    const app = buildWithStore(store);

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "x-tenant-id": TENANT_ID },
      payload: { email: "teacher@school.test", password: "correct horse battery" },
    });
    expect(login.statusCode).toBe(200);

    const me = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${login.json().accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().parentTenantId).toBe(PARENT_ID);

    await app.close();
  });

  it("rejects a wrong password and an unknown user with 401", async () => {
    const app = buildWithStore(await makeStore());

    const wrong = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "x-tenant-id": TENANT_ID },
      payload: { email: "teacher@school.test", password: "nope" },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error).toBe("invalid_credentials");

    const unknown = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "x-tenant-id": TENANT_ID },
      payload: { email: "ghost@school.test", password: "whatever" },
    });
    expect(unknown.statusCode).toBe(401);

    await app.close();
  });

  it("forbids login for a non-active account", async () => {
    const app = buildWithStore(await makeStore());
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "x-tenant-id": TENANT_ID },
      payload: { email: "invited@school.test", password: "pending-activation" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("account_inactive");
    await app.close();
  });

  it("requires tenant context for login", async () => {
    const store = await makeStore();
    const app = buildApp({
      store,
      // Resolver throws when the gateway did not inject a tenant.
      resolveTenant: () => {
        throw new Error("missing x-tenant-id");
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "teacher@school.test", password: "correct horse battery" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("tenant_required");
    await app.close();
  });

  it("rotates refresh tokens and accepts the successor", async () => {
    const app = buildWithStore(await makeStore());
    const login = (
      await app.inject({
        method: "POST",
        url: "/auth/login",
        headers: { "x-tenant-id": TENANT_ID },
        payload: {
          email: "teacher@school.test",
          password: "correct horse battery",
        },
      })
    ).json();

    const refreshed = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: { "x-tenant-id": TENANT_ID },
      payload: { refreshToken: login.refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);
    const next = refreshed.json();
    expect(next.refreshToken).not.toBe(login.refreshToken);

    // The rotated (successor) token still works.
    const again = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: { "x-tenant-id": TENANT_ID },
      payload: { refreshToken: next.refreshToken },
    });
    expect(again.statusCode).toBe(200);

    await app.close();
  });

  it("detects refresh-token reuse and revokes the whole family", async () => {
    const app = buildWithStore(await makeStore());
    const login = (
      await app.inject({
        method: "POST",
        url: "/auth/login",
        headers: { "x-tenant-id": TENANT_ID },
        payload: {
          email: "teacher@school.test",
          password: "correct horse battery",
        },
      })
    ).json();

    const rotated = (
      await app.inject({
        method: "POST",
        url: "/auth/refresh",
        headers: { "x-tenant-id": TENANT_ID },
        payload: { refreshToken: login.refreshToken },
      })
    ).json();

    // Replaying the original (now-revoked) token signals theft.
    const reuse = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: { "x-tenant-id": TENANT_ID },
      payload: { refreshToken: login.refreshToken },
    });
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json().error).toBe("token_reuse_detected");

    // Family revocation means the rotated successor is dead too.
    const successorAfterReuse = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: { "x-tenant-id": TENANT_ID },
      payload: { refreshToken: rotated.refreshToken },
    });
    expect(successorAfterReuse.statusCode).toBe(401);

    await app.close();
  });

  it("logs out by revoking the token family", async () => {
    const app = buildWithStore(await makeStore());
    const login = (
      await app.inject({
        method: "POST",
        url: "/auth/login",
        headers: { "x-tenant-id": TENANT_ID },
        payload: {
          email: "teacher@school.test",
          password: "correct horse battery",
        },
      })
    ).json();

    const logout = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { "x-tenant-id": TENANT_ID },
      payload: { refreshToken: login.refreshToken },
    });
    expect(logout.statusCode).toBe(204);

    const afterLogout = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: { "x-tenant-id": TENANT_ID },
      payload: { refreshToken: login.refreshToken },
    });
    expect(afterLogout.statusCode).toBe(401);

    await app.close();
  });

  it("rejects /auth/me without a valid bearer token", async () => {
    const app = buildWithStore(await makeStore());
    const noHeader = await app.inject({ method: "GET", url: "/auth/me" });
    expect(noHeader.statusCode).toBe(401);

    const bad = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(bad.statusCode).toBe(401);
    await app.close();
  });
});

const OIDC_PROVIDER_ID = "33333333-3333-3333-3333-333333333333";

function seedOidcStore(store: MemoryStore): void {
  store.seedProvider({
    id: OIDC_PROVIDER_ID,
    tenantId: TENANT_ID,
    kind: "oidc",
    displayName: "Test School IdP",
    isEnabled: true,
    config: {
      issuer: "https://idp.test",
      authorizationEndpoint: "https://idp.test/authorize",
      tokenEndpoint: "https://idp.test/token",
      jwksUri: "https://idp.test/jwks",
      clientId: "lms-client",
      redirectUri: "https://lms.test/api/auth/sso/callback",
    },
  });
}

/** Fake exchanger that returns a fixed identity without any network call. */
const fakeExchanger: OidcExchanger = {
  async exchange(_config, params) {
    if (params.code !== "good-code") throw new Error("bad code");
    return {
      subject: "idp-subject-123",
      email: "federated@school.test",
      displayName: "Federated Student",
    };
  },
};

function buildSsoApp(store: MemoryStore, exchanger = fakeExchanger) {
  let counter = 0;
  return buildApp({
    store,
    resolveTenant: () => tenant,
    now: () => new Date("2030-01-01T00:00:00.000Z"),
    generateId: () => `id-${++counter}`,
    oidcExchanger: exchanger,
  });
}

describe("identity SSO (OIDC)", () => {
  beforeAll(() => {
    process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/lms_test";
    process.env.JWT_SECRET ??= "test-secret-at-least-16-chars";
  });

  it("starts the flow with a PKCE authorization URL and signed state", async () => {
    const store = await makeStore();
    seedOidcStore(store);
    const app = buildSsoApp(store);

    const res = await app.inject({
      method: "POST",
      url: `/auth/sso/${OIDC_PROVIDER_ID}/start`,
      headers: { "x-tenant-id": TENANT_ID },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.state).toBe("string");
    const url = new URL(body.authorizationUrl);
    expect(url.origin + url.pathname).toBe("https://idp.test/authorize");
    expect(url.searchParams.get("client_id")).toBe("lms-client");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("state")).toBe(body.state);
    await app.close();
  });

  it("JIT-provisions a user on callback and issues usable tokens", async () => {
    const store = await makeStore();
    seedOidcStore(store);
    const app = buildSsoApp(store);

    const start = (
      await app.inject({
        method: "POST",
        url: `/auth/sso/${OIDC_PROVIDER_ID}/start`,
        headers: { "x-tenant-id": TENANT_ID },
      })
    ).json();

    const cb = await app.inject({
      method: "POST",
      url: `/auth/sso/${OIDC_PROVIDER_ID}/callback`,
      headers: { "x-tenant-id": TENANT_ID },
      payload: { code: "good-code", state: start.state },
    });
    expect(cb.statusCode).toBe(200);
    const tokens = cb.json();
    expect(tokens.tokenType).toBe("Bearer");

    const me = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().roles).toContain("learner");
    await app.close();
  });

  it("links the same external subject to one user across logins", async () => {
    const store = await makeStore();
    seedOidcStore(store);
    const app = buildSsoApp(store);

    async function ssoLogin(): Promise<string> {
      const start = (
        await app.inject({
          method: "POST",
          url: `/auth/sso/${OIDC_PROVIDER_ID}/start`,
          headers: { "x-tenant-id": TENANT_ID },
        })
      ).json();
      const cb = (
        await app.inject({
          method: "POST",
          url: `/auth/sso/${OIDC_PROVIDER_ID}/callback`,
          headers: { "x-tenant-id": TENANT_ID },
          payload: { code: "good-code", state: start.state },
        })
      ).json();
      const me = (
        await app.inject({
          method: "GET",
          url: "/auth/me",
          headers: { authorization: `Bearer ${cb.accessToken}` },
        })
      ).json();
      return me.userId as string;
    }

    expect(await ssoLogin()).toBe(await ssoLogin());
    await app.close();
  });

  it("fails closed on a tampered/invalid state", async () => {
    const store = await makeStore();
    seedOidcStore(store);
    const app = buildSsoApp(store);

    const res = await app.inject({
      method: "POST",
      url: `/auth/sso/${OIDC_PROVIDER_ID}/callback`,
      headers: { "x-tenant-id": TENANT_ID },
      payload: { code: "good-code", state: "not-a-valid-state-token" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("invalid_state");
    await app.close();
  });

  it("fails closed when the IdP token exchange fails", async () => {
    const store = await makeStore();
    seedOidcStore(store);
    const app = buildSsoApp(store);

    const start = (
      await app.inject({
        method: "POST",
        url: `/auth/sso/${OIDC_PROVIDER_ID}/start`,
        headers: { "x-tenant-id": TENANT_ID },
      })
    ).json();
    const cb = await app.inject({
      method: "POST",
      url: `/auth/sso/${OIDC_PROVIDER_ID}/callback`,
      headers: { "x-tenant-id": TENANT_ID },
      payload: { code: "bad-code", state: start.state },
    });
    expect(cb.statusCode).toBe(401);
    expect(cb.json().error).toBe("sso_exchange_failed");
    await app.close();
  });

  it("404s an unknown or disabled provider", async () => {
    const store = await makeStore();
    const app = buildSsoApp(store);
    const res = await app.inject({
      method: "POST",
      url: `/auth/sso/${OIDC_PROVIDER_ID}/start`,
      headers: { "x-tenant-id": TENANT_ID },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("fails closed when the provider config is incomplete", async () => {
    const store = await makeStore();
    store.seedProvider({
      id: OIDC_PROVIDER_ID,
      tenantId: TENANT_ID,
      kind: "oidc",
      displayName: "Broken IdP",
      isEnabled: true,
      config: { clientId: "only-client-id" },
    });
    const app = buildSsoApp(store);
    const res = await app.inject({
      method: "POST",
      url: `/auth/sso/${OIDC_PROVIDER_ID}/start`,
      headers: { "x-tenant-id": TENANT_ID },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("provider_misconfigured");
    await app.close();
  });
});
