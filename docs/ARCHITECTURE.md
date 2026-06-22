# Architecture

A multi-tenant SaaS LMS competing with D2L Brightspace. The domain design follows
a microservices decomposition (~26 services, database-per-service boundaries) with
an event-driven analytics pipeline. The original blueprint targeted Azure + .NET;
this repository **re-platforms it onto GitHub + Vercel + serverless** per project
direction (no AWS/Azure).

## Request path

```
clients (web / mobile)
  → Vercel Edge Network (CDN + WAF + DDoS)          [was: Azure Front Door]
  → Gateway service (JWT validation, rate limit)    [was: API Management + YARP]
  → Next.js Route Handlers (Web BFF) / mobile-bff   [was: YARP BFFs]
  → domain microservices (Fastify, one DB boundary each)
  → Postgres (pool + silo) / Vercel Blob / Upstash / pgvector
events: domain services → outbox (Postgres) → relay (per-tenant drain) → transport → consumers (notification today; analytics next)
```

## Azure → GitHub/Vercel translation

| Blueprint (Azure)                          | This repo (GitHub + Vercel + serverless)            |
| ------------------------------------------ | --------------------------------------------------- |
| Azure Front Door (WAF/CDN/DDoS)            | Vercel Edge Network + Vercel Firewall               |
| API Management + YARP BFFs                 | `gateway` service + Next.js Route Handlers (BFF)    |
| AKS microservices                          | Container images → **GHCR** → container host (Fly/Render/Railway) |
| Azure SQL Elastic Pools (pool + silo, RLS) | **Neon Postgres**: shared pool DB + RLS; silo = Neon project/branch per tenant |
| Shard Map Manager (tenant catalog)         | `tenant` service + control-plane registry table     |
| Cosmos DB (documents)                      | Postgres **JSONB** columns                          |
| Service Bus + MassTransit (outbox/saga)    | Postgres **transactional outbox/inbox** + **QStash** |
| Azure Functions + Hangfire (jobs)          | **QStash schedules** + GitHub Actions cron + Vercel Cron |
| Azure Cache for Redis                      | **Upstash Redis** (tenant-prefixed keys)            |
| Blob Storage                               | **Vercel Blob**                                     |
| Azure AI Search + Azure OpenAI (RAG)       | **pgvector** + **Groq**                             |
| Azure Data Explorer / Synapse (LRS)        | Postgres LRS tables + materialised read models      |
| Entra External ID (CIAM)                   | External CIAM (**WorkOS / Auth0**) + `identity` svc |
| Key Vault                                  | GitHub/Vercel encrypted secrets + secret store      |
| Bicep / Helm / Flux                        | Vercel project config + Docker + GitHub Actions     |
| App Insights / Log Analytics / Grafana     | OpenTelemetry → Axiom / Grafana Cloud; pino logs    |
| Azure Media Services (retired)             | FFmpeg workers (`video` service) + CDN              |

## Services (bounded contexts)

| #  | Service        | Responsibility                                                        | Data shape          |
| -- | -------------- | --------------------------------------------------------------------- | ------------------- |
| 1  | gateway        | Edge auth, JWT validation, per-tenant rate limit, routing             | stateless           |
| 2  | identity       | Auth orchestration, OIDC/SAML/LTI federation, claims (delegates CIAM) | Postgres            |
| 3  | tenant         | Tenant catalog, provisioning saga, pool/silo routing, feature flags   | control-plane DB    |
| 4  | user-org       | Profiles + org-unit hierarchy (OneRoster orgs/users/sessions)         | Postgres (read-heavy)|
| 5  | enrollment     | Enrollments, section roles, lifecycle (OneRoster enrollments)         | Postgres            |
| 6  | course         | Courses, templates, sections, terms, copy                             | Postgres            |
| 7  | content        | Modules/lessons/topics, rich pages (versioned), SCORM/xAPI, H5P-style | JSONB + Blob        |
| 8  | assignment     | Assignments, submissions, late policy, plagiarism hooks               | Postgres + Blob     |
| 9  | assessment     | Quizzes, question banks, QTI, attempts, auto-grade                    | JSONB (write-heavy) |
| 10 | grading        | Gradebook line items, schemes, final grades (OneRoster + AGS)         | Postgres            |
| 11 | discussion     | Forums/threads/posts, subscriptions                                   | JSONB               |
| 12 | announcement   | Course/org announcements; notification fanout                         | Postgres            |
| 13 | notification   | Multi-channel (email/SMS/push/in-app); unread counters                | Postgres + Redis    |
| 14 | calendar       | Events, deadlines, iCal                                               | Postgres            |
| 15 | rubric         | Rubrics, competencies, outcomes, mastery (LTI Rubric Service)         | Postgres            |
| 16 | analytics      | Caliper/xAPI LRS, engagement, at-risk (event-sourced read models)     | Postgres            |
| 17 | reporting      | Scheduled/ad-hoc exports (CSV/PDF/OneRoster), compliance              | read replicas       |
| 18 | ai             | Lumi-equivalent: gen/feedback/Q&A via RAG (pgvector + Groq)           | pgvector + JSONB    |
| 19 | lti            | LTI 1.3 Platform + Tool: OIDC, AGS, NRPS, Deep Linking, Dyn. Reg.     | Postgres + Redis    |
| 20 | sis            | OneRoster 1.2 consumer/provider, sourcedId mapping, delta sync        | Postgres            |
| 21 | video          | Upload, FFmpeg transcode, HLS/DASH, captions                          | Blob + JSONB        |
| 22 | search         | Full-text + vector search, per-tenant filtered index                  | Postgres (FTS/vector)|
| 23 | billing        | Plans, seats, invoices, metering, enrollment+billing saga             | Postgres            |
| 24 | audit          | Tamper-evident hash-chained logs, DSAR, retention                     | Postgres (ledger)   |
| 25 | mobile-bff     | BFF for the React Native app                                          | stateless           |

