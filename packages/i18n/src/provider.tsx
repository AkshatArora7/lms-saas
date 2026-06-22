"use client";

import {
  createContext,
  useContext,
  useMemo,
  type ReactElement,
  type ReactNode,
} from "react";

import {
  t as translate,
  type Locale,
  type Messages,
  type MessageKey,
  type TranslateVars,
} from "./core.js";

/**
 * Client-side i18n. The SERVER resolves the locale + catalog and passes them in
 * as props (same server→client handoff as tenant `brand`), so the client never
 * resolves locale or imports every catalog. `useTranslations()` returns a `t`
 * bound to the active catalog plus the current `locale`.
 */
interface I18nContextValue {
  locale: Locale;
  messages: Messages;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export interface I18nProviderProps {
  locale: Locale;
  messages: Messages;
  children: ReactNode;
}

export function I18nProvider({
  locale,
  messages,
  children,
}: I18nProviderProps): ReactElement {
  const value = useMemo<I18nContextValue>(
    () => ({ locale, messages }),
    [locale, messages],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export interface UseTranslations {
  /** Translate a dotted key with the locale→en→key fallback chain. */
  t: (key: MessageKey, vars?: TranslateVars) => string;
  /** The active locale, e.g. for `lang`-aware client formatting. */
  locale: Locale;
}

export function useTranslations(): UseTranslations {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useTranslations must be used within an <I18nProvider>.");
  }
  const { messages, locale } = ctx;
  const bound = useMemo<UseTranslations>(
    () => ({
      t: (key, vars) => translate(messages, key, vars),
      locale,
    }),
    [messages, locale],
  );
  return bound;
}
