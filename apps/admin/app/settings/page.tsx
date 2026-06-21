import { redirect } from "next/navigation";
import {
  Alert,
  Badge,
  BrandMark,
  Breadcrumbs,
  Button,
  Card,
  Grid,
  Inline,
  PageHeader,
  Stack,
} from "@lms/ui";

import { getBranding } from "../lib/branding";
import { getSession, isAdmin } from "../lib/auth";
import { getTenantOverview } from "../lib/tenant";
import { AppShell } from "../lib/ui";
import SignOutButton from "../sign-out-button";

const settingsCss = `
.set-section-title {
  font-size: 16px;
  margin: 0;
}
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
function settingValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
  if (value === null || value === undefined) return "—";
  return String(value);
}

export default async function TenantSettings() {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);

  if (!isAdmin(session)) {
    return (
      <AppShell brand={brand} actions={<SignOutButton />}>
        <PageHeader
          title="Not authorized"
          subtitle="Your account cannot access the administration console."
        />
        <Alert tone="warning">
          You are signed in as <strong>{session.userId}</strong>, but your
          account does not hold an administrator role, so the admin console is
          unavailable.
        </Alert>
      </AppShell>
    );
  }

  const overview = await getTenantOverview(session.tenantId);

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{settingsCss}</style>
      <Stack gap={4}>
        <Breadcrumbs
          items={[
            { label: "Console", href: "/" },
            { label: "Tenant settings" },
          ]}
        />

        <PageHeader
          title="Tenant settings"
          subtitle="Your organisation's identity, tenancy model, and governance policies."
          actions={
            <Button disabled variant="secondary">
              Edit settings
            </Button>
          }
        />

        {overview ? (
          <>
            <Alert tone="info">
              Settings are read-only for now — editing identity and policies
              arrives with the tenant service write path.
            </Alert>

            <Grid gap={4} min="280px">
              <Card>
                <Stack gap={3}>
                  <h2 className="set-section-title">Organisation</h2>
                  <Inline gap={3}>
                    <BrandMark brand={brand} size={44} />
                    <Stack gap={1}>
                      <p className="set-brand-name">{overview.name}</p>
                      <p className="set-detail">
                        {overview.tenancy.label} tenant
                      </p>
                    </Stack>
                  </Inline>
                  <Stack gap={1}>
                    <p className="set-detail">
                      <strong>Tenant ID:</strong> {overview.tenantId}
                    </p>
                    <p className="set-detail">
                      <strong>Slug:</strong> {overview.slug}
                    </p>
                    <p className="set-detail">
                      <strong>Region:</strong> {overview.region}
                    </p>
                    <div className="set-detail">
                      <Inline align="center" gap={2}>
                        <strong>Status:</strong>
                        <Badge tone={STATUS_TONE[overview.status] ?? "neutral"}>
                          {overview.status}
                        </Badge>
                      </Inline>
                    </div>
                    <p className="set-detail">
                      <strong>Plan:</strong> {overview.plan ?? "—"}
                    </p>
                  </Stack>
                </Stack>
              </Card>

              <Card>
                <Stack gap={3}>
                  <Inline gap={2} justify="space-between">
                    <h2 className="set-section-title">Tenancy model</h2>
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
                <h2 className="set-section-title">Governance policies</h2>
                {Object.keys(overview.settings).length ? (
                  <ul className="set-settings">
                    {Object.entries(overview.settings).map(([key, value]) => (
                      <li key={key}>
                        <code>{key}</code>
                        <span className="set-detail">
                          <strong>{settingValue(value)}</strong>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="set-detail">
                    No governance policies are configured — platform defaults
                    apply.
                  </p>
                )}
                <Inline gap={2}>
                  <Button href="/branding" variant="secondary">
                    View branding
                  </Button>
                </Inline>
              </Stack>
            </Card>
          </>
        ) : (
          <Alert tone="warning">
            The tenant service is unreachable, so tenancy details cannot be
            shown right now. Start the tenant service and reload.
          </Alert>
        )}
      </Stack>
    </AppShell>
  );
}
