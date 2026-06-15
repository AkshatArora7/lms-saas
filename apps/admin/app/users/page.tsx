import { redirect } from "next/navigation";
import {
  Alert,
  AppShell,
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

import { getBranding } from "../lib/branding";
import { getSession, isAdmin } from "../lib/auth";
import {
  getDirectoryUsers,
  summarizeDirectory,
  type UserStatus,
} from "../lib/directory";
import SignOutButton from "../sign-out-button";

const usersCss = `
.admin-section-title {
  font-size: 16px;
  margin: 0;
}
.admin-stat {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.1;
  margin: 0;
}
.admin-stat-label {
  color: var(--lms-text-muted);
  margin: 0;
}
.admin-user-name {
  color: var(--lms-accent);
  font-weight: 600;
  margin: 0;
  overflow-wrap: anywhere;
  text-decoration: none;
}
.admin-user-email {
  color: var(--lms-text-muted);
  margin: 0;
  overflow-wrap: anywhere;
}
.admin-user-list {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-3);
  list-style: none;
  margin: 0;
  padding: 0;
}
.admin-user-row {
  align-items: start;
  display: grid;
  gap: var(--lms-space-3);
  grid-template-columns: 1fr;
}
@media (min-width: 720px) {
  .admin-user-row {
    align-items: center;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1.4fr) minmax(0, 1fr) auto;
  }
}
`;

const STATUS_META: Record<UserStatus, { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "success" },
  invited: { label: "Invited", tone: "accent" },
  suspended: { label: "Suspended", tone: "danger" },
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

  const users = getDirectoryUsers(session.tenantId);
  const summary = summarizeDirectory(users);

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{usersCss}</style>
      <Stack gap={4}>
        <Button href="/" size="sm" variant="ghost">
          ← Back to console
        </Button>

        <PageHeader
          title="Users & roles"
          subtitle="People with access to this tenant, their roles, status, and org unit."
        />

        <Grid gap={4} min="180px">
          <Card>
            <Stack gap={1}>
              <p className="admin-stat">{summary.total}</p>
              <p className="admin-stat-label">Total users</p>
            </Stack>
          </Card>
          <Card>
            <Stack gap={1}>
              <p className="admin-stat">{summary.admins}</p>
              <p className="admin-stat-label">Administrators</p>
            </Stack>
          </Card>
          <Card>
            <Stack gap={1}>
              <p className="admin-stat">{summary.pendingInvites}</p>
              <p className="admin-stat-label">Pending invites</p>
            </Stack>
          </Card>
        </Grid>

        <section aria-labelledby="directory-heading">
          <Stack gap={3}>
            <h2 className="admin-section-title" id="directory-heading">
              Directory
            </h2>
            {users.length ? (
              <ul className="admin-user-list">
                {users.map((user) => {
                  const status = STATUS_META[user.status];
                  return (
                    <li key={user.id}>
                      <Card>
                        <div className="admin-user-row">
                          <Stack gap={1}>
                            <a
                              className="admin-user-name"
                              href={`/users/${user.id}`}
                            >
                              {user.name}
                            </a>
                            <p className="admin-user-email">{user.email}</p>
                          </Stack>
                          <Inline gap={2}>
                            {user.roles.map((role) => (
                              <Badge key={role} tone="accent">
                                {role}
                              </Badge>
                            ))}
                          </Inline>
                          <Badge tone="neutral">{user.orgUnit}</Badge>
                          <Chip tone={status.tone}>{status.label}</Chip>
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState
                description="Invite people or connect your SIS to populate the directory."
                icon="👤"
                title="No users yet"
              />
            )}
          </Stack>
        </section>
      </Stack>
    </AppShell>
  );
}
