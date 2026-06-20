# ADR-0024 — Guardian/parent relationships (consent-gated, read-only)

- **Status:** Accepted (design) · 2026-06-20
- **Issue:** #24 — Guardian/parent relationships
- **Owning service:** `services/user-org` (owns `app_user`, org hierarchy, and
  `parental_consent`).
- **Author:** Architect agent

## Context

We must let a guardian (a parent/guardian `app_user`) be linked to a student
(`app_user`) within a tenant, with **read-only** access to the child's scoped
data (per the story narrative: grades + announcements), **respecting
consent/age rules**. `services/user-org` already owns both the people
(`app_user`, `database/schema.sql:129-141`) and the compliance surface
(`parental_consent`, `database/schema.sql:1160-1183`; logic in
`services/user-org/src/consent.ts`). No `guardian`/`relationship` concept exists
anywhere in the repo yet (grep-confirmed in the handshake).

The slice must stay shippable and verifiable in `user-org` even though the
target read surfaces (grades, announcements) live in other services.

## Decision

1. **Model the link as a new tenant-scoped table `guardian_relationship`** with
   its own `tenant_id` -> standard `tenant_isolation` RLS policy (same pattern as
   `app_user`/`org_unit`). It links `guardian_user_id` -> `student_user_id`
   (both FK `app_user`), with a `relationship` enum (`parent|guardian|other`)
   and a `status` lifecycle (`pending|active|revoked`).

2. **Do not duplicate consent storage. Reuse `parental_consent`.** The
   relationship stores a nullable `consent_id` FK to the `parental_consent` row
   that was used to activate it -- this is an **audit/provenance pointer only**.

3. **The authorization predicate is the source of truth for live access**, and
   it re-derives consent at request time from `parental_consent` (via the
   existing pure policy `dataCollectionDecision` in `consent.ts:113`). This means
   revoking a student's consent **immediately denies** guardian access without
   having to mutate the relationship row. Access is granted iff:
   - an **active** `guardian_relationship (tenant, G, S)` exists, **and**
   - the student's gating consent is currently satisfied
     (`dataCollectionDecision(student, 'directory_information').allowed === true`),
     or the student's `age_band = 'adult'` with the relationship explicitly
     activated.

4. **Read-only is enforced by construction:** the only guardian-facing endpoint
   is a read-only authorization predicate. All mutation routes
   (create/activate/revoke) are **admin/staff** operations. No write path to the
   child's data is ever exposed to a guardian.

5. **Cross-service reads are deferred.** `user-org` exposes a reusable
   `GET /guardians/authorize` predicate; the grading and announcement services
   call it before returning a child's data. Those endpoints are **follow-up
   issues**, not built in this slice.

## Options considered

- **(A) Consent as a hard FK that gates access by row state** -- rejected:
  `parental_consent` is keyed by `(tenant, subject, consent_type)`, not by
  guardian, so a single hard gate is ambiguous and a stale FK could grant access
  after a later revoke. Provenance-pointer + request-time re-check is safer.
- **(B) A `guardian` role via `role`/`role_assignment`** -- rejected for the data
  model (`role_assignment` is org-unit-scoped, not person-to-person), but noted
  as a *follow-up* for minting a gateway "guardian" claim.
- **(C) Put guardian read endpoints for grades/announcements in `user-org`** --
  rejected: `user-org` does not own those bounded contexts. Reusable predicate +
  follow-up issues in the owning services keeps boundaries clean.

## Consequences

- One new tenant-scoped table + RLS entry; pglast must pass.
- Consent revocation is honoured in real time (no reconciliation job needed).
- Grading/announcement integration is a documented contract, filed as follow-up
  issues; this slice is independently shippable and testable in `user-org`.
