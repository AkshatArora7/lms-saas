# Spike #15 — Evaluate LTI Dynamic Registration for self-serve setup

- **Status:** Complete · 2026-06-23 · **Recommendation: DEFER (partial-adopt later)**
- **Issue:** [#15](https://github.com/AkshatArora7/lms-saas/issues/15) — Evaluate LTI Dynamic Registration for self-serve setup (SPIKE)
- **Branch:** `spike/lti-dynamic-registration`
- **Scope:** Research / recommendation only. **No service or schema code changes.**
- **Owning scope:** `services/lti` (assessment), `docs/spikes` (this document)
- **Author:** Architect agent assessment, recorded by docs-agent

> This is the authoritative spike write-up a reviewer and PM can act on. It is
> grounded in the actual `services/lti` code and `database/schema.sql`, with
> `file:line` citations. The three issue acceptance criteria are mapped in
> [§7](#7-acceptance-criteria-mapping).

## Question

Does the 1EdTech **LTI Dynamic Registration (DR)** handshake meaningfully reduce
the per-school onboarding effort we incur today with manual platform
registration, and how would it fit our multi-tenant model? Deliver the flow, the
risks, and a recommendation with an effort estimate and the follow-up stories it
would spawn.

---

## 1. Context — what we have today

We shipped LTI 1.3 Resource Link launch in #10. In that model **we are the Tool,
not the Platform** for launches: a school's portal (the Platform) initiates an
OIDC third-party login at `GET|POST /lti/login`; we redirect to the platform's
auth endpoint; the platform `form_post`s a signed `id_token` to `POST
/lti/launch`, which we **verify against the platform's JWKS**
(`createRemoteJWKSet(jwks_url)`, `services/lti/src/main.ts:51-63`;
`services/lti/src/lti.routes.ts:175-186`).

A naming correction the rest of this doc honors: the real tables are
**`lti_registration`** (`database/schema.sql:739`) and **`lti_deployment`**
(`database/schema.sql:753`). There is **no `lti_platform` table.**

**Today onboarding a school is a two-step manual process:**

1. **Register the platform via one tenant-scoped admin endpoint.** `POST
   /lti/registrations` (`services/lti/src/lti.routes.ts:247-292`) requires the
   admin to supply, by hand, exactly five fields plus an optional role:
   `issuer`, `clientId`, `authLoginUrl`, `authTokenUrl`, `jwksUrl`, and `role`
   (`'platform'|'tool'`, default `'platform'`). It is persisted to
   `lti_registration` (`services/lti/src/store.prisma.ts:195-216`) — columns
   `issuer, client_id, auth_login_url, auth_token_url, jwks_url, role` with a
   **global** `UNIQUE (issuer, client_id)` (`database/schema.sql:750`).

2. **Insert the deployment row out of band.** There is **no
   create-deployment endpoint.** The launch only *reads* `lti_deployment` via
   `getDeployment` (`services/lti/src/lti.routes.ts:196-203`;
   `services/lti/src/store.prisma.ts:129-149`) to confirm the launch's
   `deployment_id` claim belongs to the registration. So someone (admin/DBA)
   must directly insert one or more `lti_deployment` rows, tying a
   `deployment_id` to an optional `org_unit_id` (`database/schema.sql:753-760`).

**Key facts that shape everything below:**

- **We publish no tool-side keys.** There is no tool keypair, no
  `/.well-known/jwks.json` that we host, and no signing key in schema or config.
  Confirmed by search — the only `.well-known/jwks.json` reference in the service
  is a *platform* JWKS URL in a test (`services/lti/src/lti.routes.test.ts:30`).
  We are purely a **JWKS consumer.**
- **Tenant context comes from the verified session at the gateway.** The gateway
  derives tenant from the authenticated session JWT and stamps/overwrites
  `x-tenant-id` downstream — a client-supplied `x-tenant-id` is always
  overwritten (`services/gateway/src/auth.ts:91`,
  `services/gateway/src/proxy.ts:84`). The lti service trusts that header via
  `headerTenantResolver` (`services/lti/src/main.ts:70-84`) and runs every store
  method through `withTenant`, so Postgres RLS scopes by `app.tenant_id` (RLS
  policy on `lti_registration`/`lti_deployment` at
  `database/policies/rls.sql:28,52-56`).

---

## 2. What LTI Dynamic Registration is

LTI Dynamic Registration is a self-serve registration handshake =
**OpenID Connect Dynamic Client Registration (RFC 7591)** plus
**1EdTech LTI extensions**. With us as the **Tool**, the flow is:

1. **Registration initiation.** A platform admin pastes *our initiation URL*
   into their LMS. The platform GETs that URL with two query parameters:
   `?openid_configuration=<platform_config_url>&registration_token=<one-time bearer>`.
2. **Tool fetches the platform's OpenID configuration.** We GET the
   `openid_configuration` URL and learn the platform's `issuer`,
   `authorization_endpoint` (≈ our `auth_login_url`), `token_endpoint` (≈
   `auth_token_url`), `jwks_uri` (≈ `jwks_url`), the platform's
   `registration_endpoint`, and its LTI capabilities.
3. **Tool POSTs a client registration** to the platform's
   `registration_endpoint`, authenticating with the `registration_token` as a
   bearer. The body is *our* tool configuration: tool name, our OIDC
   `initiate_login_uri`, our `redirect_uris` (our `/lti/launch`), **our
   `jwks_uri`**, the LTI message types / claims / scopes we want,
   `target_link_uri`, logo, etc.
4. **Platform returns a registration response** containing the minted
   **`client_id`** and a **`deployment_id`** (under
   `https://purl.imsglobal.org/spec/lti-tool-configuration`).
5. **Activation.** The tool shows a "registration complete — you may close this
   window" page (`postMessage` `org.imsglobal.lti.close`); the platform admin
   flips the deployment to active. No further human data entry.

The critical structural consequence: **step 3 requires us to expose our own
`jwks_uri`.** DR makes us a JWKS *publisher*, not just a consumer.

---

## 3. How it maps onto our `lti` service + tenant model

### New endpoints we (the Tool) would add

- **`GET /.well-known/jwks.json` — net-new.** Publish our tool public keys. DR
  fundamentally requires us to become a JWKS publisher. This forces tool key
  generation + storage + rotation — none of which exists today (we hold no
  private keys).
- **A DR initiation/registration endpoint** (e.g. `GET
  /lti/dynamic-registration`) — receives `openid_configuration` +
  `registration_token`, fetches the platform config, builds the tool config,
  POSTs the client registration, then persists the result.

### What it would auto-write

On a successful handshake, the endpoint **automatically** writes:

- an **`lti_registration`** row — `issuer`, `client_id` (the minted one),
  `auth_login_url` = the platform's `authorization_endpoint`, `auth_token_url`
  = its `token_endpoint`, `jwks_url` = its `jwks_uri`, `role`; and
- an **`lti_deployment`** row — the `deployment_id` returned by the platform.

This **replaces both** manual steps from §1: the hand-entered `POST
/lti/registrations` body (5 fields) **and** the out-of-band `lti_deployment`
insert both become automatic outputs of the handshake. The admin's only manual
act becomes "generate a registration link, send it to the school."

### The hard part — tenant binding

A DR initiation request arrives from an **external platform that has no LMS
session.** That means the gateway has **no token to derive `x-tenant-id` from**
(`services/gateway/src/auth.ts:91` cannot fire). The tenant must therefore be
carried by the **initiation URL itself.** Options considered:

| Option | Mechanism | Assessment |
| --- | --- | --- |
| (a) Per-tenant subdomain | `{tenant}.lms.example/lti/dynamic-registration`, resolved by Host header | Workable; ops/DNS/cert overhead per tenant |
| (b) **Pre-issued, tenant-scoped, single-use registration token** embedded in the initiation URL | The token *is* the tenant binding and the anti-spoofing control | **Recommended (primary)** |
| (c) Tenant slug path segment | `/lti/dr/{slug}` | **Weakest — guessable; rejected** |

**Recommended design: (b) as primary**, optionally combined with (a). We mint a
signed/opaque single-use token in the admin UI and embed it in the initiation
URL the admin copies. The token resolves to exactly one tenant; consuming it is
the tenant binding.

> **Two different tokens — do not conflate them.**
> - **Our tenant-scoped registration token** is *ours*. It gates **who may
>   register against a given tenant** of ours, and carries the tenant binding.
> - **The platform's `registration_token`** (RFC 7591) authenticates **us to the
>   platform** during the client-registration POST. It is issued and expired by
>   the platform; we can only consume it.

**Net-new state this requires:** a `lti_registration_token` table
(`tenant_id`, token hash, `expires_at`, `consumed_at`) mirroring the existing
single-use / expiry / atomic-burn pattern of `lti_launch_session`
(`database/schema.sql:766-778`). (Schema change deferred to a follow-up story —
**not part of this spike.**)

---

## 4. Security / trust risks

- **Open / unauthenticated registration endpoint — the headline risk.** Without
  our own token gate, anyone could self-register against a tenant. Our
  tenant-scoped token (§3-b) is **mandatory** mitigation; it must be **single-use
  with a short TTL**, reusing the `lti_launch_session` atomic-burn pattern
  (`UPDATE ... SET consumed_at = now() WHERE consumed_at IS NULL AND expires_at >
  now() RETURNING`).
- **Tenant spoofing / wrong-tenant binding.** A school binding to the wrong
  tenant, or a token leaking. The token must encode exactly one tenant, be
  unguessable, and have its issuance/consumption **rate-limited and audited**
  (`audit_log` is already RLS-scoped).
- **Tool key management & rotation — genuinely net-new and the single biggest new
  operational surface.** Today we hold no private keys. DR makes us a JWKS
  publisher: generate RSA/EC keypair(s), store private material in a **secret
  manager (never plaintext in `lti_registration`)**, publish a rotating public
  JWKS, and support **key overlap during rotation** so in-flight verifications
  don't break.
- **SSRF when fetching platform config.** The `openid_configuration` URL is
  **attacker-controllable input.** Fetching it blindly is an SSRF vector
  (internal metadata endpoints, internal services). We must allowlist / validate
  the config URL, restrict egress, set timeouts, and **not blindly trust** the
  endpoints the config returns.
- **Registration-token issuance & expiry are partly implementation-defined.**
  The platform's `registration_token` format and lifetime are defined by the
  platform side (1EdTech leaves details implementation-defined); we must handle
  one-shot use and clock skew on our side.
- **Global `UNIQUE (issuer, client_id)`** (`database/schema.sql:750`) would break
  if two tenants registered the same platform with the same `client_id`. In
  practice DR mints a *new* `client_id` per registration so collisions are
  unlikely, but a schema-agent should consider widening this to `UNIQUE
  (tenant_id, issuer, client_id)` (open question, §8).
- **Spec maturity / interop.** DR is well-defined by 1EdTech, but token format,
  activation UX, and error reporting are implementation-defined and platforms do
  not all implement DR identically. **Interop testing against real LMSs (Canvas,
  Moodle, Brightspace) is required** before we trust it.

---

## 5. Does it reduce per-school onboarding effort?

**Yes — materially, for the school admin.** Concrete before/after:

| | **Today (manual, #10)** | **With Dynamic Registration** |
| --- | --- | --- |
| School admin actions | Hand-copy 5 endpoint fields into our `POST /lti/registrations`, then obtain & hand-insert the platform's `client_id` + `deployment_id` via an out-of-band `lti_deployment` insert | Paste **one** link into their LMS, click **activate** |
| Our admin actions | Receive the fields, run the API call, coordinate the deployment insert | Generate a registration link, send it to the school |
| Error surface | High — manual transcription of 5+ fields and IDs; support-heavy | Low — values flow automatically from the handshake |
| Effort scaling | **Linear in number of schools** (repetitive manual data entry) | **Fixed** one-time platform engineering + ongoing key ops |

**But it shifts effort onto our side.** It adds non-trivial, security-sensitive
operational surface: tool key generation/rotation/secret storage, a JWKS
publishing endpoint, a tenant-scoped registration-token system, SSRF-hardened
platform-config fetching, and a small admin UI to mint/track tokens.

**Net:** DR trades per-school repetitive manual data entry (cost linear in the
number of schools) for one-time platform engineering plus ongoing key ops (a
fixed cost). **Worthwhile at scale; over-engineered for a handful of pilot
schools.**

---

## 6. Recommendation — DEFER (partial-adopt later)

**Recommendation: DEFER full Dynamic Registration; partial-adopt later in two
phases.**

**Reasoning:** the manual path (#10) works and is adequate for current pilot
scale. DR's prerequisite — becoming a JWKS publisher with tool key management and
rotation — is a meaningful, security-sensitive build we don't have today, and the
tenant-binding design is the genuine architectural risk. Defer full DR until
either **(a)** onboarding volume justifies it, or **(b)** a target LMS mandates
it.

**When adopted, build it in two phases:**

1. **Phase 1 — tool keys + JWKS publishing first.** Ship the tool keypair,
   secret storage, and `GET /.well-known/jwks.json` with rotation. This is also a
   prerequisite for AGS, NRPS, and Deep Linking later — so it pays for itself
   beyond DR.
2. **Phase 2 — layer DR on top.** Add the tenant-scoped registration token, the
   SSRF-hardened initiation/registration endpoint, the auto-write of
   `lti_registration` + `lti_deployment`, and the admin UI.

### Effort estimate — ~13 story points (full DR)

| Work | Points |
| --- | --- |
| Tool key management + `GET /.well-known/jwks.json` publishing + rotation | **5** |
| Tenant-scoped registration token (schema + RLS + mint/burn + admin endpoint) | **3** |
| DR initiation/registration endpoint + platform-config fetch (SSRF-hardened) + auto-write registration/deployment | **3** |
| Admin UI (generate link, view status) + interop testing vs ≥1 real LMS | **2** |
| **Total** | **~13** |

### Follow-up stories it would spawn

1. **Tool-side LTI signing keys + public JWKS endpoint** — generate/store (secret
   manager) the tool keypair, publish a rotating `/.well-known/jwks.json`, support
   rotation with overlap. Prerequisite for DR (and for AGS/NRPS/Deep Linking).
   _Owners: schema-agent + service-builder + security-agent._
2. **Tenant-scoped LTI registration tokens (single-use, expiring)** — new
   `lti_registration_token` table + RLS mirroring `lti_launch_session`; mint +
   atomic burn; admin endpoint to issue. _Owners: schema-agent + service-builder._
3. **LTI Dynamic Registration endpoint (RFC 7591 + 1EdTech)** — initiation
   endpoint, SSRF-hardened platform-config fetch, client-registration POST,
   auto-create `lti_registration` + `lti_deployment`; consider `UNIQUE
   (tenant_id, issuer, client_id)`. _Owners: service-builder + security-agent._
4. **Admin UI: self-serve LTI registration link** — generate/copy the
   registration link, show pending/active status. _Owners: ux-designer +
   frontend-dev._
5. **LTI DR interop validation** — verify the handshake against
   Canvas/Moodle/Brightspace. _Owner: qa-agent._

---

## 7. Acceptance criteria mapping

| # | Acceptance criterion | Where addressed |
| --- | --- | --- |
| 1 | Determine if 1EdTech Dynamic Registration reduces per-school onboarding | [§5](#5-does-it-reduce-per-school-onboarding-effort) — yes for the school admin; shifts fixed cost to us |
| 2 | Document tool/platform registration flow and risks | [§2](#2-what-lti-dynamic-registration-is) (flow), [§3](#3-how-it-maps-onto-our-lti-service--tenant-model) (mapping), [§4](#4-security--trust-risks) (risks) |
| 3 | Recommendation with effort estimate | [§6](#6-recommendation--defer-partial-adopt-later) — DEFER, ~13 pts, 5 follow-up stories |

---

## 8. Open / implementation-defined questions

- **Tenant binding mechanism** for the DR initiation request — subdomain vs
  single-use registration token vs both. Architect recommends **token-primary**.
  Design decision for follow-up story #3.
- **Where tool private signing keys live** — secret manager choice. Decision for
  security-agent + ops.
- **Whether to widen `UNIQUE (issuer, client_id)`** (`database/schema.sql:750`) to
  `(tenant_id, issuer, client_id)`. Decision for schema-agent.

---

## References

- `services/lti/src/lti.routes.ts` — launch + `POST /lti/registrations`
- `services/lti/src/main.ts:51-63,70-84` — platform JWKS consumer; tenant resolver
- `services/lti/src/store.prisma.ts` — `createRegistration`, `getDeployment`
- `database/schema.sql:739-779` — `lti_registration`, `lti_deployment`, `lti_launch_session`
- `database/policies/rls.sql` — tenant isolation policies
- `services/gateway/src/auth.ts:91`, `services/gateway/src/proxy.ts:84` — `x-tenant-id` stamping
- [docs/services/lti.md](../services/lti.md) — generated lti service spec
- 1EdTech LTI Dynamic Registration; OpenID Connect Dynamic Client Registration (RFC 7591)
