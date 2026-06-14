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
(`backlog-agent`, `schema-agent`, `service-builder`, `ux-designer`,
`frontend-dev`, `rca-agent`, `docs-agent`, `verify`, `review-agent`).

For any **bug, failing test, broken build, or CI failure**, engage the
`rca-agent` first (via the orchestrator): it finds the true root cause and then
delegates the fix to the owning specialist — never patch the symptom directly.

Only handle a request directly without the team when it is a trivial,
single-step lookup (e.g. "what port does the grading service use?").

The team and how work flows are documented in
[`.claude/agents/README.md`](.claude/agents/README.md).

## Non-negotiable workflow (full contract in [`AGENTS.md`](AGENTS.md))

1. **Sync `main` first.** The first agent on a ticket runs `git fetch origin`
   then `git checkout main && git pull --ff-only` and branches off fresh `main`.
2. **Story-first.** No feature without a user story + linked GitHub issue.
3. **Isolation is sacred.** New tenant-scoped tables ship their RLS policy in the
   same change; never weaken tenant scoping.
4. **Prove it.** Not done until pglast + lint + typecheck + test + build pass and
   `review-agent` signs off the Definition of Done.
5. **Every PR is validated.** CI (Lint · Typecheck · Build · Test + pglast) is a
   **required check** — branches must be up to date and pass before merge.
6. **Commit hygiene.** Conventional Commits referencing the issue (`Closes #N`);
   **never** add a `Co-authored-by: Copilot` trailer.

Read [`AGENTS.md`](AGENTS.md) for the complete, authoritative rules.
