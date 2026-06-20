# Handshakes (per-task shared context)

This directory holds the **live handshake file** for each in-flight task — the
single source of truth that the stateless subagents read and update as work moves
across the SDLC team. See [`../agents/handshake.template.md`](../agents/handshake.template.md)
for the structure and [`../agents/README.md`](../agents/README.md) for how the
team uses it.

- The **orchestrator** creates `.claude/handshakes/<branch>.md` from the template
  at the start of a task and names it after the feature branch
  (slashes → `-`, e.g. `feat-rubric-service.md`).
- Every agent reads it in full before acting and updates its own section before
  handing off.
- The live `*.md` handshakes are **ephemeral working context and are git-ignored**
  (only this README is tracked). They are not part of the shipped change.
