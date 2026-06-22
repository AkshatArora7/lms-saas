import { notFound, redirect } from "next/navigation";
import {
  Alert,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  Grid,
  PageHeader,
  Stack,
} from "@lms/ui";
import { getMessages, t, type MessageKey, type Messages } from "@lms/i18n";

import { getBranding } from "../../../lib/branding";
import { getSession } from "../../../lib/auth";
import { resolveRequestLocale } from "../../../lib/i18n";
import { AppLocaleSwitcher } from "../../../lib/locale-switcher";
import { AppShell, AssignmentsIcon, teachPolishCss } from "../../../lib/ui";
import { canTeach, getTaughtCourse } from "../../../lib/teaching";
import { listAssignments, type Assignment } from "../../../lib/assignments-api";
import SignOutButton from "../../../sign-out-button";
import { deleteAssignmentAction } from "./actions";

const assignmentsCss = `
.asg-name {
  color: var(--lms-accent);
  font-weight: 600;
  margin: 0;
  overflow-wrap: anywhere;
}
.asg-meta {
  color: var(--lms-text-muted);
  margin: 0;
  overflow-wrap: anywhere;
}
.asg-list {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-3);
  list-style: none;
  margin: 0;
  padding: 0;
}
.asg-row {
  align-items: start;
  display: grid;
  gap: var(--lms-space-3);
  grid-template-columns: 1fr;
}
@media (min-width: 760px) {
  .asg-row {
    align-items: center;
    grid-template-columns: minmax(0, 2fr) auto auto;
  }
}
.asg-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2);
}
.asg-actions form {
  display: inline;
  margin: 0;
}
`;

const SUBMISSION_LABEL_KEY: Record<string, MessageKey> = {
  file: "teach.assignments.submissionFile",
  text: "teach.assignments.submissionText",
  url: "teach.assignments.submissionUrl",
  none: "teach.assignments.submissionNone",
};

function submissionLabel(m: Messages, type: string): string {
  const key = SUBMISSION_LABEL_KEY[type];
  return key ? t(m, key) : type;
}

function dueLabel(m: Messages, assignment: Assignment): string {
  if (!assignment.dueAt) return t(m, "teach.assignments.noDueDate");
  const d = new Date(assignment.dueAt);
  return Number.isNaN(d.getTime())
    ? assignment.dueAt
    : t(m, "teach.assignments.due", { date: d.toLocaleDateString() });
}

export default async function CourseAssignments({
  params,
  searchParams,
}: {
  params: { courseId: string };
  searchParams: { error?: string | string[] };
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

  const { courseId } = params;
  const course = await getTaughtCourse(session.userId, courseId, session.tenantId);
  if (!course) notFound();

  const errorMessage = Array.isArray(searchParams.error)
    ? searchParams.error[0]
    : searchParams.error;

  const result = await listAssignments(courseId, session.tenantId);
  const assignments = result.ok ? result.assignments : [];
  const totalPoints = assignments.reduce((sum, a) => sum + a.points, 0);

  return (
    <AppShell actions={shellActions} brand={brand}>
      <style>{teachPolishCss}</style>
      <style>{assignmentsCss}</style>
      <Stack gap={4}>
        <Button href="/teach" size="sm" variant="ghost">
          {t(m, "teach.assignments.backToTeaching")}
        </Button>

        <PageHeader
          title={t(m, "teach.assignments.title", { course: course.title })}
          subtitle={t(m, "teach.assignments.subtitle")}
          actions={
            <Button href={`/teach/${courseId}/assignments/new`} size="sm">
              {t(m, "teach.assignments.new")}
            </Button>
          }
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
        {!result.ok ? <Alert tone="warning">{result.error}</Alert> : null}

        <Grid gap={4} min="180px">
          <Card>
            <div className="tch-stat-card">
              <p className="tch-stat">{assignments.length}</p>
              <p className="tch-stat-label">
                {t(m, "teach.assignments.statCount")}
              </p>
            </div>
          </Card>
          <Card>
            <div className="tch-stat-card">
              <p className="tch-stat">{totalPoints}</p>
              <p className="tch-stat-label">
                {t(m, "teach.assignments.statPoints")}
              </p>
            </div>
          </Card>
        </Grid>

        {assignments.length ? (
          <section aria-labelledby="assignments-heading">
            <Stack gap={3}>
              <h2 className="tch-section-heading" id="assignments-heading">
                {t(m, "teach.assignments.heading")}
              </h2>
              <ul aria-label={t(m, "teach.assignments.listLabel")} className="asg-list">
                {assignments.map((assignment) => (
                  <li key={assignment.id}>
                    <Card>
                      <div className="asg-row">
                        <Stack gap={1}>
                          <p className="asg-name">{assignment.title}</p>
                          <p className="asg-meta">
                            {t(m, "teach.assignments.meta", {
                              due: dueLabel(m, assignment),
                              points: assignment.points,
                              submission: submissionLabel(
                                m,
                                assignment.submissionType,
                              ),
                            })}
                          </p>
                        </Stack>
                        <Chip
                          tone={assignment.allowLate ? "neutral" : "warning"}
                        >
                          {assignment.allowLate
                            ? t(m, "teach.assignments.lateAllowed")
                            : t(m, "teach.assignments.noLate")}
                        </Chip>
                        <div className="asg-actions">
                          <Button
                            href={`/teach/${courseId}/assignments/${assignment.id}/edit`}
                            size="sm"
                            variant="secondary"
                          >
                            {t(m, "teach.assignments.edit")}
                          </Button>
                          <form action={deleteAssignmentAction}>
                            <input
                              name="courseId"
                              type="hidden"
                              value={courseId}
                            />
                            <input
                              name="id"
                              type="hidden"
                              value={assignment.id}
                            />
                            <Button size="sm" type="submit" variant="danger">
                              {t(m, "teach.assignments.delete")}
                            </Button>
                          </form>
                        </div>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            </Stack>
          </section>
        ) : result.ok ? (
          <EmptyState
            description={t(m, "teach.assignments.emptyBody")}
            icon={<AssignmentsIcon />}
            title={t(m, "teach.assignments.emptyTitle")}
          />
        ) : (
          <Card>
            <Stack gap={2}>
              <Badge tone="warning">{t(m, "roster.serviceOffline")}</Badge>
              <p className="asg-meta">{t(m, "teach.assignments.offlineBody")}</p>
            </Stack>
          </Card>
        )}
      </Stack>
    </AppShell>
  );
}
