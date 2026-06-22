import { redirect } from "next/navigation";
import {
  Alert,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  Grid,
  Inline,
  PageHeader,
  Stack,
} from "@lms/ui";
import type { BadgeTone } from "@lms/ui";
import { getMessages, t } from "@lms/i18n";
import type { MessageKey } from "@lms/i18n";

import { getBranding } from "../lib/branding";
import { getSession, isAdmin } from "../lib/auth";
import { getDirectory, type UserStatus } from "../lib/directory";
import { resolveRequestLocale } from "../lib/i18n";
import { AppLocaleSwitcher } from "../lib/locale-switcher";
import { adminPolishCss, AppShell, UsersIcon } from "../lib/ui";
import SignOutButton from "../sign-out-button";

const usersCss = `${adminPolishCss}
/* Data-dense directory table. The wrapper scrolls horizontally on small
   screens with a labelled region so columns are never silently clipped. */
.admin-users-table th,
.admin-users-table td {
  white-space: nowrap;
}
.admin-users-table td:first-child,
.admin-users-table th:first-child {
  white-space: normal;
  min-width: 180px;
}
`;

const STATUS_META: Record<UserStatus, { labelKey: MessageKey; tone: BadgeTone }> = {
  active: { labelKey: "admin.users.statusActive", tone: "success" },
  invited: { labelKey: "admin.users.statusInvited", tone: "accent" },
  inactive: { labelKey: "admin.users.statusInactive", tone: "neutral" },
};

export default async function AdminUsers() {
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

  const directory = await getDirectory(session.tenantId);

  return (
    <AppShell brand={brand} actions={actions}>
      <style>{usersCss}</style>
      <Stack gap={5}>
        <Button href="/" size="sm" variant="ghost">
          {t(m, "admin.backToConsole")}
        </Button>

        <PageHeader
          title={t(m, "admin.users.title")}
          subtitle={t(m, "admin.users.subtitle")}
        />

        {directory ? (
          <>
            <Grid gap={4} min="180px">
              <Card>
                <Inline align="flex-start" gap={3}>
                  <span aria-hidden="true" className="admin-stat-card__icon">
                    <UsersIcon />
                  </span>
                  <Stack gap={1}>
                    <p className="admin-stat-value">
                      {directory.summary.total}
                    </p>
                    <p className="admin-stat-label">
                      {t(m, "admin.users.statTotal")}
                    </p>
                  </Stack>
                </Inline>
              </Card>
              <Card>
                <Inline align="flex-start" gap={3}>
                  <span aria-hidden="true" className="admin-stat-card__icon">
                    <UsersIcon />
                  </span>
                  <Stack gap={1}>
                    <p className="admin-stat-value">
                      {directory.summary.admins}
                    </p>
                    <p className="admin-stat-label">
                      {t(m, "admin.users.statAdmins")}
                    </p>
                  </Stack>
                </Inline>
              </Card>
              <Card>
                <Inline align="flex-start" gap={3}>
                  <span aria-hidden="true" className="admin-stat-card__icon">
                    <UsersIcon />
                  </span>
                  <Stack gap={1}>
                    <p className="admin-stat-value">
                      {directory.summary.pendingInvites}
                    </p>
                    <p className="admin-stat-label">
                      {t(m, "admin.users.statPending")}
                    </p>
                  </Stack>
                </Inline>
              </Card>
            </Grid>

            <section aria-labelledby="directory-heading">
              <Stack gap={3}>
                <h2 className="admin-section-title" id="directory-heading">
                  {t(m, "admin.users.heading")}
                </h2>
                {directory.users.length ? (
                  <div
                    aria-label={t(m, "admin.users.tableLabel")}
                    className="lms-table-wrap"
                    role="region"
                    tabIndex={0}
                  >
                    <table className="lms-table admin-users-table">
                      <thead>
                        <tr>
                          <th scope="col">{t(m, "admin.users.colName")}</th>
                          <th scope="col">{t(m, "admin.users.colRoles")}</th>
                          <th scope="col">{t(m, "admin.users.colOrgUnit")}</th>
                          <th scope="col">{t(m, "admin.users.colStatus")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {directory.users.map((user) => {
                          const status = STATUS_META[user.status];
                          return (
                            <tr key={user.id}>
                              <td>
                                <a
                                  className="admin-link-name"
                                  href={`/users/${user.id}`}
                                >
                                  {user.name}
                                </a>
                                <p className="admin-cell-meta">{user.email}</p>
                              </td>
                              <td>
                                <span className="admin-badge-cluster">
                                  {user.roles.length ? (
                                    user.roles.map((role) => (
                                      <Badge key={role} tone="accent">
                                        {role}
                                      </Badge>
                                    ))
                                  ) : (
                                    <Badge tone="neutral">
                                      {t(m, "admin.users.noRoles")}
                                    </Badge>
                                  )}
                                </span>
                              </td>
                              <td>
                                <Badge tone="neutral">{user.orgUnit}</Badge>
                              </td>
                              <td>
                                <Chip tone={status.tone}>
                                  {t(m, status.labelKey)}
                                </Chip>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState
                    actions={
                      <Button href="/users/invite" variant="primary">
                        {t(m, "admin.users.invite")}
                      </Button>
                    }
                    description={t(m, "admin.users.emptyBody")}
                    icon={<UsersIcon />}
                    title={t(m, "admin.users.emptyTitle")}
                  />
                )}
              </Stack>
            </section>
          </>
        ) : (
          <Alert tone="warning">{t(m, "admin.users.offlineBody")}</Alert>
        )}
      </Stack>
    </AppShell>
  );
}
