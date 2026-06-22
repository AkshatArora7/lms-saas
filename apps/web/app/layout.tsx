import { I18nProvider, LOCALES, getMessages } from "@lms/i18n";

import { resolveCurrentTenantId } from "./lib/auth";
import { loadBranding } from "./lib/branding";
import { resolveRequestLocale } from "./lib/i18n";

export const metadata = {
  title: "LMS — Learn",
  description: "Multi-tenant learning experience",
};

/**
 * Guard against a `</style>` breakout in tenant-admin-authored CSS. CSS cannot
 * execute JS, but an unescaped closing tag would let the value escape the
 * <style> element and inject arbitrary markup. We neutralise any case/spacing
 * variant of a closing style tag; everything else is left as authored.
 */
function sanitizeCustomCss(css: string): string {
  return css.replace(/<\s*\/\s*style/gi, "<\\/style");
}

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

  // Resolve the effective (inheritance-resolved) branding ONCE per request,
  // BEFORE page components render. This populates the request-scoped brand
  // holder that the synchronous getBranding() reads on every page, and gives us
  // the two effective fields not covered by themeToCssVars/the Brand token set:
  // faviconUrl and customCss. Offline-safe — null when the service is
  // unreachable, in which case pages render with the clean default brand.
  const tenantId = await resolveCurrentTenantId();
  const branding = await loadBranding(tenantId);
  const faviconUrl = branding?.faviconUrl ?? null;
  const customCss = branding?.customCss ? sanitizeCustomCss(branding.customCss) : null;

  return (
    <html dir={LOCALES[locale].direction} lang={locale}>
      <head>
        {faviconUrl ? <link href={faviconUrl} rel="icon" /> : null}
        {customCss ? (
          // Tenant-authored white-label CSS. Injected as inert text inside a
          // <style> tag (CSS cannot execute JS); the closing-tag breakout is
          // neutralised by sanitizeCustomCss above.
          <style
            dangerouslySetInnerHTML={{ __html: customCss }}
            data-lms-tenant-css=""
          />
        ) : null}
      </head>
      <body>
        <I18nProvider locale={locale} messages={messages}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
