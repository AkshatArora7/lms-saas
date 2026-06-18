import { notFound, redirect } from "next/navigation";
import {
  Alert,
  AppShell,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  Grid,
  PageHeader,
  Stack,
} from "@lms/ui";

import { getBranding } from "../../../lib/branding";
import { getSession } from "../../../lib/auth";
import { canTeach, getTaughtCourses } from "../../../lib/teaching";
import { getRoster } from "../../../lib/enrollment-api";
import SignOutButton from "../../../sign-out-button";
import {
  completeEnrollmentAction,
  dropEnrollmentAction,
} from "./actions";

const rosterCss = `
.ros-section-title {
  font-size: 16px;
  margin: 0;
}
.ros-stat {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.1;
  margin: 0;
}
.ros-stat-label {
  color: var(--lms-text-muted);
  margin: 0;
}
.ros-name {
  color: var(--lms-accent);
  font-weight: 600;
  margin: 0;
  overflow-wrap: anywhere;
}
.ros-meta {
  color: var(--lms-text-muted);
  margin: 0;
  overflow-wrap: anywhere;
}
.ros-list {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-3);
  list-style: none;
  margin: 0;
  padding: 0;
}
.ros-row {
  align-items: start;
  display: grid;
  gap: var(--lms-space-3);
  grid-template-columns: 1fr;
}
@media (min-width: 760px) {
  .ros-row {
    align-items: center;
    grid-template-columns: minmax(0, 2fr) auto auto;
  }
}
.ros-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2);
}
.ros-actions form {
  display: inline;
  margin: 0;
}
`;

const ROLE_LABEL: Record<string, string> = {
  learner: "Learner",
  teaching_assistant: "Teaching assistant",
  instructor: "Instructor",
  observer: "Observer",
  course_builder: "Course builder",
  org_admin: "Org admin",
};

function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role;
}

export default async function CourseRoster({
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
          subtitle="Your account cannot manage the roster."
        />
        <Alert tone="warning">
          You are signed in as <strong>{session.userId}</strong>, but your
          account does not hold a teaching role.
        </Alert>
      </AppShell>
    );
  }

  const { courseId } = params;
  const course = getTaughtCourses(session.tenantId).find(
    (c) => c.id === courseId,
  );
  if (!course) notFound();

  const errorMessage = Array.isArray(searchParams.error)
    ? searchParams.error[0]
    : searchParams.error;

  const result = await getRoster(courseId, session.tenantId);
  const roster = result.ok ? result.roster : [];
  const learners = roster.filter((e) => e.role === "learner").length;
  const staff = roster.length - learners;

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{rosterCss}</style>
      <Stack gap={4}>
        <Button href="/teach" size="sm" variant="ghost">
          ← Back to teaching
        </Button>

        <PageHeader
          title={`${course.title} - roster`}
          subtitle="Enroll learners, change roles, complete, and drop. Changes are saved straight to the enrollment service for this tenant."
          actions={
            <Button href={`/teach/${courseId}/roster/new`} size="sm">
              Enroll learner
            </Button>
          }
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
        {!result.ok ? <Alert tone="warning">{result.error}</Alert> : null}

        <Grid gap={4} min="180px">
          <Card>
            <Stack gap={1}>
              <p className="ros-stat">{roster.length}</p>
              <p className="ros-stat-label">Active members</p>
            </Stack>
          </Card>
          <Card>
            <Stack gap={1}>
              <p className="ros-stat">{learners}</p>
              <p className="ros-stat-label">Learners</p>
            </Stack>
          </Card>
          <Card>
            <Stack gap={1}>
              <p className="ros-stat">{staff}</p>
              <p className="ros-stat-label">Staff</p>
            </Stack>
          </Card>
        </Grid>

        {roster.length ? (
          <section aria-labelledby="roster-heading">
            <Stack gap={3}>
              <h2 className="ros-section-title" id="roster-heading">
                Members
              </h2>
              <ul className="ros-list">
                {roster.map((enrollment) => (
                  <li key={enrollment.id}>
                    <Card>
                      <div className="ros-row">
                        <Stack gap={1}>
                          <p className="ros-name">{enrollment.userId}</p>
                          <p className="ros-meta">
                            Enrolled{" "}
                            {new Date(
                              enrollment.enrolledAt,
                            ).toLocaleDateString()}
                          </p>
                        </Stack>
                        <Chip
                          tone={
                            enrollment.role === "learner" ? "neutral" : "accent"
                          }
                        >
                          {roleLabel(enrollment.role)}
                        </Chip>
                        <div className="ros-actions">
                          <Button
                            href={`/teach/${courseId}/roster/${enrollment.id}/edit`}
                            size="sm"
                            variant="secondary"
                          >
                            Change role
                          </Button>
                          <form action={completeEnrollmentAction}>
                            <input
                              name="courseId"
                              type="hidden"
                              value={courseId}
                            />
                            <input
                              name="id"
                              type="hidden"
                              value={enrollment.id}
                            />
                            <Button size="sm" type="submit">
                              Complete
                            </Button>
                          </form>
                          <form action={dropEnrollmentAction}>
                            <input
                              name="courseId"
                              type="hidden"
                              value={courseId}
                            />
                            <input
                              name="id"
                              type="hidden"
                              value={enrollment.id}
                            />
                            <Button size="sm" type="submit" variant="danger">
                              Drop
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
            description="Enroll your first learner to start building the roster."
            icon="[ ]"
            title="No one enrolled yet"
          />
        ) : (
          <Card>
            <Stack gap={2}>
              <Badge tone="warning">Service offline</Badge>
              <p className="ros-meta">
                Start the enrollment service (ENROLLMENT_STORE=memory pnpm dev in
                services/enrollment) to manage the roster here.
              </p>
            </Stack>
          </Card>
        )}
      </Stack>
    </AppShell>
  );
}
