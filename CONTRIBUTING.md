# Contributing

Welcome — this is the **start here** for contributing to the LMS monorepo,
whether you are a human or an AI agent.

> **The authoritative ruleset is [`AGENTS.md`](AGENTS.md).** Read it before you
> change anything. This file is a short on-ramp; it does **not** restate the
> rules — `AGENTS.md` is the single source of truth (prime directives, technical
> guardrails, the multi-agent model, and the Definition of Done).

## Quick loop

1. **Sync `main`.** `git fetch origin && git checkout main && git pull --ff-only`,
   then branch off fresh `main`.
2. **Story-first, and claim it.** No feature without a **user story** in
   [`docs/backlog/backlog.json`](docs/backlog/backlog.json) and a linked GitHub
   issue. Assign the issue to its worker (`gh issue edit <n> --add-assignee @me`)
   and move it to In Progress. See [`AGENTS.md` §1–§2](AGENTS.md#1-prime-directives).
3. **Branch and implement** against the issue's acceptance criteria.
4. **Validate locally** — the required suite plus the repo-policy guards:
   ```bash
   pnpm lint && pnpm typecheck && pnpm build && pnpm test
   pnpm check:rules && pnpm test:checks
   ```
   `check:rules` runs the RLS-for-new-tenant-table and commit-hygiene guards
   (see [`AGENTS.md` §3.1](AGENTS.md#31-automated-checks)); CI runs the same.
5. **Commit** with a [Conventional Commit](https://www.conventionalcommits.org/)
   prefix referencing the issue (e.g. `feat(scope): … (Closes #N)`). **No** AI /
   co-author trailer and **no** "Generated with/by" footer — the commit guard
   rejects them.
6. **Open a PR.** CI (**Lint · Typecheck · Build · Test**, including the repo
   rules) is a required check and must be green; keep the branch up to date with
   `main` before merge.

For the full contract — isolation guardrails, generated-artifact rules, secrets
handling, the agent roles, and the Definition of Done — read
**[`AGENTS.md`](AGENTS.md)**.
