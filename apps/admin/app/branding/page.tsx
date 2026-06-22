import { redirect } from "next/navigation";
import {
  Alert,
  Badge,
  BrandMark,
  Button,
  Card,
  Grid,
  Inline,
  PageHeader,
  Stack,
} from "@lms/ui";
import { getMessages, t } from "@lms/i18n";

import { getBranding } from "../lib/branding";
import { getSession, isAdmin } from "../lib/auth";
import { getTenant, getTenantBranding } from "../lib/tenant-api";
import { resolveRequestLocale } from "../lib/i18n";
import { AppLocaleSwitcher } from "../lib/locale-switcher";
import { adminPolishCss, AppShell } from "../lib/ui";
import SignOutButton from "../sign-out-button";

const brandingCss = `${adminPolishCss}
.brand-token {
  color: var(--lms-text-muted);
  font-size: var(--lms-font-size-sm);
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
.brand-token strong {
  color: var(--lms-text);
}
.brand-preview {
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius-md);
  padding: var(--lms-space-4);
}
.brand-preview__name {
  font-weight: 700;
  margin: 0;
  overflow-wrap: anywhere;
}
.brand-preview__tagline {
  color: var(--lms-text-muted);
  margin: 0;
  overflow-wrap: anywhere;
}
.brand-swatch {
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius-pill);
  height: 18px;
  width: 18px;
  flex-shrink: 0;
}
.brand-swatch--empty {
  background: repeating-linear-gradient(
    45deg,
    var(--lms-surface-2),
    var(--lms-surface-2) 4px,
    var(--lms-border) 4px,
    var(--lms-border) 8px
  );
}
`;

/** A single colour token row: swatch + value, or a clear "not set" state. */
function ColorRow({
  label,
  value,
  fallback,
}: {
  label: string;
  value: string | null;
  fallback: string;
}) {
  return (
    <div className="brand-token">
      <Inline align="center" gap={2}>
        <span
          aria-hidden="true"
          className={`brand-swatch${value ? "" : " brand-swatch--empty"}`}
          style={value ? { background: value } : undefined}
        />
        <span>
          <strong>{label}</strong> {value ?? fallback}
        </span>
      </Inline>
    </div>
  );
}

export default async function BrandingShowcase() {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);
  const m = getMessages(await resolveRequestLocale());

  const actions = (
    <>
      <AppLocaleSwitcher />
      <SignOutButton />
    </>
  );

  if (!isAdmin(session)) {
    return (
      <AppShell brand={brand} actions={actions}>
        <PageHeader
          title={t(m, "admin.notAuthorizedTitle")}
          subtitle={t(m, "admin.notAuthorizedSubtitle")}
        />
        <Alert tone="warning">
          You are signed in as <strong>{session.userId}</strong>.{" "}
          {t(m, "admin.notAuthorizedBody")}
        </Alert>
      </AppShell>
    );
  }

  const [tenant, brandingResponse] = await Promise.all([
    getTenant(session.tenantId),
    getTenantBranding(session.tenantId),
  ]);

  const effective = brandingResponse?.branding ?? null;
  const hasOverrides = brandingResponse?.overrides != null;
  const displayName =
    effective?.displayName ?? tenant?.name ?? "This tenant";
  const inheritedDefault = t(m, "admin.branding.inheritedDefault");

  return (
    <AppShell brand={brand} actions={actions}>
      <style>{brandingCss}</style>
      <Stack gap={5}>
        <Button href="/" size="sm" variant="ghost">
          {t(m, "admin.backToConsole")}
        </Button>

        <PageHeader
          title={t(m, "admin.branding.title")}
          subtitle={t(m, "admin.branding.subtitle")}
        />

        {tenant && effective ? (
          <Grid gap={4} min="280px">
            <Card>
              <Stack gap={3}>
                <p className="brand-token">
                  <strong>{t(m, "admin.branding.tenant")}</strong> {tenant.id}
                </p>

                <div className="brand-preview">
                  <Inline gap={3}>
                    <BrandMark brand={brand} decorative size={44} />
                    <Stack gap={1}>
                      <p className="brand-preview__name">{displayName}</p>
                      <p className="brand-preview__tagline">
                        {effective.supportEmail ?? tenant.subdomain}
                      </p>
                    </Stack>
                  </Inline>
                </div>

                <Stack gap={1}>
                  <Inline gap={2}>
                    <Badge tone="neutral">
                      {t(m, "admin.branding.theme", {
                        value: effective.theme,
                      })}
                    </Badge>
                    <Badge tone={hasOverrides ? "accent" : "neutral"}>
                      {hasOverrides
                        ? t(m, "admin.branding.customOverrides")
                        : t(m, "admin.branding.defaults")}
                    </Badge>
                    {effective.inheritParent ? (
                      <Badge tone="neutral">
                        {t(m, "admin.branding.inheritsParent")}
                      </Badge>
                    ) : null}
                  </Inline>
                </Stack>
              </Stack>
            </Card>

            <Card>
              <Stack gap={3}>
                <p className="brand-preview__name">
                  {t(m, "admin.branding.brandTokens")}
                </p>
                <Stack gap={1}>
                  <ColorRow
                    fallback={inheritedDefault}
                    label={t(m, "admin.branding.colorPrimary")}
                    value={effective.primaryColor}
                  />
                  <ColorRow
                    fallback={inheritedDefault}
                    label={t(m, "admin.branding.colorSecondary")}
                    value={effective.secondaryColor}
                  />
                  <ColorRow
                    fallback={inheritedDefault}
                    label={t(m, "admin.branding.colorAccent")}
                    value={effective.accentColor}
                  />
                </Stack>
                <Stack gap={1}>
                  <p className="brand-token">
                    <strong>{t(m, "admin.branding.logo")}</strong>{" "}
                    {effective.logoUrl ?? t(m, "admin.branding.defaultMark")}
                  </p>
                  <p className="brand-token">
                    <strong>{t(m, "admin.branding.customDomain")}</strong>{" "}
                    {effective.customDomain ?? "—"}
                  </p>
                  <p className="brand-token">
                    <strong>{t(m, "admin.branding.supportEmail")}</strong>{" "}
                    {effective.supportEmail ?? "—"}
                  </p>
                </Stack>
              </Stack>
            </Card>
          </Grid>
        ) : (
          <Alert tone="warning">{t(m, "admin.branding.offlineBody")}</Alert>
        )}
      </Stack>
    </AppShell>
  );
}
