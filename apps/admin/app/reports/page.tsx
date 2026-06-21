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

import { getBranding } from "../lib/branding";
import { getSession, isAdmin } from "../lib/auth";
import { getReport } from "../lib/reports";
import { AppShell } from "../lib/ui";
import SignOutButton from "../sign-out-button";

const reportsCss = `
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

  const { orgUnits, summary } = await getReport(session.tenantId);

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{reportsCss}</style>
      <Stack gap={4}>
        <Button href="/" size="sm" variant="ghost">
          ← Back to console
        </Button>

        <PageHeader
          title="District reports"
          subtitle="Compare schools across your district to decide where to allocate support."
          actions={
            <Button disabled variant="secondary">
              Export CSV
            </Button>
          }
        />

        {orgUnits.length ? (
          <>
            <Grid gap={4} min="180px">
              <Card>
                <Stack gap={1}>
                  <p className="admin-stat">{summary.orgUnitCount}</p>
                  <p className="admin-stat-label">Schools</p>
                </Stack>
              </Card>
              <Card>
                <Stack gap={1}>
                  <p className="admin-stat">
                    {summary.enrollmentCount.toLocaleString()}
                  </p>
                  <p className="admin-stat-label">Enrollments</p>
                </Stack>
              </Card>
              <Card>
                <Stack gap={1}>
                  <p className="admin-stat">{pct(summary.attendanceRate)}</p>
                  <p className="admin-stat-label">Avg attendance</p>
                </Stack>
              </Card>
              <Card>
                <Stack gap={1}>
                  <p className="admin-stat">{pct(summary.averageGrade)}</p>
                  <p className="admin-stat-label">Avg grade</p>
                </Stack>
              </Card>
            </Grid>

            <section aria-labelledby="schools-heading">
              <Stack gap={3}>
                <h2 className="admin-section-title" id="schools-heading">
                  By school
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
                                {school.courseCount.toLocaleString()}{" "}
                                {school.courseCount === 1 ? "course" : "courses"}
                              </Badge>
                              <Badge tone="accent">
                                {school.enrollmentCount.toLocaleString()}{" "}
                                enrollments
                              </Badge>
                            </Inline>
                          </Inline>
                          <div className="school-metrics">
                            <div>
                              <span className="metric-label">
                                Attendance {pct(school.attendanceRate)}
                              </span>
                              <ProgressBar
                                label={`${school.name} attendance rate`}
                                value={school.attendanceRate ?? 0}
                              />
                            </div>
                            <div>
                              <span className="metric-label">
                                Average grade {pct(school.averageGrade)}
                              </span>
                              <ProgressBar
                                label={`${school.name} average grade`}
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
          <Alert tone="info">
            No reporting data yet. Roll-up metrics appear here once schools,
            enrollments, and activity exist for your district — or once the
            analytics service is reachable.
          </Alert>
        )}
      </Stack>
    </AppShell>
  );
}
