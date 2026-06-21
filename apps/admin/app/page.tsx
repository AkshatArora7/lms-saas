import { redirect } from "next/navigation";
import type { ReactElement } from "react";
import {
  Alert,
  Badge,
  Card,
  Grid,
  Inline,
  PageHeader,
  Stack,
  StatCard,
} from "@lms/ui";

import { getBranding } from "./lib/branding";
import { getSession, isAdmin } from "./lib/auth";
import {
  AppShell,
  BrandingIcon,
  CoursesIcon,
  OrgUnitsIcon,
  ReportsIcon,
  SettingsIcon,
  UsersIcon,
} from "./lib/ui";
import SignOutButton from "./sign-out-button";

/**
 * Scoped layout polish for the admin console landing. Every visual decision
 * resolves from the tenant theme tokens (var(--lms-*)) so the page stays fully
 * white-label. The at-a-glance band reflows from one stacked column on phones to
 * a multi-up grid on wider screens; the Manage nav is an icon-led grid of
 * interactive link cards. Nothing hardcodes accent/font/radius, and every row
 * has min-width:0 + overflow-wrap so there is no horizontal overflow at 360px.
 */
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
.admin-nav-card {
  display: flex;
  align-items: flex-start;
  gap: var(--lms-space-3);
  height: 100%;
  text-decoration: none;
  color: inherit;
}
.admin-nav-card__icon {
  flex-shrink: 0;
  color: var(--lms-accent);
  display: inline-flex;
}
.admin-nav-card__icon svg {
  width: 24px;
  height: 24px;
}
.admin-nav-card__body {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-1);
  min-width: 0;
}
.admin-nav-card__label {
  font-weight: 600;
  margin: 0;
  overflow-wrap: anywhere;
}
.admin-nav-card__desc {
  color: var(--lms-text-muted);
  font-size: var(--lms-font-size-sm);
  margin: 0;
  overflow-wrap: anywhere;
}
`;

interface NavItem {
  href: string;
  label: string;
  description: string;
  icon: ReactElement;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/users",
    label: "Users & roles",
    description: "Directory, access, and role assignment.",
    icon: <UsersIcon />,
  },
  {
    href: "/courses",
    label: "Course catalogue",
    description: "Courses offered across this tenant.",
    icon: <CoursesIcon />,
  },
  {
    href: "/org-units",
    label: "Org units",
    description: "School and department hierarchy.",
    icon: <OrgUnitsIcon />,
  },
  {
    href: "/reports",
    label: "District reports",
    description: "Compare schools and allocate support.",
    icon: <ReportsIcon />,
  },
  {
    href: "/branding",
    label: "White-label branding",
    description: "Tenant logo, colours, and theme.",
    icon: <BrandingIcon />,
  },
  {
    href: "/settings",
    label: "Tenant settings",
    description: "Org-wide configuration and SIS sync.",
    icon: <SettingsIcon />,
  },
];

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
      <Stack gap={4}>
        <PageHeader
          title="Administration"
          subtitle="Org-unit hierarchy, users & roles, enrollment, SIS sync, and tenant settings. Super-admin tooling for pool/silo tenant management lives behind the tenant service."
        />

        <Grid gap={4} min="180px">
          <StatCard
            label={session.roles.length === 1 ? "Your role" : "Your roles"}
            value={session.roles.length}
          />
          <StatCard label="Access scopes" value={session.scopes.length} />
          <StatCard label="Tenant tier" tone="accent" value={session.tier} />
        </Grid>

        <section aria-labelledby="manage-heading">
          <Stack gap={3}>
            <h2 className="admin-section-title" id="manage-heading">
              Manage
            </h2>
            <Grid gap={3} min="200px">
              {NAV_ITEMS.map((item) => (
                <Card as="a" href={item.href} interactive key={item.href}>
                  <span className="admin-nav-card">
                    <span aria-hidden="true" className="admin-nav-card__icon">
                      {item.icon}
                    </span>
                    <span className="admin-nav-card__body">
                      <span className="admin-nav-card__label">{item.label}</span>
                      <span className="admin-nav-card__desc">
                        {item.description}
                      </span>
                    </span>
                  </span>
                </Card>
              ))}
            </Grid>
          </Stack>
        </section>

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
                {session.roles.length ? (
                  session.roles.map((role) => (
                    <Badge key={role} tone="accent">
                      {role}
                    </Badge>
                  ))
                ) : (
                  <span className="admin-detail">none</span>
                )}
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
