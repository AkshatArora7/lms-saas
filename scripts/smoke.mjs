#!/usr/bin/env node
// Full-stack smoke check (issue #344). Run AFTER the mesh is up
// (`pnpm start` or `pnpm start:build`) to prove it actually works end-to-end:
//
//   1. every NEEDED service's /health returns 200 (probed on its published host
//      port — the canonical compose publishes each service on its own 40xx port);
//   2. ONE authenticated gateway round-trip succeeds: demo login at the identity
//      service issues a bearer token, and a protected gateway route accepts it;
//   3. the web and admin apps' `/` return < 500.
//
// Pure Node (global fetch, Node >= 20) — no extra deps, cross-platform. Logs each
// check PASS/FAIL and exits non-zero on ANY failure, 0 when everything passes.
//
// Overridable via env: GATEWAY_URL, WEB_URL, ADMIN_URL, IDENTITY_URL, SMOKE_HOST,
// SMOKE_TENANT_ID, SMOKE_EMAIL, SMOKE_PASSWORD, SMOKE_TIMEOUT_MS.

const HOST = process.env.SMOKE_HOST ?? "localhost";
const GATEWAY_URL = process.env.GATEWAY_URL ?? `http://${HOST}:4000`;
const WEB_URL = process.env.WEB_URL ?? `http://${HOST}:3000`;
const ADMIN_URL = process.env.ADMIN_URL ?? `http://${HOST}:3001`;
const IDENTITY_URL = process.env.IDENTITY_URL ?? `http://${HOST}:4001`;

// Demo tenant + accounts seeded by the `seed` service (packages/db/prisma/seed.demo.ts).
const TENANT_ID =
  process.env.SMOKE_TENANT_ID ?? "11111111-1111-1111-1111-111111111111";
const EMAIL = process.env.SMOKE_EMAIL ?? "admin@demo.school";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "password123";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 5000);

// NEEDED services that expose an HTTP /health, with their published host port.
// (relay (4026) is a worker but still runs a Fastify /health liveness endpoint.)
const HEALTH_SERVICES = [
  ["gateway", 4000],
  ["identity", 4001],
  ["tenant", 4002],
  ["user-org", 4003],
  ["enrollment", 4004],
  ["course", 4005],
  ["content", 4006],
  ["assignment", 4007],
  ["grading", 4009],
  ["discussion", 4010],
  ["announcement", 4011],
  ["notification", 4012],
  ["calendar", 4013],
  ["analytics", 4015],
  ["attendance", 4025],
  ["relay", 4026],
];

let failures = 0;

function pass(name, detail) {
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, detail) {
  failures += 1;
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

/** fetch with a hard timeout so a refused/hung connection fails fast & cleanly. */
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function describeError(err) {
  if (err?.name === "AbortError") return `timeout after ${TIMEOUT_MS}ms`;
  return err?.cause?.code ?? err?.code ?? err?.message ?? String(err);
}

async function checkHealth(name, port) {
  const url = `http://${HOST}:${port}/health`;
  try {
    const res = await fetchWithTimeout(url);
    if (res.status === 200) pass(`health ${name}`, url);
    else fail(`health ${name}`, `${url} → ${res.status}`);
  } catch (err) {
    fail(`health ${name}`, `${url} → ${describeError(err)}`);
  }
}

async function checkPageUnder500(name, url) {
  try {
    const res = await fetchWithTimeout(url, { redirect: "manual" });
    if (res.status < 500) pass(`page ${name}`, `${url} → ${res.status}`);
    else fail(`page ${name}`, `${url} → ${res.status}`);
  } catch (err) {
    fail(`page ${name}`, `${url} → ${describeError(err)}`);
  }
}

/** Authenticated gateway round-trip: demo login → call a protected gateway route. */
async function checkAuthRoundTrip() {
  let token;
  const loginUrl = `${IDENTITY_URL}/auth/login`;
  try {
    const res = await fetchWithTimeout(loginUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": TENANT_ID,
      },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    if (res.status !== 200) {
      fail("auth login", `${loginUrl} → ${res.status}`);
      return;
    }
    const body = await res.json();
    token = body?.accessToken;
    if (typeof token !== "string" || token.length === 0) {
      fail("auth login", "no accessToken in response");
      return;
    }
    pass("auth login", `${loginUrl} → 200 (token issued)`);
  } catch (err) {
    fail("auth login", `${loginUrl} → ${describeError(err)}`);
    return;
  }

  // Protected gateway route: /whoami echoes the gateway-resolved identity and is
  // gated by the same authGuard that protects every /api/:service/* proxy route.
  const protectedUrl = `${GATEWAY_URL}/whoami`;
  try {
    const res = await fetchWithTimeout(protectedUrl, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.status >= 200 && res.status < 300) {
      pass("auth gateway round-trip", `${protectedUrl} → ${res.status}`);
    } else {
      fail("auth gateway round-trip", `${protectedUrl} → ${res.status}`);
    }
  } catch (err) {
    fail("auth gateway round-trip", `${protectedUrl} → ${describeError(err)}`);
  }
}

async function main() {
  console.log("LMS full-stack smoke check");
  console.log(
    `  gateway=${GATEWAY_URL}  web=${WEB_URL}  admin=${ADMIN_URL}  identity=${IDENTITY_URL}`,
  );
  console.log("");

  for (const [name, port] of HEALTH_SERVICES) {
    // sequential so the log reads top-to-bottom; each has its own timeout.
    // eslint-disable-next-line no-await-in-loop
    await checkHealth(name, port);
  }

  console.log("");
  await checkAuthRoundTrip();

  console.log("");
  await checkPageUnder500("web", `${WEB_URL}/`);
  await checkPageUnder500("admin", `${ADMIN_URL}/`);

  console.log("");
  if (failures > 0) {
    console.error(`SMOKE FAILED — ${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("SMOKE PASSED — all checks green.");
  process.exit(0);
}

main().catch((err) => {
  console.error("SMOKE CRASHED —", err);
  process.exit(1);
});
