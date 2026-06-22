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
import { AppShell, CoursesIcon, teachPolishCss } from "../../../lib/ui";
import { canTeach, getTaughtCourse } from "../../../lib/teaching";
import { getRoster } from "../../../lib/enrollment-api";
import SignOutButton from "../../../sign-out-button";
import {
  completeEnrollmentAction,
  dropEnrollmentAction,
} from "./actions";

const rosterCss = `
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
.ros-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85em;
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

const ROLE_LABEL_KEY: Record<string, MessageKey> = {
  learner: "roster.roleLearner",
  teaching_assistant: "roster.roleTeachingAssistant",
  instructor: "roster.roleInstructor",
  observer: "roster.roleObserver",
  course_builder: "roster.roleCourseBuilder",
  org_admin: "roster.roleOrgAdmin",
};

function roleLabel(m: Messages, role: string): string {
  const key = ROLE_LABEL_KEY[role];
  return key ? t(m, key) : role;
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
  const m = getMessages(await resolveRequestLocale());

  if (!canTeach(session.roles)) {
    return (
      <AppShell
        brand={brand}
        actions={
          <>
            <AppLocaleSwitcher />
            <SignOutButton />
          </>
        }
      >
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

  const result = await getRoster(course.orgUnitId, session.tenantId);
  const roster = result.ok ? result.roster : [];
  const learners = roster.filter((e) => e.role === "learner").length;
  const staff = roster.length - learners;

  return (
    <AppShell
      brand={brand}
      actions={
        <>
          <AppLocaleSwitcher />
          <SignOutButton />
        </>
      }
    >
      <style>{teachPolishCss}</style>
      <style>{rosterCss}</style>
      <Stack gap={4}>
        <Button href="/teach" size="sm" variant="ghost">
          {t(m, "roster.backToTeaching")}
        </Button>

        <PageHeader
          title={t(m, "roster.title", { course: course.title })}
          subtitle={t(m, "roster.subtitle")}
          actions={
            <Button href={`/teach/${courseId}/roster/new`} size="sm">
              {t(m, "roster.enrollLearner")}
            </Button>
          }
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
        {!result.ok ? <Alert tone="warning">{result.error}</Alert> : null}

        <Grid gap={4} min="180px">
          <Card>
            <div className="tch-stat-card">
              <p className="tch-stat">{roster.length}</p>
              <p className="tch-stat-label">{t(m, "roster.activeMembers")}</p>
            </div>
          </Card>
          <Card>
            <div className="tch-stat-card">
              <p className="tch-stat">{learners}</p>
              <p className="tch-stat-label">{t(m, "roster.learners")}</p>
            </div>
          </Card>
          <Card>
            <div className="tch-stat-card">
              <p className="tch-stat">{staff}</p>
              <p className="tch-stat-label">{t(m, "roster.staff")}</p>
            </div>
          </Card>
        </Grid>

        {roster.length ? (
          <section aria-labelledby="roster-heading">
            <Stack gap={3}>
              <h2 className="tch-section-heading" id="roster-heading">
                {t(m, "roster.members")}
              </h2>
              <ul className="ros-list">
                {roster.map((enrollment) => (
                  <li key={enrollment.id}>
                    <Card>
                      <div className="ros-row">
                        <Stack gap={1}>
                          <p className="ros-name">
                            {enrollment.displayName ?? enrollment.userId}
                          </p>
                          <p className="ros-meta">
                            {enrollment.email ? `${enrollment.email} · ` : ""}
                            <span className="ros-id">{enrollment.userId}</span>
                          </p>
                          <p className="ros-meta">
                            {t(m, "roster.enrolledOn", {
                              date: new Date(
                                enrollment.enrolledAt,
                              ).toLocaleDateString(),
                            })}
                          </p>
                        </Stack>
                        <Chip
                          tone={
                            enrollment.role === "learner" ? "neutral" : "accent"
                          }
                        >
                          {roleLabel(m, enrollment.role)}
                        </Chip>
                        <div className="ros-actions">
                          <Button
                            href={`/teach/${courseId}/roster/${enrollment.id}/edit`}
                            size="sm"
                            variant="secondary"
                          >
                            {t(m, "roster.changeRole")}
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
                              {t(m, "roster.complete")}
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
                              {t(m, "roster.drop")}
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
            description={t(m, "roster.emptyBody")}
            icon={<CoursesIcon />}
            title={t(m, "roster.emptyTitle")}
          />
        ) : (
          <Card>
            <Stack gap={2}>
              <Badge tone="warning">{t(m, "roster.serviceOffline")}</Badge>
              <p className="ros-meta">{t(m, "roster.offlineBody")}</p>
            </Stack>
          </Card>
        )}
      </Stack>
    </AppShell>
  );
}
