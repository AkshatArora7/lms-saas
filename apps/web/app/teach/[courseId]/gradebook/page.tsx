import { notFound, redirect } from "next/navigation";
import type { CSSProperties } from "react";
import {
  Alert,
  AppShell,
  Badge,
  Button,
  Card,
  Chip,
  Grid,
  Inline,
  PageHeader,
  Stack,
} from "@lms/ui";
import type { BadgeTone } from "@lms/ui";

import { getBranding } from "../../../lib/branding";
import { getSession } from "../../../lib/auth";
import { canTeach } from "../../../lib/teaching";
import {
  getCourseGradebook,
  summarizeAssignment,
  summarizeGradebook,
  summarizeLearner,
} from "../../../lib/gradebook";
import SignOutButton from "../../../sign-out-button";

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

const visuallyHidden: CSSProperties = {
  border: 0,
  clip: "rect(0 0 0 0)",
  height: "1px",
  margin: "-1px",
  overflow: "hidden",
  padding: 0,
  position: "absolute",
  width: "1px",
};

const gradebookCss = `
.gb-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius-md);
}
.gb-table {
  border-collapse: collapse;
  width: 100%;
  min-width: 540px;
  font-size: 0.9rem;
}
.gb-table th,
.gb-table td {
  padding: 0.625rem 0.75rem;
  text-align: center;
  border-bottom: 1px solid var(--lms-border);
  white-space: nowrap;
}
.gb-table thead th {
  background: var(--lms-surface-2);
  font-weight: 600;
  position: sticky;
  top: 0;
}
.gb-learner,
.gb-corner {
  text-align: left;
  position: sticky;
  left: 0;
  background: var(--lms-surface);
  z-index: 1;
  overflow-wrap: anywhere;
  white-space: normal;
  min-width: 9rem;
}
.gb-table thead .gb-corner {
  background: var(--lms-surface-2);
  z-index: 2;
}
.gb-table tfoot td,
.gb-table tfoot th {
  font-weight: 600;
  border-bottom: none;
  background: var(--lms-surface-2);
}
.gb-points {
  display: block;
  font-weight: 400;
  font-size: 0.75rem;
  color: var(--lms-text-muted);
}
.gb-missing {
  color: var(--lms-text-muted);
}
.gb-total {
  font-weight: 700;
}
`;

function avgTone(percent: number | null): BadgeTone {
  if (percent === null) return "neutral";
  if (percent >= 85) return "success";
  if (percent >= 70) return "accent";
  if (percent >= 60) return "warning";
  return "danger";
}

