import { notFound, redirect } from "next/navigation";
import {
  Alert,
  Avatar,
  Badge,
  Breadcrumbs,
  Button,
  Card,
  Chip,
  Divider,
  Grid,
  Inline,
  PageHeader,
  Stack,
} from "@lms/ui";
import type { BadgeTone } from "@lms/ui";

import { getBranding } from "../../lib/branding";
import { getSession, isAdmin } from "../../lib/auth";
import {
  getDirectoryUserDetail,
  type UserStatus,
} from "../../lib/directory";
import { AppShell } from "../../lib/ui";
import SignOutButton from "../../sign-out-button";

const userCss = `
.admin-section-title {
  font-size: 16px;
  margin: 0;
}
.admin-detail {
  color: var(--lms-text-muted);
  margin: 0;
  overflow-wrap: anywhere;
}
.admin-detail strong {
  color: var(--lms-text);
}
.admin-profile {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-3);
}
.admin-profile__name {
  font-size: 18px;
  font-weight: 700;
  margin: 0;
  overflow-wrap: anywhere;
}
`;

const STATUS_META: Record<UserStatus, { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "success" },
  invited: { label: "Invited", tone: "accent" },
  inactive: { label: "Inactive", tone: "neutral" },
};

export default async function AdminUserDetail({
  params,
}: {
  params: { userId: string };
}) {
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

  const result = await getDirectoryUserDetail(params.userId, session.tenantId);
  if (result.status === "not_found") notFound();

  if (result.status === "offline") {
    return (
      <AppShell brand={brand} actions={<SignOutButton />}>
        <Stack gap={4}>
          <Button href="/users" size="sm" variant="ghost">
            ← Back to users
          </Button>
          <PageHeader title="User" subtitle="Account profile, roles, and activity." />
          <Alert tone="warning">
            The user &amp; org service is unreachable, so this profile can&apos;t
            be loaded right now. Start the service and refresh.
          </Alert>
        </Stack>
      </AppShell>
    );
  }

  const user = result.user;
  const status = STATUS_META[user.status];
  const orgUnitLabel = user.orgUnits.length ? user.orgUnits.join(", ") : "—";

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{userCss}</style>
      <Stack gap={4}>
        <Breadcrumbs
          items={[
            { label: "Console", href: "/" },
            { label: "Users", href: "/users" },
            { label: user.name },
          ]}
        />

        <PageHeader
          title={user.name}
          subtitle="Account profile, roles, and activity."
        />

        <Card>
          <div className="admin-profile">
            <Avatar name={user.name} size="lg" />
            <Stack gap={1}>
              <p className="admin-profile__name">{user.name}</p>
              <p className="admin-detail">{user.email}</p>
            </Stack>
            <Chip tone={status.tone}>{status.label}</Chip>
          </div>
        </Card>

        <Grid gap={4} min="240px">
          <Card>
            <Stack gap={3}>
              <h2 className="admin-section-title">Account</h2>
              <Stack gap={1}>
                <p className="admin-detail">
                  <strong>Status:</strong> {status.label}
                </p>
                <p className="admin-detail">
                  <strong>Org unit:</strong> {orgUnitLabel}
                </p>
                <p className="admin-detail">
                  <strong>User ID:</strong> {user.id}
                </p>
              </Stack>
            </Stack>
          </Card>

          <Card>
            <Stack gap={3}>
              <h2 className="admin-section-title">Roles</h2>
              <Inline gap={2}>
                {user.roles.length ? (
                  user.roles.map((role) => (
                    <Badge key={role} tone="accent">
                      {role}
                    </Badge>
                  ))
                ) : (
                  <span className="admin-detail">none</span>
                )}
              </Inline>
            </Stack>
          </Card>
        </Grid>

        <Card>
          <Stack gap={3}>
            <h2 className="admin-section-title">Recent activity</h2>
            <Divider />
            <p className="admin-detail">
              Sign-in history, enrollment changes, and audit events will appear
              here once the audit service is connected.
            </p>
          </Stack>
        </Card>
      </Stack>
    </AppShell>
  );
}
