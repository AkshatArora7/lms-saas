import { enMessages, type Messages } from "./messages/en.js";
import { esMessages } from "./messages/es.js";

/**
 * Supported locale codes. Extensible union — adding `'ar'`/`'he'` later means
 * adding a catalog + a `LOCALES` entry (with `direction: 'rtl'`) and nothing in
 * the apps changes (RTL is driven by `LOCALES[locale].direction`).
 */
export type Locale = "en" | "es";

/** Re-export the catalog shape so consumers can type message bags. */
export type { Messages } from "./messages/en.js";

export interface LocaleMeta {
  code: Locale;
  /** English label, e.g. for an admin settings list. */
  label: string;
  /** Endonym shown to users in the switcher, e.g. "Español". */
  nativeLabel: string;
  /** Text direction; drives `<html dir>`. en/es are ltr. */
  direction: "ltr" | "rtl";
}

/** Locale metadata registry — the single source for labels + direction. */
export const LOCALES: Record<Locale, LocaleMeta> = {
  en: { code: "en", label: "English", nativeLabel: "English", direction: "ltr" },
  es: { code: "es", label: "Spanish", nativeLabel: "Español", direction: "ltr" },
};

/** Ordered list of supported locales — handy for rendering the switcher. */
export const SUPPORTED_LOCALES: Locale[] = Object.keys(LOCALES) as Locale[];

/** The fallback locale used at the end of every resolution/fallback chain. */
export const DEFAULT_LOCALE: Locale = "en";

const CATALOGS: Record<Locale, Messages> = {
  en: enMessages,
  es: esMessages,
};

/**
 * Return the merged catalog for a locale. Synchronous + statically imported (no
 * IO) so it is safe to call directly in Server Components / RSC.
 */
export function getMessages(locale: Locale): Messages {
  return CATALOGS[locale] ?? CATALOGS[DEFAULT_LOCALE];
}

/**
 * Normalise arbitrary input (e.g. `es-MX`, `EN`, an Accept-Language tag) to a
 * SUPPORTED `Locale`. Unknown / undefined → `DEFAULT_LOCALE`. Never throws.
 */
export function resolveLocale(input: string | null | undefined): Locale {
  if (!input) return DEFAULT_LOCALE;
  // Take the primary subtag: `es-MX` → `es`, `en;q=0.9` → `en`.
  const primary = input.trim().toLowerCase().split(/[-_;,\s]/)[0] ?? "";
  return (SUPPORTED_LOCALES as string[]).includes(primary)
    ? (primary as Locale)
    : DEFAULT_LOCALE;
}

/**
 * Build a dotted-key union from a nested message shape — `"common.user"`,
 * `"auth.signIn"`, etc. Gives `t()` compile-time autocompletion + key checking.
 */
type DottedKeys<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : DottedKeys<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageKey = DottedKeys<Messages>;

/** Placeholder substitution values for `{var}` tokens. */
export type TranslateVars = Record<string, string | number>;

/** Walk a dotted path against a (possibly partial) catalog. */
function lookup(messages: unknown, key: string): string | undefined {
  const value = key
    .split(".")
    .reduce<unknown>(
      (acc, segment) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[segment]
          : undefined,
      messages,
    );
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Replace `{name}` tokens in a template from `vars`. */
function interpolate(template: string, vars?: TranslateVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const replacement = vars[name];
    return replacement === undefined ? match : String(replacement);
  });
}

/**
 * Translate a dotted `key` against `messages`, with the TESTED fallback chain:
 *   1. value in the active catalog,
 *   2. else the value in the `en` catalog,
 *   3. else the literal key string.
 * Never throws and never returns `undefined`. `{var}` tokens are interpolated.
 */
export function t(
  messages: Messages,
  key: MessageKey,
  vars?: TranslateVars,
): string {
  const value = lookup(messages, key) ?? lookup(enMessages, key) ?? key;
  return interpolate(value, vars);
}