export default async function GradebookPage({
  params,
}: {
  params: { courseId: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);

  if (!canTeach(session.roles)) {
    return (
      <AppShell brand={brand} actions={<SignOutButton />}>
        <Stack gap={4}>
          <Button href="/teach" size="sm" variant="ghost">
            ← Back to teaching
          </Button>
          <PageHeader
            title="Gradebook"
            subtitle="Scores for the learners in your course."
          />
          <Alert tone="info">
            The gradebook is available to instructors. Your account does not
            currently hold a teaching role.
          </Alert>
        </Stack>
      </AppShell>
    );
  }

  const gradebook = await getCourseGradebook(params.courseId, session.tenantId);
  if (!gradebook) notFound();

  const summary = summarizeGradebook(gradebook);
  const assignmentSummaries = gradebook.assignments.map((a) => ({
    assignment: a,
    summary: summarizeAssignment(a, gradebook),
  }));

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{gradebookCss}</style>
      <Stack gap={4}>
        <Button href="/teach" size="sm" variant="ghost">
          ← Back to teaching
        </Button>

        <PageHeader
          title={`${gradebook.title} gradebook`}
          subtitle="Every enrolled learner's score on each assignment, so you can spot missing work and how the class is doing."
          actions={
            <Inline gap={2}>
              {gradebook.code ? <Badge tone="neutral">{gradebook.code}</Badge> : null}
              <Button
                href={`/courses/${gradebook.courseId}`}
                size="sm"
                variant="secondary"
              >
                Open course
              </Button>
            </Inline>
          }
        />

        <Grid gap={4} min="160px">
          <Card>
            <Stack gap={1}>
              <p style={statValueStyle}>{summary.learnerCount}</p>
              <p style={mutedStyle}>Learners</p>
            </Stack>
          </Card>
          <Card>
            <Stack gap={1}>
              <p style={statValueStyle}>{summary.assignmentCount}</p>
              <p style={mutedStyle}>Assignments</p>
            </Stack>
          </Card>
          <Card>
            <Stack gap={1}>
              <p style={statValueStyle}>
                {summary.gradedCells}
                <span style={{ fontSize: "1rem", fontWeight: 400 }}>
                  {" "}
                  / {summary.totalCells}
                </span>
              </p>
              <p style={mutedStyle}>Graded submissions</p>
            </Stack>
          </Card>
          <Card>
            <Stack gap={1}>
              <p style={statValueStyle}>
                {summary.classAverage === null
                  ? "—"
                  : `${summary.classAverage}%`}
              </p>
              <p style={mutedStyle}>Class average</p>
            </Stack>
          </Card>
        </Grid>

        <section aria-labelledby="gb-heading">
          <Stack gap={3}>
            <h2 id="gb-heading" style={headingStyle}>
              Scores
            </h2>
            <div className="gb-scroll">
              <table className="gb-table">
                <caption style={visuallyHidden}>
                  {gradebook.title} scores by learner and assignment
                </caption>
                <thead>
                  <tr>
                    <th className="gb-corner" scope="col">
                      Learner
                    </th>
                    {gradebook.assignments.map((a) => (
                      <th key={a.id} scope="col">
                        {a.title}
                        <span className="gb-points">/ {a.points} pts</span>
                      </th>
                    ))}
                    <th scope="col">Course</th>
                  </tr>
                </thead>
                <tbody>
                  {gradebook.learners.map((learner) => {
                    const ls = summarizeLearner(learner, gradebook);
                    return (
                      <tr key={learner.id}>
                        <th className="gb-learner" scope="row">
                          {learner.name}
                        </th>
                        {gradebook.assignments.map((a) => {
                          const entry = learner.entries.find(
                            (e) => e.assignmentId === a.id,
                          );
                          if (!entry || entry.score === null) {
                            return (
                              <td key={a.id} className="gb-missing">
                                —
                              </td>
                            );
                          }
                          return (
                            <td key={a.id}>
                              {entry.score}
                              <span className="gb-points">/ {a.points}</span>
                            </td>
                          );
                        })}
                        <td className="gb-total">
                          {ls.percent === null ? "—" : `${ls.percent}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th className="gb-learner" scope="row">
                      Class average
                    </th>
                    {assignmentSummaries.map(({ assignment, summary: as }) => (
                      <td key={assignment.id}>
                        {as.classAverage === null
                          ? "—"
                          : `${as.classAverage}%`}
                      </td>
                    ))}
                    <td>
                      {summary.classAverage === null
                        ? "—"
                        : `${summary.classAverage}%`}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Stack>
        </section>

        <section aria-labelledby="gb-missing-heading">
          <Stack gap={3}>
            <h2 id="gb-missing-heading" style={headingStyle}>
              Needs attention
            </h2>
            <Grid min="240px">
              {gradebook.learners.map((learner) => {
                const ls = summarizeLearner(learner, gradebook);
                return (
                  <Card key={learner.id}>
                    <Stack gap={2}>
                      <Inline align="center" gap={2} justify="space-between">
                        <h3 style={headingStyle}>{learner.name}</h3>
                        <Chip tone={avgTone(ls.percent)}>
                          {ls.percent === null ? "No grades" : `${ls.percent}%`}
                        </Chip>
                      </Inline>
                      {ls.missing > 0 ? (
                        <p style={mutedStyle}>
                          {ls.missing} missing{" "}
                          {ls.missing === 1 ? "assignment" : "assignments"} ·{" "}
                          {ls.earned}/{ls.possible} pts graded
                        </p>
                      ) : (
                        <p style={mutedStyle}>
                          All assignments submitted · {ls.earned}/{ls.possible}{" "}
                          pts
                        </p>
                      )}
                    </Stack>
                  </Card>
                );
              })}
            </Grid>
          </Stack>
        </section>
      </Stack>
    </AppShell>
  );
}
