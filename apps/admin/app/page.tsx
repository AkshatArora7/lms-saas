import { redirect } from "next/navigation";
import {
  Alert,
  AppShell,
  Badge,
  Button,
  Card,
  Inline,
  PageHeader,
  Stack,
} from "@lms/ui";

import { getBranding } from "./lib/branding";
import { getSession, isAdmin } from "./lib/auth";
import SignOutButton from "./sign-out-button";

const adminCss = `
.admin-session-card,
.admin-detail {
  min-width: 0;
}
.admin-section-title {
  font-size: 16px;
  margin: 0;
}
.admin-detail {
  color: var(--lms-text-muted);
  margin: 0;
  overflow-wrap: anywhere;
}
`;

export default async function AdminHome() {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);

  if (!isAdmin(session)) {
    return (
      <AppShell brand={brand} actions={<SignOutButton />}>
        <style>{adminCss}</style>
        <PageHeader
          title="Not authorized"
          subtitle="Your account cannot access the administration console."
        />
        <Stack gap={4}>
          <Alert tone="warning">
            You are signed in as <strong>{session.userId}</strong>, but your
            account does not hold an administrator role, so the admin console is
            unavailable.
          </Alert>
          <Card>
            <Stack gap={3}>
              <h2 className="admin-section-title">Roles on this account</h2>
              <Inline gap={2}>
                {session.roles.length ? (
                  session.roles.map((role) => (
                    <Badge key={role} tone="warning">
                      {role}
                    </Badge>
                  ))
                ) : (
                  <span className="admin-detail">none</span>
                )}
              </Inline>
            </Stack>
          </Card>
        </Stack>
      </AppShell>
    );
  }

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{adminCss}</style>
      <PageHeader
        title="Administration"
        subtitle="Org-unit hierarchy, users & roles, enrollment, SIS sync, and tenant settings. Super-admin tooling for pool/silo tenant management lives behind the tenant service."
      />

      <Stack gap={4}>
        <Card>
          <Stack gap={3}>
            <h2 className="admin-section-title">Manage</h2>
            <Inline gap={2}>
              <Button href="/users" variant="secondary">
                Users &amp; roles
              </Button>
              <Button href="/org-units" variant="secondary">
                Org units
              </Button>
              <Button href="/reports" variant="secondary">
                District reports
              </Button>
              <Button href="/branding" variant="secondary">
                White-label branding
              </Button>
            </Inline>
          </Stack>
        </Card>

        <Card className="admin-session-card">
        <Stack gap={3}>
          <h2 className="admin-section-title">Administrator session</h2>
          <Stack gap={1}>
            <p className="admin-detail">
              <strong>User:</strong> {session.userId}
            </p>
            <p className="admin-detail">
              <strong>Tenant:</strong> {session.tenantId} ({session.tier})
            </p>
          </Stack>
          <Stack gap={2}>
            <strong>Roles</strong>
            <Inline gap={2}>
              {session.roles.map((role) => (
                <Badge key={role} tone="accent">
                  {role}
                </Badge>
              ))}
            </Inline>
          </Stack>
          <Stack gap={2}>
            <strong>Scopes</strong>
            <Inline gap={2}>
              {session.scopes.length ? (
                session.scopes.map((scope) => (
                  <Badge key={scope} tone="neutral">
                    {scope}
                  </Badge>
                ))
              ) : (
                <span className="admin-detail">none</span>
              )}
            </Inline>
          </Stack>
        </Stack>
      </Card>
      </Stack>
    </AppShell>
  );
}
