import { notFound, redirect } from "next/navigation";
import {
  Alert,
  AppShell,
  Badge,
  Breadcrumbs,
  Button,
  Card,
  Chip,
  EmptyState,
  Grid,
  PageHeader,
  Stack,
  StatCard,
} from "@lms/ui";

import { AssignmentsIcon } from "../../../lib/ui";
import { getBranding } from "../../../lib/branding";
import { getSession } from "../../../lib/auth";
import { canTeach, getTaughtCourse } from "../../../lib/teaching";
import { listAssignments, type Assignment } from "../../../lib/assignments-api";
import SignOutButton from "../../../sign-out-button";
import { deleteAssignmentAction } from "./actions";

const assignmentsCss = `
.asg-section-title {
  font-size: 16px;
  margin: 0;
}
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

const SUBMISSION_LABEL: Record<string, string> = {
  file: "File upload",
  text: "Text entry",
  url: "URL",
  none: "No submission",
};

function dueLabel(assignment: Assignment): string {
  if (!assignment.dueAt) return "No due date";
  const d = new Date(assignment.dueAt);
  return Number.isNaN(d.getTime())
    ? assignment.dueAt
    : `Due ${d.toLocaleDateString()}`;
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

  if (!canTeach(session.roles)) {
    return (
      <AppShell brand={brand} actions={<SignOutButton />}>
        <PageHeader
          title="Not authorized"
          subtitle="Your account cannot manage assignments."
        />
        <Alert tone="warning">
          You are signed in as <strong>{session.userId}</strong>, but your
          account does not hold a teaching role.
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
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{assignmentsCss}</style>
      <Stack gap={4}>
        <Breadcrumbs
          items={[
            { label: "Teaching", href: "/teach" },
            { label: course.title, collapsible: true },
            { label: "Assignments" },
          ]}
        />

        <PageHeader
          title={`${course.title} - assignments`}
          subtitle="Create, edit, and remove assignments. Changes are saved straight to the assignment service for this tenant."
          actions={
            <Button href={`/teach/${courseId}/assignments/new`} size="sm">
              New assignment
            </Button>
          }
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
        {!result.ok ? <Alert tone="warning">{result.error}</Alert> : null}

        <Grid gap={4} min="180px">
          <StatCard label="Assignments" value={assignments.length} />
          <StatCard label="Total points" value={totalPoints} />
        </Grid>

        {assignments.length ? (
          <section aria-labelledby="assignments-heading">
            <Stack gap={3}>
              <h2 className="asg-section-title" id="assignments-heading">
                Assignments
              </h2>
              <ul className="asg-list">
                {assignments.map((assignment) => (
                  <li key={assignment.id}>
                    <Card>
                      <div className="asg-row">
                        <Stack gap={1}>
                          <p className="asg-name">{assignment.title}</p>
                          <p className="asg-meta">
                            {dueLabel(assignment)} - {assignment.points} pts -{" "}
                            {SUBMISSION_LABEL[assignment.submissionType] ??
                              assignment.submissionType}
                          </p>
                        </Stack>
                        <Chip tone={assignment.allowLate ? "neutral" : "warning"}>
                          {assignment.allowLate ? "Late allowed" : "No late"}
                        </Chip>
                        <div className="asg-actions">
                          <Button
                            href={`/teach/${courseId}/assignments/${assignment.id}/edit`}
                            size="sm"
                            variant="secondary"
                          >
                            Edit
                          </Button>
                          <form action={deleteAssignmentAction}>
                            <input name="courseId" type="hidden" value={courseId} />
                            <input name="id" type="hidden" value={assignment.id} />
                            <Button size="sm" type="submit" variant="danger">
                              Delete
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
            description="Create your first assignment to start building coursework."
            icon={<AssignmentsIcon />}
            title="No assignments yet"
          />
        ) : (
          <Card>
            <Stack gap={2}>
              <Badge tone="warning">Service offline</Badge>
              <p className="asg-meta">
                Start the assignment service (ASSIGNMENT_STORE=memory pnpm dev in
                services/assignment) to manage assignments here.
              </p>
            </Stack>
          </Card>
        )}
      </Stack>
    </AppShell>
  );
}
