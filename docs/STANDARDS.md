# Interoperability Standards (1EdTech)

Standards conformance is how an LMS displaces incumbents in institutional
procurement. Implement these from the start.

## LTI 1.3 / Advantage

The platform acts as an **LTI 1.3 Platform** (launching external tools) and a
**Tool**. Implemented by the `lti` service.

- **OIDC third-party login** → auto-POST a signed **RS256 id_token** (JWT) with
  `iss`, `aud` (client_id), `sub`, `deployment_id`, roles, and resource-link
  claims. The tool validates `state` (CSRF, from cookie) and verifies the
  signature against the platform **JWKS**.
- **AGS** (Assignment & Grade Services) — line items + score passback; mapped to
  `grade_item.source_*` and served alongside the gradebook.
- **NRPS** (Names & Role Provisioning Services) — membership/roster.
- **Deep Linking 2.0**, **Dynamic Registration**.
- AGS/NRPS use a separate **OAuth2 client-credentials** access token (~1h).
- **Pitfall**: third-party-cookie restrictions (Safari ITP / Chrome) break naive
  iframe launches — implement the cookieless `postMessage` storage flow or a
  new-window launch from the start.

Schema: `lti_registration`, `lti_deployment`. Endpoints (illustrative):
`/lti/login`, `/lti/launch`, `/lti/jwks`, `/lti/deep-linking`, AGS `/lineitems`,
NRPS `/memberships`.

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

- **SCORM** (1.2 / 2004): package **import + completion tracking ship now** (#31).
  The `content` service parses the supplied `imsmanifest.xml` (org title, launch
  href, mastery score) into a launchable `scorm_package` and records one
  `scorm_attempt` per (tenant, package, learner); raw cmi (1.2
  `cmi.core.lesson_status` or 2004 `cmi.completion_status`/`success_status`/`score`)
  is normalized server-side, and a terminal/passing attempt emits a
  `learning.event_captured` outbox event (source `"scorm"`) so completion is
  surfaced to the gradebook via the analytics/LRS path. Binaries (the `.zip`) land
  in Vercel Blob via the signed `POST /uploads` flow. Manifest parsing is XXE/
  billion-laughs hardened and rejects unsafe launch hrefs. **Documented follow-ups:**
  server-side unzip + byte-serving of the runtime assets, the full SCORM JS RTE
  bridge (`window.API` / `API_1484_11`), a dedicated `scorm.attempt_recorded` event
  verb + a grading-side consumer that writes a `grade`, and a service-side
  authenticated-user header so `learnerId` is resolved at the service.
- **xAPI** packages (`xapi_statement`, `content_topic.kind = 'scorm'`),
  binaries in Vercel Blob; xAPI ingestion remains a tracked follow-up.
- **QTI** import/export for question banks (`assessment` service).
