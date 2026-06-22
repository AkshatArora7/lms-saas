import { verifyAccessToken } from "@lms/auth";
import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import {
  CLAIM,
  LTI_VERSION,
  MSG_TYPE_RESOURCE_LINK,
  type Clock,
  type JwksResolver,
  type JwksResolverFactory,
} from "./lti.js";
import { buildApp } from "./main.js";
import { MemoryLtiStore } from "./store.memory.js";

const JWT_SECRET = "test-secret-at-least-16-chars-long";
const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT = "22222222-2222-2222-2222-222222222222";
const ISSUER = "https://platform.school.edu";
const CLIENT_ID = "client-abc";
const JWKS_URL = "https://platform.school.edu/.well-known/jwks.json";
const DEPLOYMENT_ID = "dep-1";
const KID = "test-key-1";

const config = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
  JWT_SECRET,
  JWT_AUDIENCE: "lms-api",
} as unknown as AppConfig;

// Fixed clock so id_token exp/iat are deterministic.
const FIXED_NOW = new Date("2026-06-22T12:00:00.000Z");
const clockState = { now: FIXED_NOW };
const clock: Clock = () => clockState.now;

let privateKey: CryptoKey;
let publicJwk: JWK;
let jwksFactory: JwksResolverFactory;

beforeAll(async () => {
  const kp = await generateKeyPair("RS256");
  privateKey = kp.privateKey;
  publicJwk = { ...(await exportJWK(kp.publicKey)), kid: KID, alg: "RS256" };
  const localKeyset = createLocalJWKSet({ keys: [publicJwk] });
  jwksFactory = {
    forJwksUrl(): JwksResolver {
      return localKeyset as unknown as JwksResolver;
    },
  };
});

function resolveTenant(req: FastifyRequest): TenantContext {
  const tenantId = req.headers["x-tenant-id"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("missing x-tenant-id");
  }
  return { tenantId, tier: "pool", databaseUrl: config.DATABASE_URL };
}

function makeStore(): MemoryLtiStore {
  const store = new MemoryLtiStore(clock);
  const reg = store.seedRegistration(TENANT_ID, {
    issuer: ISSUER,
    clientId: CLIENT_ID,
    authLoginUrl: `${ISSUER}/auth`,
    authTokenUrl: `${ISSUER}/token`,
    jwksUrl: JWKS_URL,
    role: "platform",
  });
  store.seedDeployment(TENANT_ID, reg.id, DEPLOYMENT_ID);
  return store;
}

function build(store: MemoryLtiStore) {
  return buildApp({
    config,
    resolveTenant,
    store,
    jwksFactory,
    clock,
    publicBaseUrl: "https://lti.lms.test",
    launchBaseUrl: "https://app.lms.test",
  });
}

interface IdTokenOverrides {
  nonce?: string;
  audience?: string;
  issuer?: string;
  deploymentId?: string;
  expiresInSeconds?: number;
  tamper?: boolean;
  messageType?: string;
}

async function mintIdToken(o: IdTokenOverrides = {}): Promise<string> {
  const iat = Math.floor(clock().getTime() / 1000);
  const exp = iat + (o.expiresInSeconds ?? 300);
  const jwt = await new SignJWT({
    nonce: o.nonce ?? "set-below",
    [CLAIM.version]: LTI_VERSION,
    [CLAIM.messageType]: o.messageType ?? MSG_TYPE_RESOURCE_LINK,
    [CLAIM.deploymentId]: o.deploymentId ?? DEPLOYMENT_ID,
    [CLAIM.roles]: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"],
    [CLAIM.resourceLink]: { id: "rl-1", title: "Week 1" },
    [CLAIM.context]: { id: "ctx-1", title: "Biology 101" },
    [CLAIM.targetLinkUri]: "https://app.lms.test/course/1",
  })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setSubject("user-1")
    .setIssuer(o.issuer ?? ISSUER)
    .setAudience(o.audience ?? CLIENT_ID)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(privateKey);
  const token = jwt;
  if (o.tamper) {
    // Flip the FIRST char of the signature segment. The final base64url char of
    // a 256-byte RS256 signature encodes only 2 significant bits, so flipping it
    // (e.g. A↔B) can decode to byte-identical signature bytes and NOT actually
    // tamper the token — the high-order first char always changes the bytes.
    const parts = token.split(".");
    const sig = parts[2]!;
    parts[2] = (sig.startsWith("A") ? "B" : "A") + sig.slice(1);
    return parts.join(".");
  }
  return token;
}

const H = { "x-tenant-id": TENANT_ID };
const FORM = "application/x-www-form-urlencoded";

