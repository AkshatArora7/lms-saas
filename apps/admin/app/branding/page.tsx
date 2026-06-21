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
import { getTenant, getTenantBranding } from "../lib/tenant-api";
import SignOutButton from "../sign-out-button";

const brandingCss = `
.brand-token {
  color: var(--lms-text-muted);
  font-size: 13px;
  margin: 0;
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
function ColorRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="brand-token">
      <Inline align="center" gap={2}>
        <span
          aria-hidden="true"
          className={`brand-swatch${value ? "" : " brand-swatch--empty"}`}
          style={value ? { background: value } : undefined}
        />
        <span>
          <strong>{label}</strong> {value ?? "Inherited / default"}
        </span>
      </Inline>
    </div>
  );
}

export default async function BrandingShowcase() {
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

  const [tenant, brandingResponse] = await Promise.all([
    getTenant(session.tenantId),
    getTenantBranding(session.tenantId),
  ]);

  const effective = brandingResponse?.branding ?? null;
  const hasOverrides = brandingResponse?.overrides != null;
  const displayName =
    effective?.displayName ?? tenant?.name ?? "This tenant";

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{brandingCss}</style>
      <Stack gap={4}>
        <Button href="/" size="sm" variant="ghost">
          ← Back to console
        </Button>

        <PageHeader
          title="White-label branding"
          subtitle="Your organisation renders the product in its own brand — name, logo, colours, and theme — resolved per tenant by the tenant service with inheritance from any parent district."
        />

        {tenant && effective ? (
          <Grid gap={4} min="280px">
            <Card>
              <Stack gap={3}>
                <p className="brand-token">
                  <strong>Tenant</strong> {tenant.id}
                </p>

                <div className="brand-preview">
                  <Inline gap={3}>
                    <BrandMark brand={brand} size={44} />
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
                    <Badge tone="neutral">Theme: {effective.theme}</Badge>
                    <Badge tone={hasOverrides ? "accent" : "neutral"}>
                      {hasOverrides ? "Custom overrides" : "Defaults"}
                    </Badge>
                    {effective.inheritParent ? (
                      <Badge tone="neutral">Inherits parent</Badge>
                    ) : null}
                  </Inline>
                </Stack>
              </Stack>
            </Card>

            <Card>
              <Stack gap={3}>
                <p className="brand-preview__name">Brand tokens</p>
                <Stack gap={1}>
                  <ColorRow label="Primary" value={effective.primaryColor} />
                  <ColorRow
                    label="Secondary"
                    value={effective.secondaryColor}
                  />
                  <ColorRow label="Accent" value={effective.accentColor} />
                </Stack>
                <Stack gap={1}>
                  <p className="brand-token">
                    <strong>Logo</strong> {effective.logoUrl ?? "Default mark"}
                  </p>
                  <p className="brand-token">
                    <strong>Custom domain</strong>{" "}
                    {effective.customDomain ?? "—"}
                  </p>
                  <p className="brand-token">
                    <strong>Support email</strong>{" "}
                    {effective.supportEmail ?? "—"}
                  </p>
                </Stack>
              </Stack>
            </Card>
          </Grid>
        ) : (
          <Alert tone="warning">
            The tenant service is unreachable, so branding cannot be shown right
            now. Start the tenant service and reload.
          </Alert>
        )}
      </Stack>
    </AppShell>
  );
}
