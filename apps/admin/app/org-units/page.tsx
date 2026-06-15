import { redirect } from "next/navigation";
import type { ReactElement } from "react";
import {
  Alert,
  AppShell,
  Badge,
  Button,
  Card,
  Grid,
  Inline,
  PageHeader,
  Stack,
} from "@lms/ui";

import { getBranding } from "../lib/branding";
import { getSession, isAdmin } from "../lib/auth";
import {
  getOrgUnits,
  summarizeOrgTree,
  type OrgUnit,
  type OrgUnitType,
} from "../lib/org-units";
import SignOutButton from "../sign-out-button";

const orgCss = `
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
.org-tree,
.org-tree ul {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-2);
  list-style: none;
  margin: 0;
  padding: 0;
}
.org-tree ul {
  border-left: 1px solid var(--lms-border);
  margin-top: var(--lms-space-2);
  padding-left: var(--lms-space-3);
}
.org-node {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2);
  justify-content: space-between;
}
.org-node__name {
  font-weight: 600;
  margin: 0;
  overflow-wrap: anywhere;
}
.org-node__count {
  color: var(--lms-text-muted);
  white-space: nowrap;
}
`;

const TYPE_LABEL: Record<OrgUnitType, string> = {
  district: "District",
  school: "School",
  department: "Department",
  grade: "Grade",
};

function OrgNode({ unit }: { unit: OrgUnit }): ReactElement {
  return (
    <li>
      <div className="org-node">
        <Inline align="center" gap={2}>
          <Badge tone="accent">{TYPE_LABEL[unit.type]}</Badge>
          <p className="org-node__name">{unit.name}</p>
        </Inline>
        <span className="org-node__count">
          {unit.memberCount} {unit.memberCount === 1 ? "member" : "members"}
        </span>
      </div>
      {unit.children.length ? (
        <ul>
          {unit.children.map((child) => (
            <OrgNode key={child.id} unit={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export default async function AdminOrgUnits() {
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

  const units = getOrgUnits(session.tenantId);
  const stats = summarizeOrgTree(units);

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{orgCss}</style>
      <Stack gap={4}>
        <Button href="/" size="sm" variant="ghost">
          ← Back to console
        </Button>

        <PageHeader
          title="Org units"
          subtitle="The hierarchy of districts, schools, departments, and grades in this tenant."
        />

        <Grid gap={4} min="180px">
          <Card>
            <Stack gap={1}>
              <p className="admin-stat">{stats.unitCount}</p>
              <p className="admin-stat-label">Total units</p>
            </Stack>
          </Card>
          <Card>
            <Stack gap={1}>
              <p className="admin-stat">{stats.depth}</p>
              <p className="admin-stat-label">Levels deep</p>
            </Stack>
          </Card>
        </Grid>

        <section aria-labelledby="org-tree-heading">
          <Stack gap={3}>
            <h2 className="admin-section-title" id="org-tree-heading">
              Hierarchy
            </h2>
            {units.length ? (
              <Card>
                <ul className="org-tree">
                  {units.map((unit) => (
                    <OrgNode key={unit.id} unit={unit} />
                  ))}
                </ul>
              </Card>
            ) : (
              <Alert tone="info">
                No org units yet. Connect your SIS or create units to build the
                hierarchy.
              </Alert>
            )}
          </Stack>
        </section>
      </Stack>
    </AppShell>
  );
}
