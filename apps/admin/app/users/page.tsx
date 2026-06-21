import { redirect } from "next/navigation";
import {
  Alert,
  Badge,
  Button,
  Chip,
  EmptyState,
  Grid,
  PageHeader,
  Stack,
  StatCard,
} from "@lms/ui";
import type { BadgeTone } from "@lms/ui";

import { getBranding } from "../lib/branding";
import { getSession, isAdmin } from "../lib/auth";
import { getDirectory, type UserStatus } from "../lib/directory";
import { AppShell, UsersIcon } from "../lib/ui";
import SignOutButton from "../sign-out-button";

const usersCss = `
.admin-section-title {
  font-size: 16px;
  margin: 0;
}
.admin-user-name {
  color: var(--lms-accent);
  font-weight: 600;
  margin: 0;
  overflow-wrap: anywhere;
  text-decoration: none;
}
.admin-user-name:hover {
  text-decoration: underline;
}
.admin-user-email {
  color: var(--lms-text-muted);
  font-size: var(--lms-font-size-sm);
  margin: 0;
  overflow-wrap: anywhere;
}
/* Data-dense directory table. The wrapper scrolls horizontally on small
   screens with a labelled region so columns are never silently clipped. */
.admin-user-roles {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-1);
}
@media (min-width: 601px) {
  .admin-users-table th,
  .admin-users-table td {
    white-space: nowrap;
  }
  .admin-users-table td:first-child,
  .admin-users-table th:first-child {
    white-space: normal;
    min-width: 180px;
  }
}
`;

const STATUS_META: Record<UserStatus, { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "success" },
  invited: { label: "Invited", tone: "accent" },
  inactive: { label: "Inactive", tone: "neutral" },
};

export default async function AdminUsers() {
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

  const directory = await getDirectory(session.tenantId);

  return (
    <AppShell brand={brand} actions={<SignOutButton />} width="wide">
      <style>{usersCss}</style>
      <Stack gap={4}>
        <Button href="/" size="sm" variant="ghost">
          ← Back to console
        </Button>

        <PageHeader
          title="Users & roles"
          subtitle="People with access to this tenant, their roles, status, and org unit."
        />

        {directory ? (
          <>
            <Grid gap={4} min="180px">
              <StatCard label="Total users" value={directory.summary.total} />
              <StatCard
                label="Administrators"
                tone="accent"
                value={directory.summary.admins}
              />
              <StatCard
                label="Pending invites"
                value={directory.summary.pendingInvites}
              />
            </Grid>

            <section aria-labelledby="directory-heading">
              <Stack gap={3}>
                <h2 className="admin-section-title" id="directory-heading">
                  Directory
                </h2>
                {directory.users.length ? (
                  <div
                    aria-label="User directory"
                    className="lms-table-wrap"
                    role="region"
                    tabIndex={0}
                  >
                    <table className="lms-table lms-table--stack admin-users-table">
                      <thead>
                        <tr>
                          <th scope="col">Name</th>
                          <th scope="col">Roles</th>
                          <th scope="col">Org unit</th>
                          <th scope="col">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {directory.users.map((user) => {
                          const status = STATUS_META[user.status];
                          return (
                            <tr key={user.id}>
                              <td data-label="Name">
                                <a
                                  className="admin-user-name"
                                  href={`/users/${user.id}`}
                                >
                                  {user.name}
                                </a>
                                <p className="admin-user-email">{user.email}</p>
                              </td>
                              <td data-label="Roles">
                                <span className="admin-user-roles">
                                  {user.roles.length ? (
                                    user.roles.map((role) => (
                                      <Badge key={role} tone="accent">
                                        {role}
                                      </Badge>
                                    ))
                                  ) : (
                                    <Badge tone="neutral">No roles</Badge>
                                  )}
                                </span>
                              </td>
                              <td data-label="Org unit">
                                <Badge tone="neutral">{user.orgUnit}</Badge>
                              </td>
                              <td data-label="Status">
                                <Chip tone={status.tone}>{status.label}</Chip>
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
                        Invite user
                      </Button>
                    }
                    description="Invite teammates to this organization to manage their access and roles."
                    icon={<UsersIcon />}
                    title="No users yet"
                  />
                )}
              </Stack>
            </section>
          </>
        ) : (
          <Alert tone="warning">
            The user &amp; org service is unreachable, so the directory can&apos;t
            be loaded right now. Start the service and refresh to manage users.
          </Alert>
        )}
      </Stack>
    </AppShell>
  );
}
