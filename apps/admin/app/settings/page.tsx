import { redirect } from "next/navigation";
import {
  Alert,
  AppShell,
  Badge,
  BrandMark,
  Button,
  Card,
  Grid,
  Inline,
  PageHeader,
  Stack,
} from "@lms/ui";

import { getBranding } from "../lib/branding";
import { getSession, isAdmin } from "../lib/auth";
import { getTenantSettings } from "../lib/tenant";
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
.set-brand-preview {
  align-items: center;
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius-md);
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-3);
  padding: var(--lms-space-4);
}
.set-brand-name {
  font-weight: 700;
  margin: 0;
  overflow-wrap: anywhere;
}
.set-swatch {
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius-pill);
  height: 18px;
  width: 18px;
  flex-shrink: 0;
}
`;

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

  const settings = getTenantSettings(session);

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{settingsCss}</style>
      <Stack gap={4}>
        <Button href="/" size="sm" variant="ghost">
          ← Back to console
        </Button>

        <PageHeader
          title="Tenant settings"
          subtitle="Your organisation's identity, tenancy model, and brand."
          actions={
            <Button disabled variant="secondary">
              Edit settings
            </Button>
          }
        />

        <Alert tone="info">
          Settings are read-only for now — editing identity and branding arrives
          with the tenant service write path.
        </Alert>

        <Grid gap={4} min="280px">
          <Card>
            <Stack gap={3}>
              <h2 className="set-section-title">Organisation</h2>
              <Inline gap={3}>
                <BrandMark brand={brand} size={44} />
                <Stack gap={1}>
                  <p className="set-brand-name">{brand.name}</p>
                  <p className="set-detail">{settings.tenancy.label} tenant</p>
                </Stack>
              </Inline>
              <Stack gap={1}>
                <p className="set-detail">
                  <strong>Tenant ID:</strong> {settings.tenantId}
                </p>
                <p className="set-detail">
                  <strong>Tier:</strong> {settings.tier}
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
                    settings.tenancy.model === "silo" ? "accent" : "neutral"
                  }
                >
                  {settings.tenancy.label}
                </Badge>
              </Inline>
              <p className="set-detail">{settings.tenancy.summary}</p>
              <p className="set-detail">{settings.tenancy.isolation}</p>
            </Stack>
          </Card>
        </Grid>

        <Card>
          <Stack gap={3}>
            <h2 className="set-section-title">Brand</h2>
            <div className="set-brand-preview">
              <BrandMark brand={brand} size={56} />
              <Stack gap={1}>
                <p className="set-brand-name">{brand.name}</p>
                <p className="set-detail">{brand.tagline}</p>
              </Stack>
            </div>
            <Grid gap={3} min="200px">
              <p className="set-detail">
                <Inline gap={2}>
                  <span
                    className="set-swatch"
                    style={{ background: brand.accent }}
                  />
                  <span>
                    <strong>Accent</strong> {brand.accent}
                  </span>
                </Inline>
              </p>
              <p className="set-detail">
                <strong>Corner radius</strong> {brand.radius ?? "soft"}
              </p>
              <p className="set-detail">
                <strong>Typography</strong> {brand.fontFamily ?? "default"}
              </p>
            </Grid>
            <Inline gap={2}>
              <Button href="/branding" variant="secondary">
                View all brands
              </Button>
            </Inline>
          </Stack>
        </Card>
      </Stack>
    </AppShell>
  );
}