function form(body: Record<string, string>): string {
  return new URLSearchParams(body).toString();
}

/** Drive /lti/login, returning the persisted state+nonce from the store. */
async function login(
  app: ReturnType<typeof build>,
  store: MemoryLtiStore,
  headers: Record<string, string> = H,
) {
  const res = await app.inject({
    method: "GET",
    url: `/lti/login?iss=${encodeURIComponent(ISSUER)}&client_id=${CLIENT_ID}&login_hint=lh&target_link_uri=${encodeURIComponent("https://app.lms.test/course/1")}`,
    headers,
  });
  // Pull state+nonce out of the redirect location.
  const loc = res.headers.location as string | undefined;
  const url = loc ? new URL(loc) : undefined;
  const state = url?.searchParams.get("state") ?? undefined;
  const nonce = url?.searchParams.get("nonce") ?? undefined;
  return { res, state, nonce, store };
}

describe("LTI 1.3 launch routes (#10)", () => {
  it("health still reports ok (embed wiring intact)", async () => {
    const res = await build(makeStore()).inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().service).toBe("lti");
  });

  it("(a) /lti/login redirects with state+nonce and persists a launch session", async () => {
    const store = makeStore();
    const app = build(store);
    const { res, state, nonce } = await login(app, store);
    expect(res.statusCode).toBe(302);
    const loc = new URL(res.headers.location as string);
    expect(loc.origin + loc.pathname).toBe(`${ISSUER}/auth`);
    expect(loc.searchParams.get("response_type")).toBe("id_token");
    expect(loc.searchParams.get("response_mode")).toBe("form_post");
    expect(loc.searchParams.get("redirect_uri")).toBe("https://lti.lms.test/lti/launch");
    expect(state).toBeTruthy();
    expect(nonce).toBeTruthy();
    // Persisted + consumable.
    const ctx = { tenantId: TENANT_ID, tier: "pool" as const, databaseUrl: "" };
    const session = await store.consumeLaunchSession(ctx, state!);
    expect(session?.nonce).toBe(nonce);
  });

  it("/lti/login 404s for an unknown (iss, client_id)", async () => {
    const app = build(makeStore());
    const res = await app.inject({
      method: "GET",
      url: `/lti/login?iss=${encodeURIComponent("https://evil.test")}&client_id=x`,
      headers: H,
    });
    expect(res.statusCode).toBe(404);
  });

  it("(b) full /lti/launch SUCCESS mints a session cookie + 302", async () => {
    const store = makeStore();
    const app = build(store);
    const { state, nonce } = await login(app, store);
    const idToken = await mintIdToken({ nonce: nonce! });
    const res = await app.inject({
      method: "POST",
      url: "/lti/launch",
      headers: { ...H, "content-type": FORM },
      payload: form({ id_token: idToken, state: state! }),
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("https://app.lms.test/course/1");
    const setCookie = res.headers["set-cookie"] as string;
    expect(setCookie).toContain("lms_session=");
    expect(setCookie).toContain("HttpOnly");
    // Token is in the cookie, NOT the URL.
    expect(res.headers.location).not.toContain("lms_session");
    const token = setCookie.split("lms_session=")[1]!.split(";")[0]!;
    const claims = await verifyAccessToken(token, { secret: JWT_SECRET, audience: "lms-api" });
    expect(claims.sub).toBe("user-1");
    expect(claims.tenantId).toBe(TENANT_ID);
    expect(claims.roles).toEqual(["instructor"]);
  });

  it("(c) rejects a TAMPERED signature (401)", async () => {
    const store = makeStore();
    const app = build(store);
    const { state, nonce } = await login(app, store);
    const idToken = await mintIdToken({ nonce: nonce!, tamper: true });
    const res = await app.inject({
      method: "POST",
      url: "/lti/launch",
      headers: { ...H, "content-type": FORM },
      payload: form({ id_token: idToken, state: state! }),
    });
    expect(res.statusCode).toBe(401);
  });

  it("(d) rejects an EXPIRED id_token (401)", async () => {
    const store = makeStore();
    const app = build(store);
    const { state, nonce } = await login(app, store);
    const idToken = await mintIdToken({ nonce: nonce!, expiresInSeconds: 60 });
    // Advance the clock past the id_token's exp (but the launch session ttl is 600s).
    clockState.now = new Date(FIXED_NOW.getTime() + 120 * 1000);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/lti/launch",
        headers: { ...H, "content-type": FORM },
        payload: form({ id_token: idToken, state: state! }),
      });
      expect(res.statusCode).toBe(401);
    } finally {
      clockState.now = FIXED_NOW;
    }
  });

  it("(e) rejects a bad audience (401)", async () => {
    const store = makeStore();
    const app = build(store);
    const { state, nonce } = await login(app, store);
    const idToken = await mintIdToken({ nonce: nonce!, audience: "someone-else" });
    const res = await app.inject({
      method: "POST",
      url: "/lti/launch",
      headers: { ...H, "content-type": FORM },
      payload: form({ id_token: idToken, state: state! }),
    });
    expect(res.statusCode).toBe(401);
  });

  it("(f) rejects NONCE REPLAY — a second launch with the same state is 401", async () => {
    const store = makeStore();
    const app = build(store);
    const { state, nonce } = await login(app, store);
    const idToken = await mintIdToken({ nonce: nonce! });
    const first = await app.inject({
      method: "POST",
      url: "/lti/launch",
      headers: { ...H, "content-type": FORM },
      payload: form({ id_token: idToken, state: state! }),
    });
    expect(first.statusCode).toBe(302);
    const second = await app.inject({
      method: "POST",
      url: "/lti/launch",
      headers: { ...H, "content-type": FORM },
      payload: form({ id_token: idToken, state: state! }),
    });
    expect(second.statusCode).toBe(401);
  });

  it("(g) rejects an unknown deployment_id (401)", async () => {
    const store = makeStore();
    const app = build(store);
    const { state, nonce } = await login(app, store);
    const idToken = await mintIdToken({ nonce: nonce!, deploymentId: "ghost" });
    const res = await app.inject({
      method: "POST",
      url: "/lti/launch",
      headers: { ...H, "content-type": FORM },
      payload: form({ id_token: idToken, state: state! }),
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a wrong message_type (401)", async () => {
    const store = makeStore();
    const app = build(store);
    const { state, nonce } = await login(app, store);
    const idToken = await mintIdToken({ nonce: nonce!, messageType: "LtiDeepLinkingRequest" });
    const res = await app.inject({
      method: "POST",
      url: "/lti/launch",
      headers: { ...H, "content-type": FORM },
      payload: form({ id_token: idToken, state: state! }),
    });
    expect(res.statusCode).toBe(401);
  });

  it("/lti/launch 401s for an unknown/forged state", async () => {
    const app = build(makeStore());
    const idToken = await mintIdToken({ nonce: "x" });
    const res = await app.inject({
      method: "POST",
      url: "/lti/launch",
      headers: { ...H, "content-type": FORM },
      payload: form({ id_token: idToken, state: "never-issued" }),
    });
    expect(res.statusCode).toBe(401);
  });

  it("/lti/launch 400s when id_token or state is missing, 400 when tenant missing", async () => {
    const app = build(makeStore());
    const missing = await app.inject({
      method: "POST",
      url: "/lti/launch",
      headers: { ...H, "content-type": FORM },
      payload: form({ state: "s" }),
    });
    expect(missing.statusCode).toBe(400);
    const noTenant = await app.inject({
      method: "POST",
      url: "/lti/launch",
      headers: { "content-type": FORM },
      payload: form({ id_token: "x", state: "s" }),
    });
    expect(noTenant.statusCode).toBe(400);
  });

  it("tenant isolation: another tenant cannot consume this tenant's state", async () => {
    const store = makeStore();
    const app = build(store);
    const { state, nonce } = await login(app, store);
    const idToken = await mintIdToken({ nonce: nonce! });
    // Same state, but a DIFFERENT tenant header → no row visible → 401.
    const res = await app.inject({
      method: "POST",
      url: "/lti/launch",
      headers: { "x-tenant-id": OTHER_TENANT, "content-type": FORM },
      payload: form({ id_token: idToken, state: state! }),
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /lti/registrations creates a tenant-scoped registration", async () => {
    const app = build(new MemoryLtiStore(clock));
    const res = await app.inject({
      method: "POST",
      url: "/lti/registrations",
      headers: { ...H, "content-type": "application/json" },
      payload: {
        issuer: "https://new.platform.edu",
        clientId: "c2",
        authLoginUrl: "https://new.platform.edu/auth",
        authTokenUrl: "https://new.platform.edu/token",
        jwksUrl: "https://new.platform.edu/jwks",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().registration.issuer).toBe("https://new.platform.edu");
    // Validation failure.
    const bad = await app.inject({
      method: "POST",
      url: "/lti/registrations",
      headers: { ...H, "content-type": "application/json" },
      payload: { issuer: "x" },
    });
    expect(bad.statusCode).toBe(400);
  });
});
