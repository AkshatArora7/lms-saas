# Claude Code subagents — a senior SDLC team

Project-scoped [Claude Code subagents](https://code.claude.com/docs/en/sub-agents)
for this LMS monorepo. They are checked into version control so every collaborator
gets the same specialists automatically — no setup needed.

Think of them as a **complete software-delivery team**, one owner per SDLC phase,
operating under the rules in [`AGENTS.md`](../../AGENTS.md) (story-first, RLS
isolation, the store-abstraction pattern, commit hygiene, Definition of Done). The
`orchestrator` leads; specialists own their scope and **delegate across the team**
via the `Agent` tool instead of working around a rule. They coordinate through a
shared **handshake file** so context is grounded, not re-invented.

## The team (10 agents, one per SDLC phase)

| Agent | SDLC phase | Use it for | Edits | Delegates to |
| ----- | ---------- | ---------- | ----- | ------------ |
| `orchestrator` | Lead / delivery | Entry point for any multi-step request; decomposes, owns the handshake, routes, holds the DoD gate. | handshake only | everyone |
| `backlog-agent` | Requirements | Turn an idea into a user story + seed the GitHub issue (story-first). | backlog, handshake | architect, schema-agent, service-builder, ux-designer, docs-agent |
| `architect` | Architecture / design | Service boundaries, API/event contracts, data ownership, build sequence, ADRs. Designs; doesn't implement. | docs (ADRs), handshake | schema-agent, service-builder, ux-designer, qa-agent, security-agent |
| `ux-designer` | UX design | Decide what a screen should be; emit a structured JSON design prompt. Designs; no app code. | design prompt, handshake | frontend-dev, backlog-agent |
| `schema-agent` | Data & tenancy | `database/schema.sql` + RLS policies + tenancy; pglast-validate. | yes | service-builder, qa-agent, security-agent |
| `service-builder` | Backend | Implement/extend a service under `services/*` (store-abstraction pattern). | yes | schema-agent, architect, qa-agent, security-agent |
| `frontend-dev` | Frontend | Build a screen in `apps/web`/`apps/admin` for phone+tablet+desktop in one pass, no overflow, WCAG 2.2 AA. | yes | ux-designer, service-builder, qa-agent, security-agent |
| `qa-agent` | Test & reliability | Test strategy + run typecheck/lint/test/build (+ pglast) + root-cause any failure and route the fix. | tests, handshake | the owning specialist + security-agent |
| `security-agent` | Security & DoD gate | Final gate: tenant-isolation/authz/secrets audit + Definition-of-Done review. | reports, handshake | the owning specialist + qa-agent |
| `docs-agent` | Documentation | `README`/`docs/*`; regenerate (never hand-edit) service specs. | docs, handshake | backlog-agent, qa-agent, security-agent |

> Read-only-over-code agents (`architect`, `ux-designer`, `qa-agent`,
> `security-agent`) have `Write` access **only** to update the handshake and their
> own artifacts (ADRs, design prompts, tests, reports) — they never edit
> application/source code; they delegate fixes to the owning specialist.

## The handshake file — shared context that minimizes hallucination

Subagents are **stateless**, so each one would otherwise re-derive context and risk
inventing facts. Instead, every task gets one **handshake file** — the single
source of truth that agents read and update as work moves through the SDLC.

- **Template:** [`handshake.template.md`](handshake.template.md).
- **Live file:** the `orchestrator` creates `.claude/handshakes/<branch>.md` at the
  start of a task (git-ignored; see [`../handshakes/README.md`](../handshakes/README.md)).
- **Contract:** every agent **reads it in full before acting** and **updates its own
  section before handing off** (decisions, real command output, stage status, and a
  log line naming the next owner). No agent deletes another's section. When the file
  and the code/schema disagree, **the source wins** — fix the claim, then the file.

### Anti-hallucination rules every agent follows
1. **Facts come from source, not memory** — read `AGENTS.md`, the issue, the
   handshake, and the actual code/schema first; cite `file:line` for code claims.
2. **Never fabricate** issue numbers, table/column names, routes, file paths, env
   vars, or test counts — mark `UNKNOWN` and get it from the owner instead of guessing.
3. **Verify before you claim** — "done"/"passing" requires real, pasted command
   output; no "should work".
4. **Reuse before invent**, and **stay in your lane** — edit only what you own;
   delegate the rest.

## How the work flows (story-first)

```
request
  └─ orchestrator (sync main, create handshake, decompose, route, hold DoD gate)
       ├─ git fetch + checkout main + pull --ff-only  → branch off fresh main
       ├─ backlog-agent   → user story + GitHub issue (claim it: assign + In Progress)
       ├─ architect       → technical design, contracts, build sequence, ADRs
       ├─ ux-designer     → JSON design prompt                 ┐ UI work
       ├─ schema-agent    → tables + RLS (pglast)              │ delegates qa-agent
       ├─ service-builder → store/routes/tests                 │ delegates schema-agent
       ├─ frontend-dev    → responsive UI (phone/tab/desk)     ┘ delegates ux-designer
       ├─ docs-agent      → README/docs + generated specs
       ├─ qa-agent        → typecheck/lint/test/build + AC→test mapping
       └─ security-agent  → isolation/authz/secrets + Definition-of-Done sign-off

  bug / failing build / CI failure
  └─ qa-agent (reproduce → evidence → isolate root cause → diagnose)
       └─ delegates the fix to the owning specialist → re-verify → security-agent
```

Before starting any ticket the orchestrator **syncs the default branch** (`git fetch
origin` then `git checkout main && git pull --ff-only`), branches off fresh `main`,
and creates the handshake file. Every specialist follows the **hand-off protocol**
from `AGENTS.md` §5: accept or delegate — never deny; pass complete context (and the
handshake) on hand-off; single owner per scope; the security agent closes the loop.

## How collaborators use them

You normally **don't invoke anything manually**. The repo's root
[`CLAUDE.md`](../../CLAUDE.md) is loaded into every Claude Code session and routes
each non-trivial request to the `orchestrator`, which delegates across the team. You
can still steer explicitly:

```text
Use the orchestrator to build the rubric service end-to-end.
Use the architect to design how the rubric service talks to grading.
Use the schema-agent to add the rubric tables with RLS.
Use the service-builder to implement the rubric service.
Use the ux-designer to design the analytics dashboard (JSON design prompt).
Use the frontend-dev to build that dashboard for phone, tablet, and desktop.
Use the qa-agent to run the checks (or to root-cause the failing build, then route the fix).
Use the security-agent to gate my branch (isolation + Definition of Done).
```

Run `/agents` to view, edit, or create more. Project agents take precedence over
personal (`~/.claude/agents/`) ones with the same name.

## Editing

Each agent is a Markdown file with YAML frontmatter (`name`, `description`, optional
`tools`/`model`) followed by its system prompt. Listing `Agent` in `tools` is what
lets a specialist spawn teammates. After editing a file on disk, restart the Claude
Code session (or use `/agents`) to reload it. Keep `name` values unique.
