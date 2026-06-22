# lti service

- **Port (dev):** 4018
- **Data shape:** Postgres
- **Layer:** API (Fastify) -> application -> domain -> infrastructure (Prisma + RLS) -> Postgres

## Responsibility

LTI 1.3 Tool: OIDC third-party-initiated login and Resource Link launch — validate a platform-signed id_token and mint an LMS session — plus tenant-scoped platform registration. Also serves signed, short-lived embeddable course/widget iframes for school portals. AGS, NRPS, Deep Linking 2.0, and Dynamic Registration are roadmap (not yet implemented).

## Owned tables

`lti_registration`, `lti_deployment`, `lti_launch_session`

## Key endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET\|POST` | `/lti/login` | OIDC third-party-initiated login: resolve the tenant's platform registration by (iss, client_id), persist a single-use state+nonce launch session, and 302-redirect to the platform's auth endpoint (response_type=id_token, response_mode=form_post, prompt=none). |
| `POST` | `/lti/launch` | Resource Link launch callback (form_post): atomically consume the state (replay/expiry/unknown -> 401), verify the id_token against the platform JWKS (iss/aud=client_id/exp via injected clock), check nonce/version/message_type and that deployment_id is registered, map LTI roles -> LMS roles, then mint an LMS session in an HttpOnly Secure SameSite=None cookie and 302 to the learner app (token never in the URL). |
| `POST` | `/lti/registrations` | Register a platform this sub-tenant launches from (tenant-scoped): {issuer, clientId, authLoginUrl, authTokenUrl, jwksUrl, role?}; 201 {registration}, 400 on missing/invalid fields. |
| `POST` | `/embed/tokens` | Mint a signed, short-lived embed token scoped to a tenant + resource + allowed origins. |
| `GET` | `/embed/widget` | Render the embeddable widget; sets frame-ancestors from the signed origins. |
| `GET` | `/health` | Liveness/readiness. |

## Events published

_None_

## Events consumed

_None_

## Dependencies

- identity (session claims minted via @lms/auth)
- external LTI platform (JWKS endpoint + OIDC auth endpoint)

## Notes

This LMS is the Tool, launched from a school-portal Platform. Flow: the platform initiates OIDC login at `GET|POST /lti/login`; the service finds the tenant-scoped `lti_registration` by `(issuer, client_id)`, writes a single-use `lti_launch_session` (state+nonce, ~10 min TTL), and 302-redirects to the platform auth endpoint. The platform form_posts the signed `id_token` back to `POST /lti/launch`, where the state is consumed by one atomic `UPDATE ... SET consumed_at=now() WHERE consumed_at IS NULL AND expires_at>now() RETURNING` (replay/expiry/unknown -> 401), the token is verified with `jose.jwtVerify` against the platform JWKS (the resolver structurally blocks `alg:none`/symmetric-key confusion) with iss/aud=client_id/exp pinned, nonce/version(1.3.0)/message_type(LtiResourceLinkRequest)/deployment_id checked, and LTI role URNs mapped to `StandardRole`s (highest-privilege wins; `learner` default; `super_admin` NEVER granted from a launch). The minted session is delivered ONLY as an HttpOnly Secure SameSite=None `lms_session` cookie. Tenant comes from the gateway `x-tenant-id`, never the token. `lti_launch_session` is tenant-scoped (own `tenant_id`, in the RLS `tenant_tables[]` loop). No domain events are wired yet. Deferred follow-ups (NOT implemented): Deep Linking 2.0, NRPS roster pull, AGS grade passback, Dynamic Registration. The embed surface (`/embed/*`) is unchanged.

## Cross-cutting

Writes a transactional **outbox** row (`event_outbox`) in the same DB transaction as each state change; consumes via **inbox** (`event_inbox`) with `idempotency_key` dedupe. All tenant-scoped tables are protected by Postgres RLS keyed on `app.tenant_id`.
