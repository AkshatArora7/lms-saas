// Core (server + client safe — pure TS, no React)
export type {
  Locale,
  LocaleMeta,
  Messages,
  MessageKey,
  TranslateVars,
} from "./core.js";
export {
  LOCALES,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  getMessages,
  resolveLocale,
  t,
} from "./core.js";

// Catalogs (exported so apps can pass a server-resolved bag to the provider)
export { enMessages } from "./messages/en.js";
export { esMessages } from "./messages/es.js";

// Client provider + hook
export type { I18nProviderProps, UseTranslations } from "./provider.js";
export { I18nProvider, useTranslations } from "./provider.js";
