# Internationalization & Localization (i18n)

This LMS ships a lightweight, **in-house** i18n foundation for the Next.js 14 App
Router monorepo — no `next-intl` / `i18next` / `react-intl`. The whole mechanism
is a small typed message-catalog package plus a few per-app seams. This guide
tells a contributor how the pieces fit together, **how to add a locale**, and
**how to extract more strings**.

> **Status (issue #88 foundation slice).** English (`en`) and Spanish (`es`)
> ship today. The locale-resolution chain, the `<html lang/dir>` wiring, per-user
> persistence, and the locale switcher are all in place. Only the **core flows**
> are fully localized (see [Localized today](#what-is-localized-today)); the
> remaining strings and a full RTL CSS audit are documented follow-ups.

---

## 1. The mechanism — `@lms/i18n`

All locale logic lives in the `@lms/i18n` workspace package
(`packages/i18n`). It is plain TypeScript (React only for the client provider),
so it is safe to import from Server Components, BFF route handlers, and client
components alike.

### Server components

```ts
import { getMessages, t } from "@lms/i18n";
import { resolveRequestLocale } from "../lib/i18n"; // per-app

const m = getMessages(await resolveRequestLocale());
// ...
<h1>{t(m, "home.title")}</h1>
<p>{t(m, "roster.heading", { course })}</p> // {var} interpolation
```

- `getMessages(locale)` — synchronous, statically imported (no IO); returns the
  catalog for a locale. Source: `packages/i18n/src/core.ts:45`.
- `t(messages, key, vars?)` — pure dotted-key lookup with `{var}` interpolation.
  `key` is type-checked against the catalog shape. Source:
  `packages/i18n/src/core.ts:107`.

### Client components

```tsx
"use client";
import { useTranslations } from "@lms/i18n";

const { t, locale } = useTranslations();
// ...
<button>{t("auth.signIn")}</button>
```

- `<I18nProvider locale messages>` — `"use client"`; the **server** resolves the
  locale + catalog and passes them in as props (the same server→client handoff
  used for tenant branding), so the client never re-resolves the locale or
  imports every catalog. Source: `packages/i18n/src/provider.tsx:38`.
- `useTranslations()` — returns a `t(key, vars?)` bound to the active catalog,
  plus the active `locale`. Throws if used outside the provider. Source:
  `packages/i18n/src/provider.tsx:57`.

### Fallback chain — never throws, never renders `undefined`

`t()` resolves a key in this order (source `packages/i18n/src/core.ts:107-114`):

1. value in the **active** locale's catalog, else
2. value in the **`en`** catalog, else
3. the **literal key string**.

An empty string counts as "absent" and falls through. This runtime guard sits
alongside the compile-time typing below — both protect against missing keys.

---

## 2. Message catalogs

- `packages/i18n/src/messages/en.ts` — the **source of truth** for keys.
- `packages/i18n/src/messages/es.ts` — Spanish, typed `esMessages: Messages`.

Both are nested objects **namespaced by flow**. The current top-level
namespaces (`en.ts`) are:

`common` · `auth` · `home` · `profile` · `attendance` · `roster` · `admin` ·
`editor`.

**Typing keeps catalogs in sync.** `type Messages = typeof enMessages`, and every
other catalog is declared `: Messages`. A missing or misnamed key in `es.ts` is a
**compile error** (`packages/i18n/src/messages/es.ts:1-9`), and `t(messages, key)`
only accepts known dotted keys via the `MessageKey` union
(`packages/i18n/src/core.ts:66-72`).

---

## 3. Locale resolution order

Resolution happens per request in **each app** via
`resolveRequestLocale(): Promise<Locale>`
(`apps/web/app/lib/i18n.ts:58`, `apps/admin/app/lib/i18n.ts`).
The **first supported** value wins; an unsupported value at any layer **falls
through** to the next (it does not short-circuit to `en`):

1. **Tenant default** — `tenant_setting` key `i18n.default_locale` for the tenant.
   *Currently a typed seam:* `resolveTenantDefaultLocale()` returns `undefined`
   until the app has a `tenant_setting` read path, so resolution falls through.
   See `apps/web/app/lib/i18n.ts:42-46` and [Open seams](#5-open-seams--follow-ups).
2. **User preference** — `session.locale`, sourced from identity `GET /auth/me`
   (`apps/web/app/lib/auth.ts` / `apps/admin/app/lib/auth.ts`).
3. **`lms_locale` cookie** — the explicit switcher choice (works pre-auth, e.g.
   on `/login`).
4. **`Accept-Language`** header — first tag, normalised (`es-MX` → `es`).
5. **`'en'`** — final fallback (`DEFAULT_LOCALE`).

> **Order is deliberate:** tenant default outranks user preference, per issue #88.
> Do not "helpfully" reorder these layers.

Every candidate is narrowed to a supported `Locale` before it can win. Unknown
input is normalised by `resolveLocale()` (`packages/i18n/src/core.ts:53`):
`es-MX` → `es`, `en;q=0.9` → `en`, unknown/empty → `en`.

**Where it plugs in.** The **root layout** (`apps/web/app/layout.tsx:19-29`,
`apps/admin/app/layout.tsx`) calls `resolveRequestLocale()`, sets
`<html lang={locale} dir={LOCALES[locale].direction}>`, calls `getMessages()`,
and wraps the tree in `<I18nProvider>`.

---

## 4. Per-user locale persistence & the switcher

The user's choice is persisted to `app_user.locale` (an existing column —
`database/schema.sql:137`, no schema change for #88) and mirrored in a cookie.

**Identity service** (`services/identity/src/routes.ts`):

- `GET /auth/me` returns `locale` — a tenant-scoped `app_user` read keyed by the
  verified token's `claims.sub`, defaulting to `'en'` (`routes.ts:294-313`).
- `PATCH /users/me/locale` — body `{ locale }`, validated against the
  `SUPPORTED_LOCALES` allowlist (`en` / `es`); updates `app_user.locale` for
  `claims.sub` under the caller's tenant and returns **204** (`routes.ts:319-344`).
  **IDOR-safe:** the target user id comes from the verified token, never the
  body — a `userId` in the body is ignored. 400 on unsupported locale, 401
  without a bearer, 404 if the user isn't visible to the tenant.

**BFF** (`apps/web/app/api/locale/route.ts`, `apps/admin/app/api/locale/route.ts`):

- `POST /api/locale` re-validates against `SUPPORTED_LOCALES`. **Authenticated:**
  forwards to identity `PATCH /users/me/locale` with the httpOnly access cookie as
  `Authorization: Bearer` + `x-tenant-id`, server-side — the token never reaches
  the browser, and no user id is sent. **Unauthenticated:** no DB write.
- In both cases it sets the `lms_locale` cookie mirror
  (`httpOnly: false` — a preference, not a credential; `sameSite: lax`, `path: /`,
  1-year `maxAge`) so the next RSC render picks up the choice.

**Switcher.** `LocaleSwitcher` is a presentational, accessible native `<select>`
in `@lms/ui` (`packages/ui/src/components/locale-switcher.tsx`), exported from the
package index. Each app wraps it in an `AppLocaleSwitcher`
(`apps/web/app/lib/locale-switcher.tsx`, `apps/admin/app/lib/locale-switcher.tsx`)
that `POST`s to `/api/locale` and then calls `router.refresh()` so RSC re-renders
in the new locale.

---

## 5. RTL support

Text direction is **driven by locale metadata, never hard-coded**. Each entry in
`LOCALES` carries a `direction: 'ltr' | 'rtl'` (`packages/i18n/src/core.ts:25-28`),
and the root layout renders `<html dir={LOCALES[locale].direction}>`. `en` and
`es` are both `ltr`.

Adding a right-to-left locale (`ar`, `he`) is a catalog + a `LOCALES` entry with
`direction: 'rtl'` — `dir="rtl"` then ships with **zero layout changes**. A full
RTL CSS / logical-properties audit of `@lms/ui` is a **documented follow-up**, not
part of this foundation slice.

---

## How to add a locale

Example: adding French (`fr`).

1. **Extend the union & registry** in `packages/i18n/src/core.ts`:
   - add `"fr"` to the `Locale` union (`core.ts:9`);
   - add an entry to `LOCALES` with `code`, `label`, `nativeLabel`, and
     `direction` (`'ltr'`, or `'rtl'` for `ar`/`he`) — `core.ts:25-28`.
2. **Add the catalog** `packages/i18n/src/messages/fr.ts` exporting
   `fr: Messages`. Typing it `: Messages` makes any missing key a compile error
   — copy `es.ts` and translate. Wire it into the `CATALOGS` map in `core.ts:36-39`.
3. **Allowlist it server-side** so persistence accepts it: it is already covered
   by `SUPPORTED_LOCALES` (derived from `LOCALES`) in `@lms/i18n`, and the
   identity service's `SUPPORTED_LOCALES` / `isSupportedLocale`
   (`services/identity/src/store.ts`) — keep these in step so
   `PATCH /users/me/locale` and the BFF accept the new code.
4. **Rebuild** the package: `pnpm --filter @lms/i18n build`, then typecheck the
   apps so any newly-required keys surface.

The switcher, `<html dir>`, the resolution chain, and the cookie all pick up the
new locale automatically — no app or layout edits required.

---

## How to extract more strings

The documented mechanical pattern (frontend-dev §4 of the #88 handshake):

1. **Add the key** to `packages/i18n/src/messages/en.ts` under the right flow
   namespace, then **mirror it in `es.ts`** (and every other catalog). It is a
   compile error until you do.
2. **Server Component:** `const m = getMessages(await resolveRequestLocale());`
   then `{t(m, "flow.key")}` (vars: `t(m, "roster.title", { course })`). Mount
   `<AppLocaleSwitcher/>` in the AppShell `actions` if not already present.
3. **Client Component:** `const { t } = useTranslations();` then
   `{t("flow.key")}` (no `messages` argument). For arrays of labels, type entries
   as `Array<{ labelKey: MessageKey; ... }>`.
4. **Rebuild** `@lms/i18n` (`pnpm --filter @lms/i18n build`) so the apps pick up
   the new keys from `dist`.

### What is localized today

Core flows are fully localized in `en` + `es`:

- **web:** login form, dashboard, profile, attendance, and the teach roster.
- **admin:** login form, dashboard, and the page editor.

**Remaining (documented follow-up, out of foundation scope):** non-core screen
strings (e.g. web dashboard nav buttons, roster role labels, admin nav items,
page-editor toolbar) were intentionally left hardcoded, plus the full RTL CSS
audit of `@lms/ui`. Extracting them is mechanical — follow the pattern above.

---

## Source map

| Concern | File |
| ------- | ---- |
| Core API (`getMessages`, `t`, `resolveLocale`, `LOCALES`, types) | `packages/i18n/src/core.ts` |
| Client provider + `useTranslations` | `packages/i18n/src/provider.tsx` |
| English catalog (source of truth) | `packages/i18n/src/messages/en.ts` |
| Spanish catalog | `packages/i18n/src/messages/es.ts` |
| Per-app resolution chain | `apps/web/app/lib/i18n.ts`, `apps/admin/app/lib/i18n.ts` |
| Root-layout wiring (`lang`/`dir` + provider) | `apps/web/app/layout.tsx`, `apps/admin/app/layout.tsx` |
| Per-user persistence (identity) | `services/identity/src/routes.ts` (`/auth/me`, `PATCH /users/me/locale`) |
| BFF persistence + cookie | `apps/web/app/api/locale/route.ts`, `apps/admin/app/api/locale/route.ts` |
| Switcher (presentational) | `packages/ui/src/components/locale-switcher.tsx` |
| Per-app switcher wrapper | `apps/{web,admin}/app/lib/locale-switcher.tsx` |
