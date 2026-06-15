import { redirect } from "next/navigation";
import {
  Alert,
  AppShell,
  Badge,
  BrandMark,
  Button,
  Card,
  Chip,
  Grid,
  Inline,
  PageHeader,
  ProgressBar,
  Stack,
  ThemeStyle,
  demoSchoolBrands,
} from "@lms/ui";

import { getBranding } from "../lib/branding";
import { getSession, isAdmin } from "../lib/auth";
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
`;

function previewScope(tenantId: string): string {
  return `brand-preview-${tenantId.slice(0, 8)}`;
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

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{brandingCss}</style>
      <Stack gap={4}>
        <Button href="/" size="sm" variant="ghost">
          ← Back to console
        </Button>

        <PageHeader
          title="White-label branding"
          subtitle="Every school renders the product in its own brand — logo, accent colour, typography, and corner style — resolved per tenant from the brand registry. Below is a live preview of each configured school brand."
        />

        {demoSchoolBrands.length ? (
          <Grid gap={4} min="280px">
            {demoSchoolBrands.map(({ tenantId, brand: school }) => {
              const scope = previewScope(tenantId);
              return (
                <Card key={tenantId}>
                  <Stack gap={3}>
                    <p className="brand-token">
                      <strong>Tenant</strong> {tenantId}
                    </p>

                    <ThemeStyle brand={school} scope={`.${scope}`} />
                    <div className={`lms-theme ${scope} brand-preview`}>
                      <Stack gap={3}>
                        <Inline gap={3}>
                          <BrandMark brand={school} size={44} />
                          <Stack gap={1}>
                            <p className="brand-preview__name">{school.name}</p>
                            <p className="brand-preview__tagline">
                              {school.tagline}
                            </p>
                          </Stack>
                        </Inline>

                        <Inline gap={2}>
                          <Button size="sm" variant="primary">
                            Primary
                          </Button>
                          <Button size="sm" variant="secondary">
                            Secondary
                          </Button>
                        </Inline>

                        <Inline gap={2}>
                          <Badge tone="accent">Accent</Badge>
                          <Chip tone="success">Active</Chip>
                          <Chip tone="neutral">Term 1</Chip>
                        </Inline>

                        <ProgressBar
                          label={`${school.name} course progress`}
                          value={72}
                        />
                      </Stack>
                    </div>

                    <Stack gap={1}>
                      <p className="brand-token">
                        <Inline gap={2}>
                          <span
                            className="brand-swatch"
                            style={{ background: school.accent }}
                          />
                          <span>
                            <strong>Accent</strong> {school.accent}
                          </span>
                        </Inline>
                      </p>
                      <p className="brand-token">
                        <strong>Radius</strong> {school.radius ?? "soft"}
                      </p>
                      <p className="brand-token">
                        <strong>Type</strong> {school.fontFamily ?? "default"}
                      </p>
                    </Stack>
                  </Stack>
                </Card>
              );
            })}
          </Grid>
        ) : (
          <Alert tone="info">
            No school brands are configured yet. Brands appear here once tenants
            are onboarded with their white-label settings.
          </Alert>
        )}
      </Stack>
    </AppShell>
  );
}
