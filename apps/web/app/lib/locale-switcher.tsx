"use client";

import { LocaleSwitcher } from "@lms/ui";
import { useTranslations, type Locale } from "@lms/i18n";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactElement } from "react";

/**
 * Learner-app locale switcher: binds the presentational `<LocaleSwitcher>` to the
 * BFF `POST /api/locale` (persist + cookie) and refreshes RSC so the whole tree
 * re-renders in the new locale. The active locale comes from the i18n provider
 * (`useTranslations().locale`), seeded by the server-resolved locale — no prop
 * drilling needed. The control's label is localized via `t`.
 */
export function AppLocaleSwitcher(): ReactElement {
  const router = useRouter();
  const { t, locale } = useTranslations();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function onChange(next: Locale): Promise<void> {
    if (next === locale) return;
    setBusy(true);
    try {
      await fetch("/api/locale", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale: next }),
      });
    } finally {
      setBusy(false);
      startTransition(() => router.refresh());
    }
  }

  return (
    <LocaleSwitcher
      disabled={busy || pending}
      label={t("common.chooseLanguage")}
      onChange={(next) => {
        void onChange(next);
      }}
      value={locale as Locale}
    />
  );
}
