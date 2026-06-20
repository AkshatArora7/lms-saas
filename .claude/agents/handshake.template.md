# Handshake — <issue-or-branch>

> **Single source of truth for one task.** Subagents are stateless; this file
> carries context between them. Every agent **reads this file in full before
> acting** and **updates its own section before handing off**. Facts here must be
> grounded in source (the issue, `AGENTS.md`, the code/schema) — never invented.
> When this file and the code/schema disagree, the **source wins**: fix the code
> claim, then correct this file. Never delete another agent's section.

## 1. Task
- **Issue:** #<n> — <title>  ·  <url>            <!-- UNKNOWN until backlog-agent fills it -->
- **Type:** feat | fix | docs | chore | refactor
- **Branch:** <type>/<slug>  (off fresh `main`)
- **Requested by / date:** <who> · <YYYY-MM-DD>
- **One-line goal:** <what shipping this achieves>

## 2. Acceptance criteria  (verbatim from the issue — do not paraphrase)
- [ ] <AC 1>
- [ ] <AC 2>

## 3. Stage status  (tick only with evidence in the matching section)
| Stage | Owner | Status | Evidence |
| ----- | ----- | ------ | -------- |
| Requirements | backlog-agent | ☐ todo / ◐ wip / ☑ done / ⛔ blocked | |
| Architecture | architect | ☐ | |
| UX design | ux-designer | ☐ | |
| Data & RLS | schema-agent | ☐ | |
| Backend | service-builder | ☐ | |
| Frontend | frontend-dev | ☐ | |
| QA / tests | qa-agent | ☐ | |
| Security & DoD | security-agent | ☐ | |
| Docs | docs-agent | ☐ | |

## 4. Decisions & contracts  (append; never rewrite history)
- **Architecture (architect):** API routes, contracts between services, sequencing, ADR links.
- **Data shapes (schema-agent):** tables, columns + types, RLS decision per table (own `tenant_id` vs join-based), pglast result.
- **Design (ux-designer):** path to the JSON design prompt + one-line intent.
- **Implementation (service-builder / frontend-dev):** endpoints added, files changed (paths), breakpoints validated.

## 5. Verification  (real output only — paste, don't summarize away errors)
- **QA (qa-agent):** typecheck / lint / test / build counts; per-AC test mapping; root-cause notes for any failure.
- **Security & DoD (security-agent):** isolation/authz/secrets findings; APPROVE / CHANGES REQUESTED.

## 6. Open questions / blockers
- <question needing product or human input — list rather than guess>

## 7. Handshake log  (append-only; one line per hand-off)
- <YYYY-MM-DD HH:MM> · <agent> · <what changed> · **next owner → <agent>**