## Per-service internal shape

Each service follows a layered shape: **API (Fastify routes) → application
(commands/queries) → domain → infrastructure (Prisma + RLS) → Postgres**, plus a
**transactional outbox** written in the same DB transaction as the business
change and relayed to consumers after commit by the `relay` worker.

## Event-outbox relay

The `relay` service (dev port 4026) is the actual implementation of the
**outbox → transport → consumers** path. It is a long-running worker (its Fastify
app exposes only `GET /health` and a manual `POST /relay/run`):

- It **enumerates active tenants** from the control-plane `tenant` registry
  (read outside RLS), then **drains each tenant's unpublished `event_outbox`
  rows inside that tenant's own `app.tenant_id` GUC transaction** via
  `@lms/db.withTenant`. Because `event_outbox` is under `FORCE ROW LEVEL
  SECURITY` and the app connects as a non-superuser (NOBYPASSRLS) role, the relay
  can never read the outbox cross-tenant — a query with no tenant GUC returns
  zero rows.
- Rows are drained oldest-first (causal order within a tenant); only rows that
  delivered are stamped `published_at`, re-guarded `published_at IS NULL` so a
  concurrent relay cannot double-stamp.
- The **transport is abstracted** behind the `@lms/events` `EventTransport` seam
  (the `events` package stays DB-free). The default is in-process / HTTP; a
  hosted **QStash/Upstash** transport implementing the same interface is a future
  seam (not used in dev, no secrets hard-coded).
- **Consumers dedupe via `event_inbox`** keyed on `(consumer, message_id)` for
  exactly-once-effective processing: the first delivery of an event id processes;
  a redelivery finds the row already present and is a no-op. The `notification`
  service's `POST /events` is the **first real consumer** — `enrollment.created`
  and `grade.released` flow end-to-end. `analytics` is **not yet wired**.

## Cross-cutting concerns

- **Auth**: OAuth2 + OIDC via external CIAM; auth-code + PKCE for web/mobile
  through the BFF (tokens kept server-side in the auth cookie); client-credentials
  for service-to-service and LTI AGS/NRPS.
- **Trusted identity headers**: the gateway is the single trust boundary — it
  validates the JWT and stamps trusted `x-tenant-id`, `x-user-id` (`claims.sub`)
  and `x-user-roles` (`claims.roles.join(",")`) downstream from the verified
  claims, **stripping any client-supplied copies first** (anti-spoof). Services
  treat these as trusted only because the gateway guarantees them and layer
  per-resource authz **on top of** tenant RLS; the web BFF forwards the same
  headers from its server session when it calls a service directly. See
  [ADR-0027](ADR-0027-trusted-identity-headers.md). In production, domain
  services must stay internal-only so identity can't be self-stamped.
- **Messaging**: transactional **outbox** + **inbox** (exactly-once) tables,
  drained by the `relay` worker through an abstracted transport (in-process / HTTP
  today; QStash a future seam). Consumer dedupe is keyed on `event_inbox
  (consumer, message_id)`. **Saga**: enrollment+billing (enroll → reserve seat →
  invoice; compensate on failure).
- **Idempotency**: `Idempotency-Key` header on mutating APIs; dedupe in
  `idempotency_key`.
- **Resilience**: retry w/ backoff, circuit breaker, timeout on all clients.
- **Observability**: OpenTelemetry traces, structured pino logs (tenant-tagged,
  PII-scrubbed), RED metrics per service.
