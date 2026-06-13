# Diagrams

Open these `.drawio` files at [app.diagrams.net](https://app.diagrams.net) (File →
Open) or with the Draw.io VS Code extension.

- **master-architecture.drawio** — the re-platformed (GitHub + Vercel +
  serverless) master architecture: clients → Vercel Edge → gateway/BFF →
  26 microservices → Postgres (pool/silo) / Vercel Blob / Upstash / pgvector,
  with the outbox→QStash event pipeline and external integrations.

The source blueprint (`/docs` references) also contains sequence diagrams
(provisioning, submission→grading, LTI 1.3 launch, SIS sync) expressed in the
Azure idiom. Their **flows are unchanged** under this stack; only the components
differ (Durable Functions → QStash saga; Service Bus → outbox+QStash;
Azure SQL → Neon Postgres). See `docs/ARCHITECTURE.md` for the full mapping.
