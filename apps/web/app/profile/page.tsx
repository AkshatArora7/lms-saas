import { redirect } from "next/navigation";
import {
  Alert,
  AppShell,
  Avatar,
  Badge,
  Button,
  Card,
  Divider,
  Inline,
  PageHeader,
  Stack,
} from "@lms/ui";

import { getBranding } from "../lib/branding";
import { getSession } from "../lib/auth";
import { getProfile } from "../lib/profile";
import SignOutButton from "../sign-out-button";

const profileCss = `
.profile-header {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-4);
}
.profile-name {
  font-size: 20px;
  font-weight: 700;
  margin: 0;
  overflow-wrap: anywhere;
}
.profile-email {
  color: var(--lms-text-muted);
  margin: 0;
  overflow-wrap: anywhere;
}
.profile-section-title {
  font-size: 16px;
  margin: 0;
}
.profile-detail {
  color: var(--lms-text-muted);
  margin: 0;
  overflow-wrap: anywhere;
}
.profile-detail strong {
  color: var(--lms-text);
}
.pref-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-1) var(--lms-space-3);
  justify-content: space-between;
}
.pref-value {
  color: var(--lms-text-muted);
  overflow-wrap: anywhere;
}
`;

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);
  const profile = getProfile(session);

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{profileCss}</style>
      <Stack gap={4}>
        <Button href="/" size="sm" variant="ghost">
          ← Back to dashboard
        </Button>

        <PageHeader
          title="Profile"
          subtitle="Your account details and learning preferences."
        />

        <Card>
          <div className="profile-header">
            <Avatar name={profile.initialsSource} size="lg" />
            <Stack gap={1}>
              <p className="profile-name">{profile.displayName}</p>
              <p className="profile-email">{profile.email}</p>
              <Inline gap={2}>
                {profile.roles.length ? (
                  profile.roles.map((role) => (
                    <Badge key={role} tone="accent">
                      {role}
                    </Badge>
                  ))
                ) : (
                  <span className="profile-detail">No roles</span>
                )}
              </Inline>
            </Stack>
          </div>
        </Card>

        <Card>
          <Stack gap={3}>
            <h2 className="profile-section-title">Account</h2>
            <Stack gap={1}>
              <p className="profile-detail">
                <strong>User:</strong> {profile.userId}
              </p>
              <p className="profile-detail">
                <strong>Tenant:</strong> {profile.tenantId} ({profile.tier})
              </p>
            </Stack>
            <Stack gap={2}>
              <strong>Scopes</strong>
              <Inline gap={2}>
                {profile.scopes.length ? (
                  profile.scopes.map((scope) => (
                    <Badge key={scope} tone="neutral">
                      {scope}
                    </Badge>
                  ))
                ) : (
                  <span className="profile-detail">none</span>
                )}
              </Inline>
            </Stack>
          </Stack>
        </Card>

        <Card>
          <Stack gap={3}>
            <h2 className="profile-section-title">Preferences</h2>
            <Alert tone="info">
              Preferences are read-only for now — editing arrives when the
              profile service is wired up.
            </Alert>
            <Stack gap={3}>
              {profile.preferences.map((preference, index) => (
                <div key={preference.label}>
                  {index > 0 ? <Divider /> : null}
                  <div className="pref-row">
                    <strong>{preference.label}</strong>
                    <span className="pref-value">{preference.value}</span>
                  </div>
                </div>
              ))}
            </Stack>
          </Stack>
        </Card>
      </Stack>
    </AppShell>
  );
}
