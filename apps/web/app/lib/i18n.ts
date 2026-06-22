import { cookies, headers } from "next/headers";

import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  resolveLocale,
  type Locale,
} from "@lms/i18n";

import { getSession, TENANT_ID } from "./auth";

/** Cookie that carries an explicit locale choice (set by the switcher). */
export const LOCALE_COOKIE = "lms_locale";

/**
 * Map raw input to a SUPPORTED locale, or `undefined` if it is not supported.
 *
 * `resolveLocale()` always returns a `Locale` ('en' for unknown input), which is
 * the right behaviour for the *final* fallback but not for the *precedence*
 * chain: an unsupported value at layer N must FALL THROUGH to layer N+1 rather
 * than short-circuit to 'en'. This narrows "present & supported" vs "absent /
 * unsupported" so the chain only stops on a real match.
 */
function pickSupported(input: string | null | undefined): Locale | undefined {
  if (!input) return undefined;
  const primary = input.trim().toLowerCase().split(/[-_;,\s]/)[0] ?? "";
  return (SUPPORTED_LOCALES as string[]).includes(primary)
    ? resolveLocale(input)
    : undefined;
}

/**
 * Resolve the tenant's default locale from the `tenant_setting` key
 * `i18n.default_locale`.
 *
 * SEAM (architect §3/§6): the web app does not yet have a read path to
 * `tenant_setting`, so this returns `undefined` and resolution falls through to
 * the user preference / cookie / Accept-Language layers. When a tenant-settings
 * read path exists, fetch `i18n.default_locale` for `tenantId` here and return
 * `pickSupported(value)`. Kept as a typed seam, not a blocker.
 */
async function resolveTenantDefaultLocale(
  _tenantId: string,
): Promise<Locale | undefined> {
  return undefined;
}

/**
 * Per-request locale resolution for the learner app (architect Decision 3).
 *
 * Precedence (first SUPPORTED value wins):
 *   1. tenant default  (`tenant_setting` key `i18n.default_locale` — seam above)
 *   2. user preference (`session.locale` from `/auth/me`)
 *   3. explicit cookie (`lms_locale`, set by the switcher pre-auth)
 *   4. Accept-Language header (first supported tag)
 *   5. `'en'`
 */
export async function resolveRequestLocale(): Promise<Locale> {
  // 1. Tenant default (seam — currently undefined).
  const tenantDefault = await resolveTenantDefaultLocale(TENANT_ID);
  if (tenantDefault) return tenantDefault;

  // 2. User preference.
  const session = await getSession();
  const userLocale = pickSupported(session?.locale);
  if (userLocale) return userLocale;

  // 3. Explicit cookie (switcher choice, esp. pre-auth on /login).
  const cookieLocale = pickSupported(cookies().get(LOCALE_COOKIE)?.value);
  if (cookieLocale) return cookieLocale;

  // 4. Accept-Language header (first tag).
  const acceptLanguage = headers().get("accept-language");
  const headerLocale = pickSupported(acceptLanguage?.split(",")[0]);
  if (headerLocale) return headerLocale;

  // 5. Fallback.
  return DEFAULT_LOCALE;
}
