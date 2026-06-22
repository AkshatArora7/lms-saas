import { redirect } from "next/navigation";
import type { ReactElement } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Grid,
  Inline,
  PageHeader,
  Stack,
} from "@lms/ui";
import { getMessages, t } from "@lms/i18n";
import type { Messages, MessageKey } from "@lms/i18n";

import { getBranding } from "../lib/branding";
import { getSession, isAdmin } from "../lib/auth";
import {
  getOrgUnits,
  summarizeOrgTree,
  type OrgUnit,
  type OrgUnitType,
} from "../lib/org-units";
import { resolveRequestLocale } from "../lib/i18n";
import { AppLocaleSwitcher } from "../lib/locale-switcher";
import { adminPolishCss, AppShell, OrgUnitsIcon } from "../lib/ui";
import SignOutButton from "../sign-out-button";

const orgCss = `${adminPolishCss}
/* Data-dense org hierarchy. The recursive tree is the correct representation
   (parent -> children), so it stays a nested <ul> rather than a flat table.
   Admin density: tighter rhythm via space-1, a left rail on nested levels, and
   a subtle hover affordance on each node row so the tree scans like the rest of
   the admin console. All values are tokens — fully white-label. */
.org-tree,
.org-tree ul {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-1);
  list-style: none;
  margin: 0;
  padding: 0;
}
.org-tree ul {
  border-left: 1px solid var(--lms-border);
  margin-top: var(--lms-space-1);
  padding-left: var(--lms-space-3);
}
.org-node {
  align-items: center;
  border-radius: var(--lms-radius-sm);
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2);
  justify-content: space-between;
  min-width: 0;
  padding: var(--lms-row-pad-y) var(--lms-space-2);
  transition: background-color 150ms cubic-bezier(0.2, 0, 0, 1);
}
.org-node:hover {
  background: var(--lms-surface-2);
}
.org-node__name {
  font-weight: 600;
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
@media (prefers-reduced-motion: reduce) {
  .org-node {
    transition: none;
  }
}
`;

const TYPE_LABEL_KEY: Record<OrgUnitType, MessageKey> = {
  organization: "admin.orgUnits.typeOrganization",
  department: "admin.orgUnits.typeDepartment",
  semester: "admin.orgUnits.typeSemester",
  course_template: "admin.orgUnits.typeCourseTemplate",
  course_offering: "admin.orgUnits.typeCourseOffering",
  section: "admin.orgUnits.typeSection",
  group: "admin.orgUnits.typeGroup",
};

function OrgNode({ m, unit }: { m: Messages; unit: OrgUnit }): ReactElement {
  return (
    <li>
      <div className="org-node">
        <Inline align="center" gap={2}>
          <Badge tone="accent">{t(m, TYPE_LABEL_KEY[unit.type])}</Badge>
          <p className="org-node__name">{unit.name}</p>
        </Inline>
      </div>
      {unit.children.length ? (
        <ul>
          {unit.children.map((child) => (
            <OrgNode key={child.id} m={m} unit={child} />
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

  const units = await getOrgUnits(session.tenantId);

  if (!units) {
    return (
      <AppShell brand={brand} actions={actions}>
        <style>{orgCss}</style>
        <Stack gap={5}>
          <Button href="/" size="sm" variant="ghost">
            {t(m, "admin.backToConsole")}
          </Button>
          <PageHeader
            title={t(m, "admin.orgUnits.title")}
            subtitle={t(m, "admin.orgUnits.subtitle")}
          />
          <Alert tone="warning">{t(m, "admin.orgUnits.offlineBody")}</Alert>
        </Stack>
      </AppShell>
    );
  }

  const stats = summarizeOrgTree(units);

  return (
    <AppShell brand={brand} actions={actions}>
      <style>{orgCss}</style>
      <Stack gap={5}>
        <Button href="/" size="sm" variant="ghost">
          {t(m, "admin.backToConsole")}
        </Button>

        <PageHeader
          title={t(m, "admin.orgUnits.title")}
          subtitle={t(m, "admin.orgUnits.subtitle")}
        />

        <Grid gap={4} min="180px">
          <Card>
            <Inline align="flex-start" gap={3}>
              <span aria-hidden="true" className="admin-stat-card__icon">
                <OrgUnitsIcon />
              </span>
              <Stack gap={1}>
                <p className="admin-stat-value">{stats.unitCount}</p>
                <p className="admin-stat-label">
                  {t(m, "admin.orgUnits.statUnits")}
                </p>
              </Stack>
            </Inline>
          </Card>
          <Card>
            <Inline align="flex-start" gap={3}>
              <span aria-hidden="true" className="admin-stat-card__icon">
                <OrgUnitsIcon />
              </span>
              <Stack gap={1}>
                <p className="admin-stat-value">{stats.depth}</p>
                <p className="admin-stat-label">
                  {t(m, "admin.orgUnits.statDepth")}
                </p>
              </Stack>
            </Inline>
          </Card>
        </Grid>

        <section aria-labelledby="org-tree-heading">
          <Stack gap={3}>
            <h2 className="admin-section-title" id="org-tree-heading">
              {t(m, "admin.orgUnits.heading")}
            </h2>
            {units.length ? (
              <Card>
                <ul className="org-tree">
                  {units.map((unit) => (
                    <OrgNode key={unit.id} m={m} unit={unit} />
                  ))}
                </ul>
              </Card>
            ) : (
              <EmptyState
                description={t(m, "admin.orgUnits.emptyBody")}
                icon={<OrgUnitsIcon />}
                title={t(m, "admin.orgUnits.emptyTitle")}
              />
            )}
          </Stack>
        </section>
      </Stack>
    </AppShell>
  );
}
