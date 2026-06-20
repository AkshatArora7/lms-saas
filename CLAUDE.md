# CLAUDE.md — how Claude Code works in this repo

Claude Code loads this file automatically at the start of **every** session (and
into every custom subagent). It tells Claude to put the **senior agent team** to
work on each request — collaborators don't have to invoke anything by hand.

## Always engage the agent team

For any non-trivial request in this monorepo (build/extend a service, change the
schema or RLS, add a feature end-to-end, **design or build a UI screen**, groom
the backlog, **debug a bug or failing build**), **delegate to the `orchestrator`
subagent immediately** instead of doing the work inline. The orchestrator
decomposes the request and routes each task to the right specialist
(`backlog-agent`, `architect`, `ux-designer`, `schema-agent`, `service-builder`,
`frontend-dev`, `qa-agent`, `security-agent`, `docs-agent`). The team shares
context through a per-task **handshake file** (`.claude/handshakes/<branch>.md`,
from `.claude/agents/handshake.template.md`) — agents read it before acting and
update it on hand-off, so context is grounded rather than re-invented.

For any **bug, failing test, broken build, or CI failure**, engage the
`qa-agent` first (via the orchestrator): it finds the true root cause and then
delegates the fix to the owning specialist — never patch the symptom directly.

Only handle a request directly without the team when it is a trivial,
single-step lookup (e.g. "what port does the grading service use?").

The team and how work flows are documented in
[`.claude/agents/README.md`](.claude/agents/README.md).

## Non-negotiable workflow (full contract in [`AGENTS.md`](AGENTS.md))

1. **Sync `main` first.** The first agent on a ticket runs `git fetch origin`
   then `git checkout main && git pull --ff-only` and branches off fresh `main`.
2. **Story-first, and claim it.** No feature without a user story + linked GitHub
   issue; **assign it to the repo owner and move it to In Progress** on the
   project board before starting (`gh issue edit <n> --add-assignee @me`).
3. **Isolation is sacred.** New tenant-scoped tables ship their RLS policy in the
   same change; never weaken tenant scoping.
4. **Prove it.** Not done until pglast + lint + typecheck + test + build pass
   (`qa-agent`) and `security-agent` signs off the Definition of Done.
5. **Every PR is validated.** CI (Lint · Typecheck · Build · Test + pglast) is a
   **required check** — branches must be up to date and pass before merge.
6. **Commit hygiene.** Conventional Commits referencing the issue (`Closes #N`);
   **never** add a `Co-authored-by: Copilot` trailer.

Read [`AGENTS.md`](AGENTS.md) for the complete, authoritative rules.
