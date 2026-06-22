import { notFound, redirect } from "next/navigation";
import type { CSSProperties } from "react";
import {
  Alert,
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
import { getMessages, t } from "@lms/i18n";

import { getBranding } from "../../../lib/branding";
import { getSession } from "../../../lib/auth";
import { resolveRequestLocale } from "../../../lib/i18n";
import { AppLocaleSwitcher } from "../../../lib/locale-switcher";
import { AppShell, teachPolishCss } from "../../../lib/ui";
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
  const m = getMessages(await resolveRequestLocale());

  const shellActions = (
    <>
      <AppLocaleSwitcher />
      <SignOutButton />
    </>
  );

  if (!canTeach(session.roles)) {
    return (
      <AppShell actions={shellActions} brand={brand}>
        <PageHeader
          subtitle={t(m, "teach.notAuthorizedSubtitle")}
          title={t(m, "teach.notAuthorizedTitle")}
        />
        <Alert tone="warning">
          <strong>{session.userId}</strong> — {t(m, "teach.notAuthorizedBody")}
        </Alert>
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
    <AppShell actions={shellActions} brand={brand}>
      <style>{teachPolishCss}</style>
      <style>{gradebookCss}</style>
      <Stack gap={4}>
        <Button href="/teach" size="sm" variant="ghost">
          {t(m, "teach.gradebook.backToTeaching")}
        </Button>

        <PageHeader
          title={t(m, "teach.gradebook.title", { course: gradebook.title })}
          subtitle={t(m, "teach.gradebook.subtitle")}
          actions={
            <Inline gap={2}>
              {gradebook.code ? (
                <Badge tone="neutral">{gradebook.code}</Badge>
              ) : null}
              <Button
                href={`/courses/${gradebook.courseId}`}
                size="sm"
                variant="secondary"
              >
                {t(m, "teach.gradebook.openCourse")}
              </Button>
            </Inline>
          }
        />

        <Grid gap={4} min="160px">
          <Card>
            <div className="tch-stat-card">
              <p className="tch-stat">{summary.learnerCount}</p>
              <p className="tch-stat-label">
                {t(m, "teach.gradebook.statLearners")}
              </p>
            </div>
          </Card>
          <Card>
            <div className="tch-stat-card">
              <p className="tch-stat">{summary.assignmentCount}</p>
              <p className="tch-stat-label">
                {t(m, "teach.gradebook.statAssignments")}
              </p>
            </div>
          </Card>
          <Card>
            <div className="tch-stat-card">
              <p className="tch-stat">
                {summary.gradedCells}
                <span className="tch-stat-sub">
                  {" "}
                  / {summary.totalCells}
                </span>
              </p>
              <p className="tch-stat-label">
                {t(m, "teach.gradebook.statGraded")}
              </p>
            </div>
          </Card>
          <Card>
            <div className="tch-stat-card">
              <p className="tch-stat">
                {summary.classAverage === null
                  ? "—"
                  : `${summary.classAverage}%`}
              </p>
              <p className="tch-stat-label">
                {t(m, "teach.gradebook.statClassAverage")}
              </p>
            </div>
          </Card>
        </Grid>

        <section aria-labelledby="gb-heading">
          <Stack gap={3}>
            <h2 id="gb-heading" style={headingStyle}>
              {t(m, "teach.gradebook.scores")}
            </h2>
            <div
              aria-label={t(m, "teach.gradebook.tableRegionLabel", {
                course: gradebook.title,
              })}
              className="gb-scroll"
              role="region"
              tabIndex={0}
            >
              <table className="gb-table">
                <caption style={visuallyHidden}>
                  {t(m, "teach.gradebook.caption", { course: gradebook.title })}
                </caption>
                <thead>
                  <tr>
                    <th className="gb-corner" scope="col">
                      {t(m, "teach.gradebook.colLearner")}
                    </th>
                    {gradebook.assignments.map((a) => (
                      <th key={a.id} scope="col">
                        {a.title}
                        <span className="gb-points">
                          {t(m, "teach.gradebook.points", { points: a.points })}
                        </span>
                      </th>
                    ))}
                    <th scope="col">{t(m, "teach.gradebook.colCourse")}</th>
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
                              <span className="gb-points">
                                {t(m, "teach.gradebook.pointsShort", {
                                  points: a.points,
                                })}
                              </span>
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
                      {t(m, "teach.gradebook.classAverageRow")}
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
              {t(m, "teach.gradebook.needsAttention")}
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
                          {ls.percent === null
                            ? t(m, "teach.gradebook.noGrades")
                            : `${ls.percent}%`}
                        </Chip>
                      </Inline>
                      {ls.missing > 0 ? (
                        <p style={mutedStyle}>
                          {t(
                            m,
                            ls.missing === 1
                              ? "teach.gradebook.missingOne"
                              : "teach.gradebook.missingOther",
                            {
                              count: ls.missing,
                              earned: ls.earned,
                              possible: ls.possible,
                            },
                          )}
                        </p>
                      ) : (
                        <p style={mutedStyle}>
                          {t(m, "teach.gradebook.allSubmitted", {
                            earned: ls.earned,
                            possible: ls.possible,
                          })}
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
