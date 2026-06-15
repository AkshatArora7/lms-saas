import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import {
  AppShell,
  Badge,
  Button,
  Card,
  EmptyState,
  Grid,
  Inline,
  PageHeader,
  ProgressBar,
  Stack,
} from "@lms/ui";

import { getBranding } from "../lib/branding";
import { getSession } from "../lib/auth";
import { getCourseGrades, summarizeGrades } from "../lib/grades";
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
};

const categoryRowStyle: CSSProperties = {
  alignItems: "center",
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--lms-space-2)",
  justifyContent: "space-between",
};

export default async function Grades() {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);
  const grades = getCourseGrades(session.tenantId);
  const summary = summarizeGrades(grades);

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <Stack gap={4}>
        <Button href="/" size="sm" variant="ghost">
          ← Back to dashboard
        </Button>

        <PageHeader
          title="Grades"
          subtitle="Your current grade in each course, with a breakdown by category."
        />

        {grades.length ? (
          <>
            <Grid gap={4} min="180px">
              <Card>
                <Stack gap={1}>
                  <p style={statValueStyle}>{summary.average}%</p>
                  <p style={mutedStyle}>Average across courses</p>
                </Stack>
              </Card>
              <Card>
                <Stack gap={1}>
                  <p style={statValueStyle}>{summary.courseCount}</p>
                  <p style={mutedStyle}>Graded courses</p>
                </Stack>
              </Card>
            </Grid>

            <section aria-labelledby="grades-heading">
              <Stack gap={3}>
                <h2 id="grades-heading" style={headingStyle}>
                  By course
                </h2>
                <Grid min="280px">
                  {grades.map((grade) => (
                    <Card key={grade.courseId}>
                      <Stack gap={3}>
                        <Inline align="center" gap={2} justify="space-between">
                          <div>
                            <h3 style={headingStyle}>{grade.title}</h3>
                            <Badge tone="neutral">{grade.code}</Badge>
                          </div>
                          <Badge tone="accent">
                            {grade.letter} · {grade.percent}%
                          </Badge>
                        </Inline>
                        <ProgressBar
                          label={`${grade.title} overall grade`}
                          value={grade.percent}
                        />
                        <Stack gap={2}>
                          {grade.categories.map((category) => (
                            <div key={category.name} style={categoryRowStyle}>
                              <span>{category.name}</span>
                              <Inline align="center" gap={2}>
                                <Badge tone="neutral">{category.weight}%</Badge>
                                <span>{category.score}%</span>
                              </Inline>
                            </div>
                          ))}
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
            description="Grades will appear here once your work has been graded."
            icon="📊"
            title="No grades yet"
          />
        )}
      </Stack>
    </AppShell>
  );
}
