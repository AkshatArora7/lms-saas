import { redirect } from "next/navigation";
import {
  Alert,
  AppShell,
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  Divider,
  PageHeader,
  Stack,
} from "@lms/ui";

import { getBranding } from "../lib/branding";
import { getSession } from "../lib/auth";
import { getProfile } from "../lib/profile";
import SignOutButton from "../sign-out-button";

/**
 * Scoped layout polish for the learner profile screen. Every visual decision
 * resolves from the tenant theme tokens (var(--lms-*)) so the page stays fully
 * white-label: the same markup renders for a teal/rounded brand and a red/sharp
 * one. A prominent identity header anchors the page; the Account details use a
 * semantic definition list with aligned label/value rows; preferences read as a
 * clean divided list. The layout reflows from a single stacked column on phones
 * (avatar above text, rows stacked) to aligned two-column rows on wider screens
 * with no horizontal overflow at 360px.
 */
const profileCss = `
.pf-identity {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-4);
}
.pf-identity .lms-avatar {
  flex-shrink: 0;
}
.pf-identity__meta {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-2);
  min-width: 0;
  flex: 1 1 16rem;
}
.pf-name {
  font-size: clamp(1.4rem, 4vw, 1.8rem);
  font-weight: 700;
  line-height: 1.2;
  margin: 0;
  overflow-wrap: anywhere;
}
.pf-email {
  color: var(--lms-text-muted);
  font-size: 0.95rem;
  margin: 0;
  overflow-wrap: anywhere;
}
.pf-pills {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2);
  margin-top: var(--lms-space-1);
}
.pf-section-title {
  font-size: clamp(1.1rem, 3vw, 1.3rem);
  font-weight: 700;
  line-height: 1.25;
  margin: 0;
  padding-bottom: var(--lms-space-2);
  border-bottom: 1px solid var(--lms-border);
}
.pf-dl {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-4);
  margin: 0;
}
.pf-dl__row {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-1);
}
.pf-dt {
  color: var(--lms-text-muted);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin: 0;
}
.pf-dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--lms-space-2);
}
@media (min-width: 560px) {
  .pf-dl__row {
    flex-direction: row;
    align-items: baseline;
    gap: var(--lms-space-4);
  }
  .pf-dt {
    flex: 0 0 9rem;
  }
  .pf-dd {
    flex: 1 1 0;
  }
}
.pf-muted {
  color: var(--lms-text-muted);
  margin: 0;
}
.pf-scopes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2);
}
.pref-row {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-1) var(--lms-space-4);
  justify-content: space-between;
}
.pref-label {
  font-weight: 600;
  min-width: 0;
  overflow-wrap: anywhere;
}
.pref-value {
  color: var(--lms-text-muted);
  overflow-wrap: anywhere;
  text-align: right;
}
`;

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);
  const profile = await getProfile(session);

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
          <div className="pf-identity">
            <Avatar name={profile.initialsSource} size="lg" />
            <div className="pf-identity__meta">
              <p className="pf-name">{profile.displayName}</p>
              <p className="pf-email">{profile.email}</p>
              <div className="pf-pills">
                {profile.roles.length ? (
                  profile.roles.map((role) => (
                    <Badge key={role} tone="accent">
                      {role}
                    </Badge>
                  ))
                ) : (
                  <span className="pf-muted">No roles</span>
                )}
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <Stack gap={4}>
            <h2 className="pf-section-title">Account</h2>
            <dl className="pf-dl">
              <div className="pf-dl__row">
                <dt className="pf-dt">User</dt>
                <dd className="pf-dd">{profile.userId}</dd>
              </div>
              <div className="pf-dl__row">
                <dt className="pf-dt">Tenant</dt>
                <dd className="pf-dd">
                  <span>{profile.tenantId}</span>
                  <Chip tone="accent">{profile.tier}</Chip>
                </dd>
              </div>
              <div className="pf-dl__row">
                <dt className="pf-dt">Scopes</dt>
                <dd className="pf-dd">
                  <div className="pf-scopes">
                    {profile.scopes.length ? (
                      profile.scopes.map((scope) => (
                        <Badge key={scope} tone="neutral">
                          {scope}
                        </Badge>
                      ))
                    ) : (
                      <span className="pf-muted">none</span>
                    )}
                  </div>
                </dd>
              </div>
            </dl>
          </Stack>
        </Card>

        <Card>
          <Stack gap={4}>
            <h2 className="pf-section-title">Preferences</h2>
            <Alert tone="info">
              Preferences are read-only for now — editing arrives when the
              profile service is wired up.
            </Alert>
            <Stack gap={3}>
              {profile.preferences.map((preference, index) => (
                <div key={preference.label}>
                  {index > 0 ? <Divider /> : null}
                  <div className="pref-row">
                    <span className="pref-label">{preference.label}</span>
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
