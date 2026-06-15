import { redirect } from "next/navigation";
import {
  Alert,
  AppShell,
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
import { getSchoolRollups, summarizeRollups } from "../lib/reports";
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

  const schools = getSchoolRollups(session.tenantId);
  const summary = summarizeRollups(schools);

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

        {schools.length ? (
          <>
            <Grid gap={4} min="180px">
              <Card>
                <Stack gap={1}>
                  <p className="admin-stat">{summary.schoolCount}</p>
                  <p className="admin-stat-label">Schools</p>
                </Stack>
              </Card>
              <Card>
                <Stack gap={1}>
                  <p className="admin-stat">
                    {summary.totalStudents.toLocaleString()}
                  </p>
                  <p className="admin-stat-label">Students</p>
                </Stack>
              </Card>
              <Card>
                <Stack gap={1}>
                  <p className="admin-stat">{summary.avgCompletion}%</p>
                  <p className="admin-stat-label">Avg completion</p>
                </Stack>
              </Card>
              <Card>
                <Stack gap={1}>
                  <p className="admin-stat">{summary.totalAtRisk}</p>
                  <p className="admin-stat-label">At-risk learners</p>
                </Stack>
              </Card>
            </Grid>

            <section aria-labelledby="schools-heading">
              <Stack gap={3}>
                <h2 className="admin-section-title" id="schools-heading">
                  By school
                </h2>
                <ul className="school-list">
                  {schools.map((school) => (
                    <li key={school.id}>
                      <Card>
                        <Stack gap={3}>
                          <Inline align="center" gap={2} justify="space-between">
                            <p className="school-name">{school.name}</p>
                            <Inline gap={2}>
                              <Badge tone="neutral">
                                {school.students.toLocaleString()} students
                              </Badge>
                              <Badge
                                tone={school.atRisk > 30 ? "danger" : "warning"}
                              >
                                {school.atRisk} at risk
                              </Badge>
                            </Inline>
                          </Inline>
                          <div className="school-metrics">
                            <div>
                              <span className="metric-label">Completion</span>
                              <ProgressBar
                                label={`${school.name} completion`}
                                value={school.completion}
                              />
                            </div>
                            <div>
                              <span className="metric-label">Engagement</span>
                              <ProgressBar
                                label={`${school.name} engagement`}
                                value={school.engagement}
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
            No reporting data yet. Roll-up metrics appear here once analytics
            read models are populated for your district.
          </Alert>
        )}
      </Stack>
    </AppShell>
  );
}
