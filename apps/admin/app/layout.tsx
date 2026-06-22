import { I18nProvider, LOCALES, getMessages } from "@lms/i18n";

import { resolveRequestLocale } from "./lib/i18n";

export const metadata = {
  title: "LMS — Admin",
  description: "Tenant & institution administration",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Resolve the request locale and set <html lang/dir> from locale metadata; the
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
