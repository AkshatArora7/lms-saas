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
import { getTenantOverview } from "../lib/tenant";
import { resolveRequestLocale } from "../lib/i18n";
import { AppLocaleSwitcher } from "../lib/locale-switcher";
import { adminPolishCss, AppShell } from "../lib/ui";
import SignOutButton from "../sign-out-button";

const settingsCss = `${adminPolishCss}
.set-detail {
  color: var(--lms-text-muted);
  margin: 0;
  overflow-wrap: anywhere;
}
.set-detail strong {
  color: var(--lms-text);
}
.set-brand-name {
  font-weight: 700;
  margin: 0;
  overflow-wrap: anywhere;
}
.set-settings {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-1);
}
.set-settings li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--lms-space-2);
  min-width: 0;
  border-bottom: 1px solid var(--lms-border);
  padding: var(--lms-row-pad-y) 0;
}
.set-settings li:last-child {
  border-bottom: none;
}
.set-settings code {
  font-size: var(--lms-font-size-sm);
  overflow-wrap: anywhere;
}
`;

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> =
  {
    active: "success",
    provisioning: "warning",
    suspended: "danger",
    deleted: "danger",
  };

/** Render an effective governance setting value for display. */
function settingValue(
  value: unknown,
  m: ReturnType<typeof getMessages>,
): string {
  if (typeof value === "boolean")
    return value ? t(m, "admin.settings.enabled") : t(m, "admin.settings.disabled");
  if (value === null || value === undefined) return "—";
  return String(value);
}

export default async function TenantSettings() {
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

  const overview = await getTenantOverview(session.tenantId);

  return (
    <AppShell brand={brand} actions={actions}>
      <style>{settingsCss}</style>
      <Stack gap={5}>
        <Button href="/" size="sm" variant="ghost">
          {t(m, "admin.backToConsole")}
        </Button>

        <PageHeader
          title={t(m, "admin.settings.title")}
          subtitle={t(m, "admin.settings.subtitle")}
          actions={
            <Button disabled variant="secondary">
              {t(m, "admin.settings.editSettings")}
            </Button>
          }
        />

        {overview ? (
          <>
            <Alert tone="info">{t(m, "admin.settings.readOnlyNotice")}</Alert>

            <Grid gap={4} min="280px">
              <Card>
                <Stack gap={3}>
                  <h2 className="admin-section-title">
                    {t(m, "admin.settings.organisation")}
                  </h2>
                  <Inline gap={3}>
                    <BrandMark brand={brand} decorative size={44} />
                    <Stack gap={1}>
                      <p className="set-brand-name">{overview.name}</p>
                      <p className="set-detail">
                        {t(m, "admin.settings.tenantLabel", {
                          label: overview.tenancy.label,
                        })}
                      </p>
                    </Stack>
                  </Inline>
                  <Stack gap={1}>
                    <p className="set-detail">
                      <strong>{t(m, "admin.settings.tenantId")}:</strong>{" "}
                      {overview.tenantId}
                    </p>
                    <p className="set-detail">
                      <strong>{t(m, "admin.settings.slug")}:</strong>{" "}
                      {overview.slug}
                    </p>
                    <p className="set-detail">
                      <strong>{t(m, "admin.settings.region")}:</strong>{" "}
                      {overview.region}
                    </p>
                    <div className="set-detail">
                      <Inline align="center" gap={2}>
                        <strong>{t(m, "admin.settings.status")}:</strong>
                        <Badge tone={STATUS_TONE[overview.status] ?? "neutral"}>
                          {overview.status}
                        </Badge>
                      </Inline>
                    </div>
                    <p className="set-detail">
                      <strong>{t(m, "admin.settings.plan")}:</strong>{" "}
                      {overview.plan ?? "—"}
                    </p>
                  </Stack>
                </Stack>
              </Card>

              <Card>
                <Stack gap={3}>
                  <Inline gap={2} justify="space-between">
                    <h2 className="admin-section-title">
                      {t(m, "admin.settings.tenancyModel")}
                    </h2>
                    <Badge
                      tone={
                        overview.tenancy.model === "silo" ? "accent" : "neutral"
                      }
                    >
                      {overview.tier}
                    </Badge>
                  </Inline>
                  <p className="set-detail">{overview.tenancy.summary}</p>
                  <p className="set-detail">{overview.tenancy.isolation}</p>
                </Stack>
              </Card>
            </Grid>

            <Card>
              <Stack gap={3}>
                <h2 className="admin-section-title">
                  {t(m, "admin.settings.governanceTitle")}
                </h2>
                {Object.keys(overview.settings).length ? (
                  <ul className="set-settings">
                    {Object.entries(overview.settings).map(([key, value]) => (
                      <li key={key}>
                        <code>{key}</code>
                        <span className="set-detail">
                          <strong>{settingValue(value, m)}</strong>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="set-detail">
                    {t(m, "admin.settings.noPolicies")}
                  </p>
                )}
                <Inline gap={2}>
                  <Button href="/branding" variant="secondary">
                    {t(m, "admin.settings.viewBranding")}
                  </Button>
                </Inline>
              </Stack>
            </Card>
          </>
        ) : (
          <Alert tone="warning">{t(m, "admin.settings.offlineBody")}</Alert>
        )}
      </Stack>
    </AppShell>
  );
}
