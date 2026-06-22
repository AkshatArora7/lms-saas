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
 * Map raw input to a SUPPORTED locale, or `undefined` if it is not supported, so
 * an unsupported value at one precedence layer falls through to the next rather
 * than short-circuiting to the 'en' fallback. (See the learner app's i18n.ts.)
 */
function pickSupported(input: string | null | undefined): Locale | undefined {
  if (!input) return undefined;
  const primary = input.trim().toLowerCase().split(/[-_;,\s]/)[0] ?? "";
  return (SUPPORTED_LOCALES as string[]).includes(primary)
    ? resolveLocale(input)
    : undefined;
}

/**
 * Resolve the tenant's default locale (`tenant_setting` key `i18n.default_locale`).
 * SEAM (architect §3/§6): no tenant-settings read path in the app yet, so this
 * returns `undefined` and resolution falls through. Not a blocker.
 */
async function resolveTenantDefaultLocale(
  _tenantId: string,
): Promise<Locale | undefined> {
  return undefined;
}

/**
 * Per-request locale resolution for the admin console (architect Decision 3).
 * Precedence (first SUPPORTED value wins): tenant default → user preference
 * (`session.locale`) → `lms_locale` cookie → Accept-Language → 'en'.
 */
export async function resolveRequestLocale(): Promise<Locale> {
  const tenantDefault = await resolveTenantDefaultLocale(TENANT_ID);
  if (tenantDefault) return tenantDefault;

  const session = await getSession();
  const userLocale = pickSupported(session?.locale);
  if (userLocale) return userLocale;

  const cookieLocale = pickSupported(cookies().get(LOCALE_COOKIE)?.value);
  if (cookieLocale) return cookieLocale;

  const acceptLanguage = headers().get("accept-language");
  const headerLocale = pickSupported(acceptLanguage?.split(",")[0]);
  if (headerLocale) return headerLocale;

  return DEFAULT_LOCALE;
}
