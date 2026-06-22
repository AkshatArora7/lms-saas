import { redirect } from "next/navigation";
import {
  Alert,
  Badge,
  Button,
  Card,
  Grid,
  Inline,
  PageHeader,
  ProgressBar,
  Stack,
} from "@lms/ui";
import { getMessages, t } from "@lms/i18n";

import { getBranding } from "../lib/branding";
import { getSession, isAdmin } from "../lib/auth";
import { getReport } from "../lib/reports";
import { resolveRequestLocale } from "../lib/i18n";
import { AppLocaleSwitcher } from "../lib/locale-switcher";
import { adminPolishCss, AppShell, ReportsIcon } from "../lib/ui";
import SignOutButton from "../sign-out-button";

const reportsCss = `${adminPolishCss}
.school-name {
  font-weight: 600;
  margin: 0;
  overflow-wrap: anywhere;
}
.school-list {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-3);
  list-style: none;
  margin: 0;
  padding: 0;
}
.school-metrics {
  display: grid;
  gap: var(--lms-space-3);
  grid-template-columns: 1fr;
}
@media (min-width: 640px) {
  .school-metrics {
    grid-template-columns: 1fr 1fr;
  }
}
.metric-label {
  color: var(--lms-text-muted);
  display: block;
  margin: 0 0 4px;
}
`;

/** Render a 0-100 percentage (1 dp) or an em dash when null. */
function pct(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

export default async function AdminReports() {
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

  const { orgUnits, summary } = await getReport(session.tenantId);

  return (
    <AppShell brand={brand} actions={actions}>
      <style>{reportsCss}</style>
      <Stack gap={5}>
        <Button href="/" size="sm" variant="ghost">
          {t(m, "admin.backToConsole")}
        </Button>

        <PageHeader
          title={t(m, "admin.reports.title")}
          subtitle={t(m, "admin.reports.subtitle")}
          actions={
            <Button disabled variant="secondary">
              {t(m, "admin.reports.exportCsv")}
            </Button>
          }
        />

        {orgUnits.length ? (
          <>
            <Grid gap={4} min="180px">
              <Card>
                <Inline align="flex-start" gap={3}>
                  <span aria-hidden="true" className="admin-stat-card__icon">
                    <ReportsIcon />
                  </span>
                  <Stack gap={1}>
                    <p className="admin-stat-value">{summary.orgUnitCount}</p>
                    <p className="admin-stat-label">
                      {t(m, "admin.reports.statSchools")}
                    </p>
                  </Stack>
                </Inline>
              </Card>
              <Card>
                <Inline align="flex-start" gap={3}>
                  <span aria-hidden="true" className="admin-stat-card__icon">
                    <ReportsIcon />
                  </span>
                  <Stack gap={1}>
                    <p className="admin-stat-value">
                      {summary.enrollmentCount.toLocaleString()}
                    </p>
                    <p className="admin-stat-label">
                      {t(m, "admin.reports.statEnrollments")}
                    </p>
                  </Stack>
                </Inline>
              </Card>
              <Card>
                <Inline align="flex-start" gap={3}>
                  <span aria-hidden="true" className="admin-stat-card__icon">
                    <ReportsIcon />
                  </span>
                  <Stack gap={1}>
                    <p className="admin-stat-value">
                      {pct(summary.attendanceRate)}
                    </p>
                    <p className="admin-stat-label">
                      {t(m, "admin.reports.statAttendance")}
                    </p>
                  </Stack>
                </Inline>
              </Card>
              <Card>
                <Inline align="flex-start" gap={3}>
                  <span aria-hidden="true" className="admin-stat-card__icon">
                    <ReportsIcon />
                  </span>
                  <Stack gap={1}>
                    <p className="admin-stat-value">
                      {pct(summary.averageGrade)}
                    </p>
                    <p className="admin-stat-label">
                      {t(m, "admin.reports.statGrade")}
                    </p>
                  </Stack>
                </Inline>
              </Card>
            </Grid>

            <section aria-labelledby="schools-heading">
              <Stack gap={3}>
                <h2 className="admin-section-title" id="schools-heading">
                  {t(m, "admin.reports.heading")}
                </h2>
                <ul className="school-list">
                  {orgUnits.map((school) => (
                    <li key={school.orgUnitId}>
                      <Card>
                        <Stack gap={3}>
                          <Inline align="center" gap={2} justify="space-between">
                            <p className="school-name">{school.name}</p>
                            <Inline gap={2}>
                              {school.code ? (
                                <Badge tone="neutral">{school.code}</Badge>
                              ) : null}
                              <Badge tone="neutral">
                                {t(
                                  m,
                                  school.courseCount === 1
                                    ? "admin.reports.courseSingular"
                                    : "admin.reports.coursePlural",
                                  { count: school.courseCount.toLocaleString() },
                                )}
                              </Badge>
                              <Badge tone="accent">
                                {t(m, "admin.reports.enrollmentsBadge", {
                                  count:
                                    school.enrollmentCount.toLocaleString(),
                                })}
                              </Badge>
                            </Inline>
                          </Inline>
                          <div className="school-metrics">
                            <div>
                              <span className="metric-label">
                                {t(m, "admin.reports.metricAttendance", {
                                  value: pct(school.attendanceRate),
                                })}
                              </span>
                              <ProgressBar
                                label={`${school.name} — ${t(
                                  m,
                                  "admin.reports.metricAttendance",
                                  { value: pct(school.attendanceRate) },
                                )}`}
                                value={school.attendanceRate ?? 0}
                              />
                            </div>
                            <div>
                              <span className="metric-label">
                                {t(m, "admin.reports.metricGrade", {
                                  value: pct(school.averageGrade),
                                })}
                              </span>
                              <ProgressBar
                                label={`${school.name} — ${t(
                                  m,
                                  "admin.reports.metricGrade",
                                  { value: pct(school.averageGrade) },
                                )}`}
                                value={school.averageGrade ?? 0}
                              />
                            </div>
                          </div>
                        </Stack>
                      </Card>
                    </li>
                  ))}
                </ul>
              </Stack>
            </section>
          </>
        ) : (
          <Alert tone="info">{t(m, "admin.reports.empty")}</Alert>
        )}
      </Stack>
    </AppShell>
  );
}
