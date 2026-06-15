import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
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
  ProgressBar,
  Stack,
} from "@lms/ui";
import type { BadgeTone } from "@lms/ui";

import { getBranding } from "../lib/branding";
import { getSession } from "../lib/auth";
import {
  canTeach,
  getTaughtCourses,
  summarizeTeaching,
  type RiskLevel,
} from "../lib/teaching";
import SignOutButton from "../sign-out-button";

const headingStyle: CSSProperties = {
  fontSize: "1rem",
  lineHeight: 1.3,
  margin: 0,
  overflowWrap: "anywhere",
};

const statValueStyle: CSSProperties = {
  fontSize: "1.75rem",
  fontWeight: 700,
  lineHeight: 1.1,
  margin: 0,
};

const mutedStyle: CSSProperties = {
  color: "var(--lms-text-muted)",
  margin: 0,
  overflowWrap: "anywhere",
};

const riskRowStyle: CSSProperties = {
  alignItems: "center",
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--lms-space-2)",
  justifyContent: "space-between",
};

const RISK_META: Record<RiskLevel, { label: string; tone: BadgeTone }> = {
  on_track: { label: "On track", tone: "success" },
  at_risk: { label: "At risk", tone: "warning" },
  critical: { label: "Critical", tone: "danger" },
};

export default async function Teach() {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);

  if (!canTeach(session.roles)) {
    return (
      <AppShell brand={brand} actions={<SignOutButton />}>
        <PageHeader
          title="Teaching"
          subtitle="Engagement insights for the courses you teach."
        />
        <Alert tone="info">
          This dashboard is available to instructors. Your account does not
          currently hold a teaching role.
        </Alert>
      </AppShell>
    );
  }

  const courses = getTaughtCourses(session.tenantId);
  const summary = summarizeTeaching(courses);

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <Stack gap={4}>
        <Button href="/" size="sm" variant="ghost">
          ← Back to dashboard
        </Button>

        <PageHeader
          title="Teaching"
          subtitle="Engagement and at-risk learners across the courses you teach, so you can intervene early."
        />

        {courses.length ? (
          <>
            <Grid gap={4} min="180px">
              <Card>
                <Stack gap={1}>
                  <p style={statValueStyle}>{summary.courseCount}</p>
                  <p style={mutedStyle}>Courses taught</p>
                </Stack>
              </Card>
              <Card>
                <Stack gap={1}>
                  <p style={statValueStyle}>{summary.totalEnrolled}</p>
                  <p style={mutedStyle}>Learners enrolled</p>
                </Stack>
              </Card>
              <Card>
                <Stack gap={1}>
                  <p style={statValueStyle}>{summary.atRiskCount}</p>
                  <p style={mutedStyle}>At-risk learners</p>
                </Stack>
              </Card>
            </Grid>

            <section aria-labelledby="teach-heading">
              <Stack gap={3}>
                <h2 id="teach-heading" style={headingStyle}>
                  By course
                </h2>
                <Grid min="300px">
                  {courses.map((course) => (
                    <Card key={course.id}>
                      <Stack gap={3}>
                        <Inline align="center" gap={2} justify="space-between">
                          <div>
                            <h3 style={headingStyle}>{course.title}</h3>
                            <Inline gap={2}>
                              <Badge tone="neutral">{course.code}</Badge>
                              <Badge tone="neutral">
                                {course.enrolled} enrolled
                              </Badge>
                            </Inline>
                          </div>
                          <a
                            href={`/courses/${course.id}`}
                            style={{
                              color: "var(--lms-accent)",
                              fontWeight: 600,
                              textDecoration: "none",
                              whiteSpace: "nowrap",
                            }}
                          >
                            Open →
                          </a>
                        </Inline>

                        <ProgressBar
                          label={`${course.title} engagement`}
                          value={course.engagement}
                        />
                        <Badge tone="neutral">
                          {course.engagement}% avg engagement
                        </Badge>

                        <Stack gap={2}>
                          <strong>At-risk learners</strong>
                          {course.atRisk.length ? (
                            course.atRisk.map((learner) => {
                              const risk = RISK_META[learner.risk];
                              return (
                                <div key={learner.id} style={riskRowStyle}>
                                  <div>
                                    <p style={headingStyle}>{learner.name}</p>
                                    <p style={mutedStyle}>{learner.reason}</p>
                                  </div>
                                  <Chip tone={risk.tone}>{risk.label}</Chip>
                                </div>
                              );
                            })
                          ) : (
                            <p style={mutedStyle}>
                              No learners flagged - everyone is on track.
                            </p>
                          )}
                        </Stack>
                      </Stack>
                    </Card>
                  ))}
                </Grid>
              </Stack>
            </section>
          </>
        ) : (
          <EmptyState
            description="When you teach courses with enrolled learners, engagement insights appear here."
            icon="🧑‍🏫"
            title="No teaching data yet"
          />
        )}
      </Stack>
    </AppShell>
  );
}
