# Claude Code subagents — a senior delivery team

Project-scoped [Claude Code subagents](https://code.claude.com/docs/en/sub-agents)
for this LMS monorepo. They are checked into version control so every
collaborator gets the same specialists automatically — no setup needed.

Think of them as a **team of senior engineers**, each an expert in their field,
operating under the rules in [`AGENTS.md`](../../AGENTS.md) (story-first, RLS
isolation, the store-abstraction pattern, commit hygiene, Definition of Done).
The `orchestrator` leads; the specialists own their scope and **delegate across
the team** via the `Agent` tool instead of working around a rule.

## The team

| Agent | Seniority / field | Use it for | Model | Edits files? | Can delegate to |
| ----- | ----------------- | ---------- | ----- | ------------ | --------------- |
| `orchestrator` | Engineering lead / delivery owner | Entry point for any multi-step request; decomposes & routes work. | opus | no | everyone |
| `backlog-agent` | Senior product owner / BA | Turn an idea into a user story + seed the GitHub issue (story-first). | opus | backlog | schema-agent, service-builder, docs-agent, orchestrator |
| `schema-agent` | Senior database architect | `database/schema.sql` + RLS policies + tenancy; pglast-validate. | opus | yes | backlog-agent, verify, service-builder, review-agent |
| `service-builder` | Senior backend engineer | Implement/extend a service under `services/*` (store-abstraction pattern). | opus | yes | schema-agent, backlog-agent, verify, review-agent |
| `review-agent` | Principal code reviewer | Review a change against the Definition of Done. | opus | no (read-only) | verify + hands fixes back to owners |
| `docs-agent` | Senior tech writer / DX | `README`/`docs/*`; regenerate (never hand-edit) service specs. | opus | docs | backlog-agent, verify, review-agent |
| `verify` | Senior build/release SDET | Run typecheck/lint/test/build (+ pglast) and report pass/fail. | opus | no | — (leaf) |

## How the work flows (story-first)

```
request
  └─ orchestrator (decomposes, routes)
       ├─ backlog-agent      → user story + GitHub issue
       ├─ schema-agent       → tables + RLS (pglast)          ┐ delegates verify
       ├─ service-builder    → store/routes/tests             ┤ delegates schema-agent, verify
       ├─ docs-agent         → README/docs + generated specs  │
       ├─ verify             → typecheck/lint/test/build       │
       └─ review-agent       → Definition-of-Done sign-off    ┘ delegates verify
```

Every specialist follows the **hand-off protocol** from `AGENTS.md` §5: accept or
delegate — never deny; pass complete context on hand-off (subagents are
stateless); single owner per scope; the review agent closes the loop.

## How collaborators use them

You normally **don't invoke anything manually**. The repo's root
[`CLAUDE.md`](../../CLAUDE.md) is loaded into every Claude Code session and tells
Claude to route each non-trivial request to the `orchestrator`, which then
delegates across the team — so the team starts working as soon as a collaborator
sends a query. The `orchestrator`'s `description` also marks it **"use
proactively / MUST BE USED"**, which is what drives Claude's automatic
delegation.

You can still steer it explicitly when you want a specific specialist:

```text
Use the orchestrator to build the rubric service end-to-end.
Use the schema-agent to add the rubric tables with RLS.
Use the service-builder to implement the rubric service.
Use the review-agent to check my branch against the Definition of Done.
Use verify to run the repo checks.
```

Run `/agents` to view, edit, or create more. Project agents take precedence over
personal (`~/.claude/agents/`) ones with the same name.

## Editing

Each agent is a Markdown file with YAML frontmatter (`name`, `description`,
optional `tools`/`model`) followed by its system prompt. Listing `Agent` in
`tools` is what lets a specialist spawn teammates. After editing a file on disk,
restart the Claude Code session (or use `/agents`) to reload it. Keep `name`
values unique across the directory.
