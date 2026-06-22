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
} from "@lms/ui";
import { getMessages, t } from "@lms/i18n";
import type { MessageKey } from "@lms/i18n";

import { getBranding } from "./lib/branding";
import { getSession, isAdmin } from "./lib/auth";
import { resolveRequestLocale } from "./lib/i18n";
import { AppLocaleSwitcher } from "./lib/locale-switcher";
import {
  adminPolishCss,
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
 * Admin console landing. Layout/visuals come entirely from the shared
 * `adminPolishCss` + tenant theme tokens (var(--lms-*)) so the page stays fully
 * white-label. The at-a-glance band reflows from one stacked column on phones to
 * a multi-up grid on wider screens; the Manage nav is an icon-led grid of
 * interactive link cards. Every row has min-width:0 + overflow-wrap so there is
 * no horizontal overflow at 360px.
 */
interface NavItem {
  href: string;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
  icon: ReactElement;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/users",
    labelKey: "admin.users.title",
    descriptionKey: "admin.users.subtitle",
    icon: <UsersIcon />,
  },
  {
    href: "/courses",
    labelKey: "admin.courses.title",
    descriptionKey: "admin.courses.subtitle",
    icon: <CoursesIcon />,
  },
  {
    href: "/org-units",
    labelKey: "admin.orgUnits.title",
    descriptionKey: "admin.orgUnits.subtitle",
    icon: <OrgUnitsIcon />,
  },
  {
    href: "/reports",
    labelKey: "admin.reports.title",
    descriptionKey: "admin.reports.subtitle",
    icon: <ReportsIcon />,
  },
  {
    href: "/branding",
    labelKey: "admin.branding.title",
    descriptionKey: "admin.branding.subtitle",
    icon: <BrandingIcon />,
  },
  {
    href: "/settings",
    labelKey: "admin.settings.title",
    descriptionKey: "admin.settings.subtitle",
    icon: <SettingsIcon />,
  },
];

export default async function AdminHome() {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);
  const m = getMessages(await resolveRequestLocale());

  if (!isAdmin(session)) {
    return (
      <AppShell
        brand={brand}
        actions={
          <>
            <AppLocaleSwitcher />
            <SignOutButton />
          </>
        }
      >
        <style>{adminPolishCss}</style>
        <PageHeader
          title={t(m, "admin.notAuthorizedTitle")}
          subtitle={t(m, "admin.notAuthorizedSubtitle")}
        />
        <Stack gap={5}>
          <Alert tone="warning">
            You are signed in as <strong>{session.userId}</strong>.{" "}
            {t(m, "admin.notAuthorizedBody")}
          </Alert>
          <Card>
            <Stack gap={3}>
              <h2 className="admin-section-title">{t(m, "common.roles")}</h2>
              <Inline gap={2}>
                {session.roles.length ? (
                  session.roles.map((role) => (
                    <Badge key={role} tone="warning">
                      {role}
                    </Badge>
                  ))
                ) : (
                  <span className="admin-detail">{t(m, "common.none")}</span>
                )}
              </Inline>
            </Stack>
          </Card>
        </Stack>
      </AppShell>
    );
  }

  return (
    <AppShell
      brand={brand}
      actions={
        <>
          <AppLocaleSwitcher />
          <SignOutButton />
        </>
      }
    >
      <style>{adminPolishCss}</style>
      <Stack gap={5}>
        <PageHeader
          title={t(m, "admin.title")}
          subtitle={t(m, "admin.subtitle")}
        />

        <Grid gap={4} min="180px">
          <Card>
            <Stack gap={1}>
              <p className="admin-stat-value">{session.roles.length}</p>
              <p className="admin-stat-label">
                {session.roles.length === 1
                  ? t(m, "admin.yourRole")
                  : t(m, "admin.yourRoles")}
              </p>
            </Stack>
          </Card>
          <Card>
            <Stack gap={1}>
              <p className="admin-stat-value">{session.scopes.length}</p>
              <p className="admin-stat-label">{t(m, "admin.accessScopes")}</p>
            </Stack>
          </Card>
          <Card>
            <Stack gap={1}>
              <p className="admin-stat-value">{session.tier}</p>
              <p className="admin-stat-label">{t(m, "admin.tenantTier")}</p>
            </Stack>
          </Card>
        </Grid>

        <section aria-labelledby="manage-heading">
          <Stack gap={3}>
            <h2 className="admin-section-title" id="manage-heading">
              {t(m, "admin.manage")}
            </h2>
            <Grid gap={3} min="200px">
              {NAV_ITEMS.map((item) => (
                <Card as="a" href={item.href} interactive key={item.href}>
                  <span className="admin-nav-card">
                    <span aria-hidden="true" className="admin-nav-card__icon">
                      {item.icon}
                    </span>
                    <span className="admin-nav-card__body">
                      <span className="admin-nav-card__label">
                        {t(m, item.labelKey)}
                      </span>
                      <span className="admin-nav-card__desc">
                        {t(m, item.descriptionKey)}
                      </span>
                    </span>
                  </span>
                </Card>
              ))}
            </Grid>
          </Stack>
        </section>

        <Card className="admin-page">
          <Stack gap={3}>
            <h2 className="admin-section-title">{t(m, "admin.session")}</h2>
            <Stack gap={1}>
              <p className="admin-detail">
                <strong>{t(m, "common.user")}:</strong> {session.userId}
              </p>
              <p className="admin-detail">
                <strong>{t(m, "common.tenant")}:</strong> {session.tenantId} (
                {session.tier})
              </p>
            </Stack>
            <Stack gap={2}>
              <strong>{t(m, "common.roles")}</strong>
              <Inline gap={2}>
                {session.roles.length ? (
                  session.roles.map((role) => (
                    <Badge key={role} tone="accent">
                      {role}
                    </Badge>
                  ))
                ) : (
                  <span className="admin-detail">{t(m, "common.none")}</span>
                )}
              </Inline>
            </Stack>
            <Stack gap={2}>
              <strong>{t(m, "common.scopes")}</strong>
              <Inline gap={2}>
                {session.scopes.length ? (
                  session.scopes.map((scope) => (
                    <Badge key={scope} tone="neutral">
                      {scope}
                    </Badge>
                  ))
                ) : (
                  <span className="admin-detail">{t(m, "common.none")}</span>
                )}
              </Inline>
            </Stack>
          </Stack>
        </Card>
      </Stack>
    </AppShell>
  );
}
