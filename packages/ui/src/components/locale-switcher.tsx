"use client";

import { type ChangeEvent, type ReactElement } from "react";

import { LOCALES, SUPPORTED_LOCALES, type Locale } from "@lms/i18n";

export interface LocaleSwitcherProps {
  /** Currently active locale. */
  value: Locale;
  /** Fired with the chosen locale. The caller persists + refreshes. */
  onChange: (locale: Locale) => void;
  /** Disable while a persist request is in flight. */
  disabled?: boolean;
  /**
   * Accessible label for the control. Defaults to "Language" — pass a localized
   * label (e.g. `t("common.language")`) so the control matches the UI locale.
   */
  label?: string;
  /** Visually hide the label (keeps it for screen readers). Default true. */
  hideLabel?: boolean;
  id?: string;
  className?: string;
}

/**
 * Presentational locale switcher: a labelled native `<select>` of the supported
 * `LOCALES` (each shown by its endonym, e.g. "Español"). Native `<select>` is
 * deliberate — it is keyboard-operable, screen-reader friendly, and the OS picker
 * is reliable on touch (≥44px control height comes from `.lms-select`/
 * `--lms-control-h`). Colours/spacing resolve from theme tokens only; no
 * hardcoded colours. The component is purely controlled — persistence
 * (`POST /api/locale` + cookie + `router.refresh()`) lives in a per-app wrapper.
 */
export function LocaleSwitcher({
  value,
  onChange,
  disabled,
  label = "Language",
  hideLabel = true,
  id = "lms-locale-switcher",
  className,
}: LocaleSwitcherProps): ReactElement {
  function handleChange(event: ChangeEvent<HTMLSelectElement>): void {
    onChange(event.target.value as Locale);
  }

  const wrapperClass = ["lms-locale-switcher", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={wrapperClass}>
      <label
        className={hideLabel ? "lms-sr-only" : "lms-field__label"}
        htmlFor={id}
      >
        {label}
      </label>
      <select
        className="lms-select lms-locale-switcher__select"
        disabled={disabled}
        id={id}
        onChange={handleChange}
        value={value}
      >
        {SUPPORTED_LOCALES.map((code) => (
          <option key={code} value={code}>
            {LOCALES[code].nativeLabel}
          </option>
        ))}
      </select>
    </div>
  );
}
