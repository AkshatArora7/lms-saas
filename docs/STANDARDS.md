# Interoperability Standards (1EdTech)

Standards conformance is how an LMS displaces incumbents in institutional
procurement. Implement these from the start.

## LTI 1.3 / Advantage

The platform acts as an **LTI 1.3 Tool** (launched from a school-portal Platform),
with a Platform/embed surface for embedding external tools. Implemented by the
`lti` service.

**Implemented today (Resource Link launch — issue #10):**

- **OIDC third-party login** (`GET|POST /lti/login`) → the tool resolves its
  tenant-scoped platform registration by `(iss, client_id)`, persists a single-use
  `state`+`nonce` launch session (~10 min TTL), and **302-redirects** to the
  platform auth endpoint (`response_type=id_token`, `response_mode=form_post`,
  `prompt=none`).
- **Resource Link launch** (`POST /lti/launch`, form_post) → atomically consumes
  the `state` (replay/expiry/unknown → 401), verifies the platform-signed
  **RS256 id_token** against the platform **JWKS** with `iss`/`aud` (= client_id)/
  `exp` pinned, checks `nonce`, `version` (1.3.0), `message_type`
  (`LtiResourceLinkRequest`) and that `deployment_id` is registered, maps the LTI
  role claims to LMS roles (highest-privilege wins; `learner` default;
  `super_admin` is never granted from a launch), and mints an LMS session
  delivered ONLY as an **HttpOnly Secure SameSite=None** `lms_session` cookie —
  never in the redirect URL. The tenant is taken from the gateway `x-tenant-id`,
  never from the token.
- **Platform registration** (`POST /lti/registrations`) — tenant-scoped: register
  the platform a sub-tenant launches from (`issuer`, `clientId`, `authLoginUrl`,
  `authTokenUrl`, `jwksUrl`, `role?`).

**Roadmap (NOT yet implemented):**

- **AGS** (Assignment & Grade Services) — line items + score passback; intended to
  map to `grade_item.source_*` and serve alongside the gradebook.
- **NRPS** (Names & Role Provisioning Services) — membership/roster pull.
- **Deep Linking 2.0**, **Dynamic Registration**.
- AGS/NRPS will use a separate **OAuth2 client-credentials** access token (~1h).
- **Pitfall**: third-party-cookie restrictions (Safari ITP / Chrome) break naive
  iframe launches — the launch already mints a `SameSite=None; Secure` session
  cookie; a cookieless `postMessage` storage flow or new-window launch is the
  hardening path if cookies are blocked.

Schema: `lti_registration`, `lti_deployment`, `lti_launch_session`. Endpoints
today: `GET|POST /lti/login`, `POST /lti/launch`, `POST /lti/registrations`
(plus the embed surface `POST /embed/tokens`, `GET /embed/widget`). Roadmap
endpoints (AGS `/lineitems`, NRPS `/memberships`, `/lti/deep-linking`, JWKS) are
not implemented yet.

## OneRoster 1.2

The `sis` service is both a **consumer** (pull from external SIS) and a
**provider** (`/ims/oneroster/rostering/v1p2/*`). External calls use **OAuth2
Bearer (Client Credentials)**.

- Entities map to our model: `orgs` → `org_unit`, `users` → `app_user`,
  `academicSessions` → `academic_session`, `classes`/`courses` → `course`,
  `enrollments` → `enrollment`.
- `sis_id_map` holds external `sourcedId` ↔ internal UUID, with delta watermarks
  (`sis_sync`). First run is bulk; thereafter delta (status filter / watermark).
- Gradebook push-back via OneRoster Gradebook + LTI AGS.

## Caliper / xAPI (Analytics)

Domain services emit **Caliper** events (Actor / Action / Object) to the outbox →
QStash → the `analytics` Learning Record Store (`caliper_event`, append-only) and
legacy **xAPI** statements (`xapi_statement`). Materialised CQRS read models
(`engagement_summary`) drive dashboards and at-risk prediction — dashboards query
the read models, never the raw event store.

## Content standards

- **SCORM** (1.2 / 2004) and **xAPI** packages (`scorm_package`,
  `content_topic.kind = 'scorm'`), binaries in Vercel Blob.
- **QTI** import/export for question banks (`assessment` service).
