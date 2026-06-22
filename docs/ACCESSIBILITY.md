# Accessibility Standard — WCAG 2.2 AA (core flows)

> The bar every contributor must meet for UI work, and how it is enforced.
> The detailed, per-screen acceptance bar this summarizes lives in
> [`.claude/handshakes/a11y-acceptance-bar.json`](../.claude/handshakes/a11y-acceptance-bar.json).

## The standard

The **core flows** of `apps/web` (learner) and `apps/admin` meet **WCAG 2.2 AA**.
Concretely, every UI change in scope must satisfy:

- **Keyboard operability** — everything reachable and operable without a mouse,
  in a logical (reading-order) tab sequence, with no keyboard traps. Native
  `<button>`/`<a>`/`<input>` first; composite widgets follow the matching
  WAI-ARIA pattern.
- **Visible focus** — a focus indicator on every interactive element, drawn from
  the theme token `var(--lms-focus)` (the shared rings are `outline: 3px solid
  var(--lms-focus); outline-offset: 2px`). Never `outline: none` without an
  equivalent visible replacement.
- **Color & contrast** — body text ≥ **4.5:1**; large text (≥ 24px, or ≥ 18.66px
  bold) and **UI components / graphics / focus indicators** ≥ **3:1**. Meaning is
  never carried by color alone (status uses text labels — "Present", "Overdue",
  "Draft", "Published").
- **Labelled forms with associated errors** — every control has a
  programmatically associated visible `<label>`; errors and help are linked via
  `aria-describedby`; invalid controls set `aria-invalid="true"`; status changes
  are announced.
- **Landmark + heading structure with a skip-link** — one `<h1>` per page, a
  single `<main>`, a banner (topbar), and labelled `nav`/`aside` where present;
  heading levels do not skip; a visible-on-focus skip-link jumps to main content.
- **ARIA only where needed** — native semantics first; ARIA roles/states only
  where native HTML cannot express the pattern, with correct names/roles/values
  and no redundant or duplicated roles.
- **Reduced motion** — all non-essential transitions/animations are removed or
  reduced under `@media (prefers-reduced-motion: reduce)`.

## Colors come from theme tokens — never hardcoded

All colors must resolve from the tenant theme tokens (`var(--lms-bg)`,
`var(--lms-surface)`, `var(--lms-text)`, `var(--lms-text-muted)`,
`var(--lms-accent)`, `var(--lms-danger)`, `var(--lms-focus)`, …). **Never
hardcode a color value.** This keeps each tenant's dual-tone (web/admin) branding
accessible and lets contrast be governed at the token level rather than per
screen.

Notes that follow from this:

- `var(--lms-text-subtle)` is **below 4.5:1** on white and is permitted **only**
  for placeholder text and decorative icon strokes — never for meaningful body or
  label text.
- `var(--lms-accent)` is tenant-controlled and used for body links / link-cards.
  Its text-contrast floor is a **brand-onboarding** concern (see the open
  question in the acceptance-bar JSON), not a per-screen workaround.

## How it is enforced / regression-tested

Automated a11y regression coverage lives in the shared UI package and runs in CI:

- **Test file:** [`packages/ui/src/a11y.test.tsx`](../packages/ui/src/a11y.test.tsx)
  — `jest-axe` `toHaveNoViolations()` assertions over `AppShell`, `Field`+`Input`,
  `Alert`, `Badge`, and `Button`, plus structural checks (skip-link is the first
  focusable element and targets `main#main`; decorative vs. named `BrandMark`;
  `Field` label/error/`aria-invalid` association).
- **Wiring:** `packages/ui/vitest.config.ts` (jsdom) + `packages/ui/vitest.setup.ts`
  register the `toHaveNoViolations` matcher. The suite runs under
  `pnpm test` / `pnpm --filter @lms/ui test`, so the CI **Test** job picks it up.
  No Postgres and no network are required.
- **Contributor rule:** when you add a shared UI primitive or component to
  `@lms/ui`, **add an axe assertion** for it in `a11y.test.tsx`.

Some requirements are **not** axe-detectable — focus order, skip-link activation,
roving-tabindex toolbar navigation, focus-indicator visibility, and reduced-motion
behaviour. These are covered by explicit structural/keyboard assertions (e.g. the
skip-link-first test) and by CSS that uses `:focus-visible` and the
`prefers-reduced-motion` media query.

## Shared building blocks

- **Skip-link + main landmark** live in the `@lms/ui` `AppShell`
  ([`packages/ui/src/components/shell.tsx`](../packages/ui/src/components/shell.tsx)):
  a visible-on-focus `<a class="lms-skip-link" href="#main">Skip to main
  content</a>` rendered as the first focusable element, plus `<main id="main">`.
  One fix covers every shelled screen. The `.lms-skip-link` styles are
  token-based and off-screen until focus
  ([`packages/ui/src/styles.ts`](../packages/ui/src/styles.ts)).
- **Decorative `BrandMark`** — when the brand name is shown as adjacent visible
  text (topbar, login), `BrandMark` takes a `decorative` prop that sets
  `aria-hidden` on the wrapper and `alt=""` on the logo image, so the accessible
  name is not duplicated.
- **Login error association pattern** (web + admin login forms, e.g.
  [`apps/web/app/login/login-form.tsx`](../apps/web/app/login/login-form.tsx)):
  on submit failure, both credential inputs get `aria-invalid` plus
  `aria-describedby="login-error"` pointing at a `<div id="login-error">` that
  wraps a danger `Alert` (`role="alert"`); a visually-hidden
  `aria-live="polite"` `role="status"` element announces the "Signing in…" busy
  state. New form errors should follow this pattern (the shared `Field` component
  already wires label/`aria-describedby`/`aria-invalid`).

## Coverage

In scope and verified for this standard (the **core flows**):

- **web (learner):** login, dashboard/home, course roster, attendance, profile.
- **admin:** login, dashboard/home, rich-page editor (page-editor).

All other flows are a **follow-up** and are not yet held to this bar. Do not
assume coverage beyond the flows listed above.
