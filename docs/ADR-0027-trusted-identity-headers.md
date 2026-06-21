# ADR-0027 — Gateway-stamped trusted caller identity headers (`x-user-id` / `x-user-roles`)

- **Status:** Accepted · 2026-06-21
- **Issue:** #284 — feat(analytics): per-course authorization on `GET /reports/engagement` (follow-up of #277 / #283)
- **Owning scope:** `services/gateway` (trust boundary), backend services (consumers), `apps/web` BFF — docs
- **Author:** Architect agent (recorded by docs-agent)

## Context

Backend services in this mesh are **tenant-scoped** by Postgres RLS: the gateway
authenticates the JWT and forwards a **trusted `x-tenant-id`** downstream, every
service wraps its reads in `@lms/db.withTenant()`, and the runtime `app_user`
role cannot bypass `FORCE ROW LEVEL SECURITY` (see
[ADR-0026](ADR-0026-runtime-app-role-rls-enforcement.md) and
[MULTI_TENANCY.md](MULTI_TENANCY.md)). That confines every read to the caller's
own tenant.

What the services did **not** have is a *trusted caller identity*. RLS answers
"which tenant?" but not "is **this user** allowed to read **this resource?**".
Until #284 the verified access-token claims — `AccessTokenClaims { sub, tenantId,
roles }` (`packages/auth/src/index.ts:29-39`) — were terminated at the gateway,
which forwarded only `x-tenant-id` (`services/gateway/src/auth.ts`,
`services/gateway/src/proxy.ts`). A service therefore could not safely answer a
per-resource authorization question on its own.

The trigger was analytics engagement: `GET /reports/engagement?courseId=…`
returned a course's engagement to **any** authenticated caller in the tenant,
because teacher scoping had been treated as a pure BFF concern (#277 →
[ADR-0025](ADR-0025-engagement-live-compute.md)). #283/#284 require the service
to enforce **teacher-owns-course** authorization *itself*, as defence in depth,
which needs a trustworthy `userId` + `roles` at the service boundary. A client
header cannot be trusted for this — it can be spoofed — so a platform-level
contract for trusted identity transport is required.

## Decision

Introduce a single, platform-wide contract for trusted caller identity,
**mirroring the existing `x-tenant-id` pattern**:

1. **The gateway is the only trust boundary.** On every authenticated request the
   gateway stamps two headers from the **verified** access-token claims:
   - `x-user-id` = `claims.sub`
   - `x-user-roles` = `claims.roles.join(",")` (comma-separated, no spaces)

   (`services/gateway/src/auth.ts`.)

2. **Client-supplied copies are stripped first (anti-spoof).** The reverse proxy
   adds `x-user-id` and `x-user-roles` to `STRIP_REQUEST_HEADERS` and then
   **re-stamps** them from `req.claims`, exactly as it already does for
   `x-tenant-id` (`services/gateway/src/proxy.ts`). A client can never inject or
   override its own identity; a spoofed inbound `x-user-id` is overwritten by the
   token's subject (proven by `services/gateway/src/main.test.ts`).

3. **Services treat these headers as trusted ONLY because the gateway guarantees
   them.** A service reads `x-user-id`/`x-user-roles` to identify the caller and
   layers per-resource authorization **on top of** RLS — never replacing it. The
   first consumer is analytics: `teachesCourse` (an RLS-scoped enrollment lookup
   inside `withTenant`) plus the pure `isCourseReadAuthorized({roles, teaches})`
   gate. Missing `x-user-id` ⇒ **401** (fail closed).

4. **The web BFF forwards the same headers when it calls a service directly.**
   The `/teach` BFF holds the httpOnly server session and calls analytics
   directly (not via the gateway), so it forwards `x-user-id` (= `session.userId`)
   and `x-user-roles` (= `session.roles.join(",")`) alongside `x-tenant-id`
   (`apps/web/app/lib/analytics-api.ts`). The join format **must stay identical**
   to the gateway's so both callers present the same identity.

5. **Not-authorized returns `403`, not `404`.** RLS already confines every
   visible course to the caller's tenant, so "exists in my tenant" is not a
   meaningful leak; `403` is the honest semantic (authenticated + tenant-scoped
   but not authorized for this resource) and matches the gateway's existing
   `requireScope` 403. Enumeration is closed by construction: a non-existent
   `courseId` and an exists-but-not-taught `courseId` both yield the same 403, so
   there is no existence-disclosure differential.

## Consequences

- **Per-resource authorization becomes possible across all services** as
  defence in depth — services can now answer "is this user allowed?" without an
  extra network hop to identity, using their own RLS-scoped data and the trusted
  identity headers. Analytics engagement (`GET /reports/engagement`) is the first
  consumer: it allows teacher-owns-course, tenant-wide `super_admin`, or
  org-unit-scoped `org_admin` (administered subtree via `org_unit.path` +
  `role_assignment.cascade`) — #284, refined #294.
- **Explicit trust assumption:** a service trusts `x-user-id`/`x-user-roles`
  **only** because they arrive via the gateway (or the trusted web BFF on the
  internal network). This is the **same** trust model already in force for
  `x-tenant-id` and predates #284. **In production, domain services MUST be
  internal-only** — not reachable by untrusted clients — otherwise a direct
  caller could self-stamp identity headers and bypass the gateway. The dev
  `docker-compose` host port publishing (`40xx`) is a dev-only convenience; see
  the **deployment-hardening follow-up** and
  [DEPLOYMENT.md](DEPLOYMENT.md#services-on-a-container-host).
- **One format, two stampers — keep them consistent.** The roles header is
  comma-separated with no spaces; the gateway (`claims.roles.join(",")`) and the
  BFF (`session.roles.join(",")`) must stay byte-identical, and any service that
  parses it splits on `,`. Empty roles ⇒ empty string (never `"undefined"`).
- **RLS is never weakened.** The authorization gate is layered strictly on top:
  the `teachesCourse` lookup and the engagement read both run inside
  `withTenant`, so a cross-tenant admin still sees an empty result. RLS remains
  the sacred boundary; identity headers add a second, finer layer.
- **401 fail-closed** on a missing `x-user-id` means a misconfigured or
  un-proxied call is rejected rather than served, which is the safe default.

## Alternatives considered

- **(A) Keep authorization purely in the BFF** — rejected: it leaves the service
  open to any authenticated tenant caller that reaches it directly (no defence in
  depth), which is exactly the gap #284 closes.
- **(B) Have each service call identity (`/authz/check`) per request** — rejected
  for this slice: it adds a network hop and coupling, and identity's check is
  permission@org-unit, not "teaches this course". The trusted-source enrollment
  lookup is local, RLS-scoped, and uses existing indexes.
- **(C) Pass the raw JWT downstream and re-verify per service** — rejected: it
  spreads the trust boundary and JWKS/verification logic across every service.
  Centralizing verification at the gateway and forwarding minimal trusted headers
  keeps a single trust boundary, mirroring `x-tenant-id`.
