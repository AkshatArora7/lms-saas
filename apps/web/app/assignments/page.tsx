import { redirect } from "next/navigation";
import {
  AppShell,
  Badge,
  Button,
  Card,
  EmptyState,
  Grid,
  Inline,
  PageHeader,
  Stack,
  type BadgeTone,
} from "@lms/ui";

import { getBranding } from "../lib/branding";
import { getSession } from "../lib/auth";
import {
  formatDue,
  getAssignments,
  summarizeAssignments,
  type AssignmentStatus,
} from "../lib/assignments";
import SignOutButton from "../sign-out-button";

const assignmentsCss = `
.asg-stat {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.1;
  margin: 0;
}
.asg-stat-label {
  color: var(--lms-text-muted);
  margin: 0;
}
.asg-list {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-3);
  list-style: none;
  margin: 0;
  padding: 0;
}
.asg-title {
  font-weight: 600;
  margin: 0;
  overflow-wrap: anywhere;
}
.asg-meta {
  color: var(--lms-text-muted);
  margin: 0;
  overflow-wrap: anywhere;
}
.asg-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2) var(--lms-space-3);
  align-items: center;
  justify-content: space-between;
}
.asg-due {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
`;

const STATUS_LABEL: Record<AssignmentStatus, string> = {
  overdue: "Overdue",
  not_started: "Not started",
  submitted: "Submitted",
  graded: "Graded",
};

const STATUS_TONE: Record<AssignmentStatus, BadgeTone> = {
  overdue: "danger",
  not_started: "warning",
  submitted: "accent",
  graded: "success",
};

export default async function AssignmentsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);

  const assignments = getAssignments(session.tenantId);
  const summary = summarizeAssignments(assignments);

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{assignmentsCss}</style>
      <Stack gap={4}>
        <Button href="/" size="sm" variant="ghost">
          ← Back to dashboard
        </Button>

        <PageHeader
          title="Assignments"
          subtitle="Everything due across your courses — overdue and upcoming work first."
          actions={
            <Button href="/grades" variant="secondary">
              View grades
            </Button>
          }
        />

        {assignments.length ? (
          <>
            <Grid gap={4} min="180px">
              <Card>
                <Stack gap={1}>
                  <p className="asg-stat">{summary.overdue}</p>
                  <p className="asg-stat-label">Overdue</p>
                </Stack>
              </Card>
              <Card>
                <Stack gap={1}>
                  <p className="asg-stat">{summary.dueSoon}</p>
                  <p className="asg-stat-label">Due soon</p>
                </Stack>
              </Card>
              <Card>
                <Stack gap={1}>
                  <p className="asg-stat">{summary.submitted}</p>
                  <p className="asg-stat-label">Submitted</p>
                </Stack>
              </Card>
            </Grid>

            <ul className="asg-list">
              {assignments.map((assignment) => (
                <li key={assignment.id}>
                  <Card>
                    <Stack gap={2}>
                      <div className="asg-row">
                        <p className="asg-title">{assignment.title}</p>
                        <Badge tone={STATUS_TONE[assignment.status]}>
                          {STATUS_LABEL[assignment.status]}
                        </Badge>
                      </div>
                      <p className="asg-meta">
                        {assignment.course} ({assignment.code}) ·{" "}
                        {assignment.type} · {assignment.points} pts
                        {assignment.status === "graded" &&
                        assignment.score !== undefined
                          ? ` · scored ${assignment.score}/${assignment.points}`
                          : ""}
                      </p>
                      <Inline gap={2} justify="space-between">
                        <span className="asg-meta asg-due">
                          Due {formatDue(assignment.dueAt)}
                        </span>
                        <Button
                          href={`/courses/${assignment.courseId}`}
                          size="sm"
                          variant="ghost"
                        >
                          Open course
                        </Button>
                      </Inline>
                    </Stack>
                  </Card>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <EmptyState
            description="When your courses post assignments, quizzes and projects, they'll appear here."
            icon="📝"
            title="No assignments yet"
          />
        )}
      </Stack>
    </AppShell>
  );
}
