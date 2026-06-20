# COPPA / age-appropriate data flows (K-12)

> Implements issue **#77** (epic #73 — Security, Audit & Compliance). This is the
> "documented data flows" deliverable; the enforcement lives in the `user-org`
> service (`/compliance/*`) and the `parental_consent` table.

## Goal

Comply with K-12 regulations (COPPA for under-13; FERPA-aligned handling for
13–17) by **gating data collection on verifiable parental consent** and
**minimising the personal data** we store about minors.

## Age signal: bands, not birthdates

We never store a child's date of birth. Instead each subject is tagged with a
coarse **age band** — `under_13`, `13_17`, `adult`, or `unknown` — captured
alongside consent in `parental_consent.age_band`. This is enough to apply the
right policy while keeping the minimum PII (data minimisation).

## Data categories (consent types)

| Category | Meaning |
| --- | --- |
| `data_collection` | Collecting/storing the learner's basic activity data |
| `third_party_sharing` | Sharing data with third parties (e.g. integrations) |
| `directory_information` | Exposing FERPA "directory information" |
| `ai_features` | Sending learner data to AI features |

## Policy (who needs consent for what)

Decided purely in `dataCollectionDecision()` (`services/user-org/src/consent.ts`):

| Age band | `data_collection` | `third_party_sharing` / `directory_information` / `ai_features` |
| --- | --- | --- |
| `under_13` | **consent required** | **consent required** |
| `13_17` | allowed | **consent required** |
| `unknown` | allowed | **consent required** (conservative) |
| `adult` | allowed | allowed |

Granting consent for an **under-13** subject is rejected unless it carries a
**verifiable method** (`verifiable_email` / `signed_form` / `in_person`, not
`none`) and a **guardian email** — consent cannot be a bare flag (COPPA's
"verifiable parental consent").

## Flow

```
1. Capture   POST /compliance/consents
             { subjectUserId, ageBand, consentType, status, guardian*, method }
             -> upsert parental_consent (tenant-scoped, RLS) keyed on
                (tenant, subject, consent_type)

2. Enforce   GET  /compliance/subjects/:userId/data-policy?category=<type>
             -> { allowed, requiresConsent, reason } from age band + granted
                consents. Producers call this before collecting/sharing.

3. Revoke    POST /compliance/consents/:id/revoke
             -> status='revoked', revoked_at=now(); the policy re-blocks
                immediately.

4. Inspect   GET  /compliance/subjects/:userId/consents
             -> the full consent ledger for a subject.
```

## Isolation & audit

- `parental_consent` is in the RLS `tenant_tables` list, so a tenant only ever
  sees/writes its own consent rows (`tenant_id = current_tenant_id()`).
- Each row records `recorded_by` (the actor) and `recorded_at` / `revoked_at`.
  Pairing consent changes with the tamper-evident `audit_log` hash chain gives a
  defensible record of who consented to what and when.

## Known follow-ups

- Emit a `compliance.consent.changed` domain event for downstream auditing.
- Propagate age band onto `app_user` (or a dedicated subject table) so producers
  can resolve minor status without a consent row present.
- Wire the `ai_features` decision into the AI service request path.
