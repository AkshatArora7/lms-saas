# Agent delegation protocol

> **Detailed reference, not the law.** The normative, non-negotiable rules live
> in [`AGENTS.md` §5 — Multi-agent delegation model](../AGENTS.md#5-multi-agent-delegation-model).
> This document is the **detailed reference** that `AGENTS.md` §5 links to: it
> explains *how* the protocol is run day to day, with the role catalogue, the
> handshake lifecycle, the hand-off and escalation paths, and what the
> `check:handshake` guard enforces. Where this document and `AGENTS.md` could ever
> appear to disagree, **`AGENTS.md` wins** — fix this file, never the other way.

---

## 1. Purpose & authority

This LMS monorepo is delivered by a **team of specialised agent roles** (see
[`.claude/agents/README.md`](../.claude/agents/README.md)). A single request is
decomposed across those roles, and each role hands work to the next through a
shared **handshake file**. This protocol exists so that:

- every task is **completed or explicitly delegated** — never silently dropped;
- hand-offs are **recorded** so the chain of custody is auditable;
- there is always an **escalation path** when no role can accept;
- the protocol's machine-readable surfaces (the role catalogue, the handshake
  template) cannot **silently drift** out of sync with the agents that actually
  exist.

**Authority.** [`AGENTS.md` §5](../AGENTS.md#5-multi-agent-delegation-model) is
the normative source for the roles, the hand-off protocol, and the escalation
rule; [`AGENTS.md` §1.2 ("Never deny, never drop")](../AGENTS.md#1-prime-directives)
is the prime directive behind it. This document elaborates those rules — it does
not redefine them. If you need the short, binding statement, read `AGENTS.md`; if
you need the operating manual, read on.

---

## 2. The delegation protocol

### 2.1 Task decomposition

Any non-trivial request enters through the `orchestrator`. The `orchestrator`
reads the real state from source (`git status`/`git log`, the issue, the code),
then decomposes the request into discrete, single-owner tasks and routes each to
the role that owns that scope. The `orchestrator` does not implement; it
coordinates and owns the handshake file.

### 2.2 Specialist selection — the role catalogue

There are exactly **ten roles**, each backed by an agent definition under
[`.claude/agents/`](../.claude/agents/README.md) (`<slug>.md`). Select the role
whose **Owns** column matches the task; if the task crosses scopes, decompose it
and route each part.

| Role | Owns | Typically hands off to |
| ---- | ---- | ---------------------- |
| `orchestrator` | Decomposes the request, owns the handshake file, assigns roles, tracks completion, holds the Definition-of-Done gate. | any role |
| `backlog-agent` | User stories + acceptance criteria; seeds the GitHub issue (story-first). | `architect`, `schema-agent`, `service-builder`, `ux-designer`, `docs-agent` |
| `architect` | Technical design: service boundaries, API/event contracts, data ownership, build sequence, ADRs. Designs; does not implement. | `schema-agent`, `service-builder`, `ux-designer`, `qa-agent`, `security-agent` |
| `ux-designer` | Decides what a screen should be; emits a structured JSON design prompt. Designs; writes no app code. | `frontend-dev`, `backlog-agent` |
| `schema-agent` | `database/schema.sql`, RLS policies, tenancy; pglast validation. | `service-builder`, `qa-agent`, `security-agent` |
| `service-builder` | A bounded context under `services/*` (one owner per service) + its spec. | `schema-agent`, `architect`, `qa-agent`, `security-agent` |
| `frontend-dev` | A screen in `apps/web`/`apps/admin`, all breakpoints in one pass, WCAG 2.2 AA. | `ux-designer`, `service-builder`, `qa-agent`, `security-agent` |
| `qa-agent` | Test strategy + the verification suite (typecheck/lint/test/build, pglast); root-causes failures and routes the fix. | the owning specialist, `security-agent` |
| `security-agent` | Final gate: tenant-isolation/authz/secrets audit + Definition-of-Done review. | the owning specialist, `qa-agent` |
| `docs-agent` | `README`, `docs/*`, regenerated service specs (never hand-edited). | `backlog-agent`, `qa-agent`, `security-agent` |

> The slug in each cell (e.g. `service-builder`) is the exact filename, minus
> `.md`, of the agent definition. The `check:handshake` guard asserts this table
> and the `.claude/agents/README.md` table name the **same ten roles** as the
> files on disk — see [§7](#7-enforcement).

### 2.3 The standard story-first flow

The standard sequence, per [`AGENTS.md` §1-§2](../AGENTS.md#1-prime-directives)
and the `orchestrator` definition:

```
0. sync main      → orchestrator: git fetch + checkout main + pull --ff-only → branch off fresh main → create handshake
1. story + claim  → backlog-agent: user story + GitHub issue, assign to the worker, set In Progress
2. design         → architect (+ ux-designer for UI): contracts, build sequence, ADRs
3. schema         → schema-agent: tables + RLS in the same change, pglast-validated
4. implement      → service-builder (+ frontend-dev for UI, all breakpoints in one pass)
5. docs           → docs-agent: README/docs + regenerated specs
6. verify         → qa-agent: typecheck/lint/test/build (+ pglast), AC→test mapping
7. gate           → security-agent: isolation/authz/secrets + Definition-of-Done sign-off
```

Steps are skipped when they don't apply (no schema change → no `schema-agent`),
but the order is preserved: **story before design, design before build, build
before verify, verify before gate.**

---

## 3. The handshake file — contract & lifecycle

### 3.1 Location & naming

- **One file per task**, at `.claude/handshakes/<branch>.md`, where branch
  slashes become `-` (e.g. `feat/rubric` → `feat-rubric.md`).
- Created by the `orchestrator` from
  [`.claude/agents/handshake.template.md`](../.claude/agents/handshake.template.md)
  at the start of a task.
- **Live handshakes are git-ignored** (`.gitignore`). They are working context,
  not committed artifacts — which is why the enforcement guard validates the
  *tracked template* and the *tracked role catalogue*, not the live files (see
  [§7](#7-enforcement)).

### 3.2 Required sections (§1–§7)

The handshake template defines seven sections; every handshake carries all of
them, in order:

| # | Section | Purpose |
| - | ------- | ------- |
| §1 | **Task** | Issue link, type, branch, requester, one-line goal. |
| §2 | **Acceptance criteria** | Verbatim from the issue — never paraphrased. |
| §3 | **Stage status** | The per-stage owner/status/evidence table; tick only with evidence. |
| §4 | **Decisions & contracts** | Append-only design decisions, API/event contracts, data shapes. |
| §5 | **Verification** | Real QA output and the security/DoD verdict — pasted, not summarised. |
| §6 | **Open questions / blockers** | Unknowns needing product or human input — listed, never guessed. |
| §7 | **Handshake log** | Append-only; one line per hand-off, naming the next owner. |

### 3.3 The per-agent contract

Every agent, on every turn, follows the same loop:

1. **Read the handshake in full before acting.** It is the single source of
   cross-agent context; subagents are stateless otherwise.
2. **Act in your lane only.** Edit only what your role owns; delegate the rest.
3. **Update your own section** with grounded facts (decisions in §4, real
   command output in §5, your row in §3). **Never delete another agent's
   section.**
4. **Append a §7 log line** naming what changed and the **next owner**.

### 3.4 Source wins on disagreement

The handshake records claims; it is not itself authoritative over the code. When
the handshake and the code/schema/`AGENTS.md` disagree, **the source wins**: fix
the claim, then correct the file. Facts come from source — never invent issue
numbers, columns, routes, file paths, or test counts; mark them `UNKNOWN` and
get them from the owner.

---

## 4. Hand-off & completion signaling

- **Accept or delegate — never deny.** If a task is outside your role, hand it to
  the named role that owns it. Do not refuse and stop, and do not silently drop
  it. This is [`AGENTS.md` §1.2](../AGENTS.md#1-prime-directives) and §5.
- **A hand-off is recorded two ways:**
  1. a **§7 handshake log line** that names the next owner
     (`… · <agent> · <what changed> · next owner → <role>`); and
  2. when code lands, a **commit that references the issue** (Conventional
     Commit, `#<n>`), so the chain of custody is in git history too. Commit
     references are themselves machine-checked by
     [`pnpm check:commits`](../AGENTS.md#31-automated-checks).
- **Single owner per scope.** Once a scope is delegated, that role owns it until
  it is done or explicitly re-delegated — no duplicated work.
- **Close the loop.** A task is complete only after `qa-agent` confirms green and
  `security-agent` approves; unmet items return to the implementing role (see
  [§5](#5-the-definition-of-done-gate)).

---

## 5. The Definition-of-Done gate

A change is **done** only when both gatekeepers pass, on top of the
[`AGENTS.md` §4 Definition of Done](../AGENTS.md#4-definition-of-done) checklist:

1. **`qa-agent` is green** — typecheck, lint, test, build, and (for schema)
   pglast all pass, with real pasted output, and each acceptance criterion maps
   to a test or check.
2. **`security-agent` approves** — tenant-isolation/authz/secrets audit and the
   Definition-of-Done review (story linkage, commit hygiene, RLS on new tenant
   tables, regenerated-not-hand-edited specs) return **APPROVE**.

If either returns *CHANGES REQUESTED*, the task goes back to the **implementing
role** — not to the gatekeeper — and re-runs the gate after the fix.

---

## 6. Escalation path

When a task genuinely fits **no role**, or a guardrail blocks every path,
**escalate to the `orchestrator`** with a written reason and the options you see —
rather than dropping the task or working around a rule. The `orchestrator`
either:

- creates a **new role or story** to absorb the work, or
- asks the **human maintainer** for a decision.

The chain always **terminates in a decision, never in silence**. This mirrors the
prime directive ("Never deny, never drop") and
[`AGENTS.md` §5 — Escalation](../AGENTS.md#5-multi-agent-delegation-model).

---

## 7. Enforcement

The protocol's machine-readable surfaces are guarded by **`pnpm check:handshake`**
(folded into `pnpm check:rules` and run in CI alongside `pnpm test:checks`; see
[`AGENTS.md` §3.1 — Automated checks](../AGENTS.md#31-automated-checks)). It is a
read-only structural guard in the same shape as `check:rls` / `check:commits`.

**What the guard validates (fatal in CI):**

- **Template integrity** — `.claude/agents/handshake.template.md` contains all
  seven required section headings (§1 Task … §7 Handshake log), in order. A
  renamed, missing, or reordered section fails the check, so the template can
  never silently lose a section this protocol depends on.
- **Role drift** — three sources must name the **same set of roles**:
  (1) the agent files (`.claude/agents/*.md`, excluding `README.md` and
  `handshake.template.md`); (2) the role catalogue in this document
  ([§2.2](#22-specialist-selection--the-role-catalogue)); (3) the role table in
  [`.claude/agents/README.md`](../.claude/agents/README.md). A role slug is
  "documented" when it appears as a backticked token in the doc. If any agent
  file is undocumented, or any documented role has no agent file, the check
  fails. Intentional exceptions live in an `EXCEPTIONS` allowlist (none today),
  the same conscious-decision pattern as `check:rls`.

**What the guard does *not* fully enforce (stays reviewer-enforced):**

- **Live handshake hygiene** — because `.claude/handshakes/*.md` are git-ignored,
  CI sees zero files; an optional **local** lint validates any present handshakes
  against the seven sections and that the last §7 log line names a valid next
  owner, but it is non-fatal in CI (zero files = pass). Day-to-day handshake
  discipline (filling §4/§5 with grounded facts, never deleting a section) stays
  **reviewer-enforced**.
- **The behavioural rules** — "accept or delegate, never deny", single-owner-per-
  scope, and the escalation chain are reviewer-enforced; the guard keeps the
  *role catalogue and template* honest so those rules always reference real roles
  and a complete template.

---

## 8. Acceptance-criteria coverage (issue #93)

| AC (issue #93) | Where it is satisfied |
| -------------- | --------------------- |
| AGENTS.md defines roles and a hand-off protocol | [`AGENTS.md` §5](../AGENTS.md#5-multi-agent-delegation-model) (normative); elaborated here in [§2](#2-the-delegation-protocol) + [§4](#4-hand-off--completion-signaling); the role list is kept honest by the `check:handshake` role-drift guard ([§7](#7-enforcement)). |
| Every task is completed or explicitly delegated — no agent denies/drops it | [`AGENTS.md` §1.2 + §5](../AGENTS.md#1-prime-directives) (normative); formalised here as accept-or-delegate-never-deny in [§4](#4-hand-off--completion-signaling); §7-log-line-names-next-owner is checked by the optional local handshake lint ([§7](#7-enforcement)). |
| Hand-offs are logged (issue comment / commit trailer referencing the role) | [§4](#4-hand-off--completion-signaling) defines the §7 log line + issue-referencing commit; commit references are machine-checked by [`pnpm check:commits`](../AGENTS.md#31-automated-checks). |
| An escalation path exists when no role can accept | [`AGENTS.md` §5 — Escalation](../AGENTS.md#5-multi-agent-delegation-model) (normative); detailed here in [§6](#6-escalation-path). |
