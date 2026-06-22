import { notFound, redirect } from "next/navigation";
import {
  Alert,
  Avatar,
  Badge,
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
import { getMessages, t } from "@lms/i18n";
import type { MessageKey } from "@lms/i18n";

import { getBranding } from "../../lib/branding";
import { getSession, isAdmin } from "../../lib/auth";
import {
  getDirectoryUserDetail,
  type UserStatus,
} from "../../lib/directory";
import { resolveRequestLocale } from "../../lib/i18n";
import { AppLocaleSwitcher } from "../../lib/locale-switcher";
import { adminPolishCss, AppShell } from "../../lib/ui";
import SignOutButton from "../../sign-out-button";

const userCss = `${adminPolishCss}
.admin-profile {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-3);
  min-width: 0;
}
.admin-profile__name {
  font-size: 18px;
  font-weight: 700;
  margin: 0;
  overflow-wrap: anywhere;
}
`;

const STATUS_META: Record<UserStatus, { labelKey: MessageKey; tone: BadgeTone }> = {
  active: { labelKey: "admin.users.statusActive", tone: "success" },
  invited: { labelKey: "admin.users.statusInvited", tone: "accent" },
  inactive: { labelKey: "admin.users.statusInactive", tone: "neutral" },
};

export default async function AdminUserDetail({
  params,
}: {
  params: { userId: string };
}) {
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

  const result = await getDirectoryUserDetail(params.userId, session.tenantId);
  if (result.status === "not_found") notFound();

  if (result.status === "offline") {
    return (
      <AppShell brand={brand} actions={actions}>
        <Stack gap={5}>
          <Button href="/users" size="sm" variant="ghost">
            {t(m, "admin.backToUsers")}
          </Button>
          <PageHeader
            title={t(m, "admin.userDetail.title")}
            subtitle={t(m, "admin.userDetail.subtitle")}
          />
          <Alert tone="warning">{t(m, "admin.userDetail.offlineBody")}</Alert>
        </Stack>
      </AppShell>
    );
  }

  const user = result.user;
  const status = STATUS_META[user.status];
  const orgUnitLabel = user.orgUnits.length ? user.orgUnits.join(", ") : "—";

  return (
    <AppShell brand={brand} actions={actions}>
      <style>{userCss}</style>
      <Stack gap={5}>
        <Button href="/users" size="sm" variant="ghost">
          {t(m, "admin.backToUsers")}
        </Button>

        <PageHeader
          title={t(m, "admin.userDetail.title")}
          subtitle={t(m, "admin.userDetail.subtitle")}
        />

        <Card>
          <div className="admin-profile">
            <Avatar name={user.name} size="lg" />
            <Stack gap={1}>
              <p className="admin-profile__name">{user.name}</p>
              <p className="admin-detail">{user.email}</p>
            </Stack>
            <Chip tone={status.tone}>{t(m, status.labelKey)}</Chip>
          </div>
        </Card>

        <Grid gap={4} min="240px">
          <Card>
            <Stack gap={3}>
              <h2 className="admin-section-title">
                {t(m, "admin.userDetail.account")}
              </h2>
              <Stack gap={1}>
                <p className="admin-detail">
                  <strong>{t(m, "admin.userDetail.status")}:</strong>{" "}
                  {t(m, status.labelKey)}
                </p>
                <p className="admin-detail">
                  <strong>{t(m, "admin.userDetail.orgUnit")}:</strong>{" "}
                  {orgUnitLabel}
                </p>
                <p className="admin-detail">
                  <strong>{t(m, "admin.userDetail.userId")}:</strong> {user.id}
                </p>
              </Stack>
            </Stack>
          </Card>

          <Card>
            <Stack gap={3}>
              <h2 className="admin-section-title">
                {t(m, "admin.userDetail.rolesTitle")}
              </h2>
              <Inline gap={2}>
                {user.roles.length ? (
                  user.roles.map((role) => (
                    <Badge key={role} tone="accent">
                      {role}
                    </Badge>
                  ))
                ) : (
                  <span className="admin-detail">{t(m, "common.none")}</span>
                )}
              </Inline>
            </Stack>
          </Card>
        </Grid>

        <Card>
          <Stack gap={3}>
            <h2 className="admin-section-title">
              {t(m, "admin.userDetail.activityTitle")}
            </h2>
            <Divider />
            <p className="admin-detail">
              {t(m, "admin.userDetail.activityBody")}
            </p>
          </Stack>
        </Card>
      </Stack>
    </AppShell>
  );
}
