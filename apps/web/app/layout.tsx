import { I18nProvider, LOCALES, getMessages } from "@lms/i18n";

import { resolveRequestLocale } from "./lib/i18n";

export const metadata = {
  title: "LMS — Learn",
  description: "Multi-tenant learning experience",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Resolve the request locale (tenant default → user pref → cookie →
  // Accept-Language → en) and set <html lang/dir> from locale metadata. The
  // server-resolved catalog is handed to the client provider (same server→client
  // prop handoff as tenant branding).
  const locale = await resolveRequestLocale();
  const messages = getMessages(locale);

  return (
    <html dir={LOCALES[locale].direction} lang={locale}>
      <body>
        <I18nProvider locale={locale} messages={messages}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
