import { redirect } from "next/navigation";
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

import { getBranding } from "../lib/branding";
import { getSession, isAdmin } from "../lib/auth";
import { listCourses, type Course } from "../lib/courses-api";
import SignOutButton from "../sign-out-button";
import { deleteCourseAction, publishCourseAction } from "./actions";

const coursesCss = `
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
.cat-name {
  color: var(--lms-accent);
  font-weight: 600;
  margin: 0;
  overflow-wrap: anywhere;
}
.cat-meta {
  color: var(--lms-text-muted);
  margin: 0;
  overflow-wrap: anywhere;
}
.cat-list {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-3);
  list-style: none;
  margin: 0;
  padding: 0;
}
.cat-row {
  align-items: start;
  display: grid;
  gap: var(--lms-space-3);
  grid-template-columns: 1fr;
}
@media (min-width: 760px) {
  .cat-row {
    align-items: center;
    grid-template-columns: minmax(0, 2fr) auto auto;
  }
}
.cat-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2);
}
.cat-actions form {
  display: inline;
  margin: 0;
}
`;

function dateRange(course: Course): string | null {
  const fmt = (value: string | null): string | null => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
  };
  const start = fmt(course.startDate);
  const end = fmt(course.endDate);
  if (start && end) return `${start} - ${end}`;
  return start ?? end ?? null;
}

export default async function AdminCourses({
  searchParams,
}: {
  searchParams: { error?: string | string[] };
}) {
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

  const errorMessage = Array.isArray(searchParams.error)
    ? searchParams.error[0]
    : searchParams.error;

  const result = await listCourses(session.tenantId);
  const courses = result.ok ? result.courses : [];
  const published = courses.filter((c) => c.isPublished).length;

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{coursesCss}</style>
      <Stack gap={4}>
        <Button href="/" size="sm" variant="ghost">
          {"<- Back to console"}
        </Button>

        <PageHeader
          title="Course catalogue"
          subtitle="Create, edit, publish, and remove courses. Changes are saved straight to the course service for this tenant."
          actions={
            <Button href="/courses/new" size="sm">
              New course
            </Button>
          }
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
        {!result.ok ? <Alert tone="warning">{result.error}</Alert> : null}

        <Grid gap={4} min="180px">
          <Card>
            <Stack gap={1}>
              <p className="admin-stat">{courses.length}</p>
              <p className="admin-stat-label">Total courses</p>
            </Stack>
          </Card>
          <Card>
            <Stack gap={1}>
              <p className="admin-stat">{published}</p>
              <p className="admin-stat-label">Published</p>
            </Stack>
          </Card>
          <Card>
            <Stack gap={1}>
              <p className="admin-stat">{courses.length - published}</p>
              <p className="admin-stat-label">Drafts</p>
            </Stack>
          </Card>
        </Grid>

        {courses.length ? (
          <section aria-labelledby="catalogue-heading">
            <Stack gap={3}>
              <h2 className="admin-section-title" id="catalogue-heading">
                Courses
              </h2>
              <ul className="cat-list">
                {courses.map((course) => {
                  const range = dateRange(course);
                  return (
                    <li key={course.id}>
                      <Card>
                        <div className="cat-row">
                          <Stack gap={1}>
                            <p className="cat-name">{course.title}</p>
                            <p className="cat-meta">
                              {course.description ?? "No description"}
                              {range ? ` - ${range}` : ""}
                            </p>
                          </Stack>
                          <Chip
                            tone={course.isPublished ? "success" : "warning"}
                          >
                            {course.isPublished ? "Published" : "Draft"}
                          </Chip>
                          <div className="cat-actions">
                            <Button
                              href={`/courses/${course.id}/edit`}
                              size="sm"
                              variant="secondary"
                            >
                              Edit
                            </Button>
                            {!course.isPublished ? (
                              <form action={publishCourseAction}>
                                <input
                                  name="id"
                                  type="hidden"
                                  value={course.id}
                                />
                                <Button size="sm" type="submit">
                                  Publish
                                </Button>
                              </form>
                            ) : null}
                            <form action={deleteCourseAction}>
                              <input
                                name="id"
                                type="hidden"
                                value={course.id}
                              />
                              <Button size="sm" type="submit" variant="danger">
                                Delete
                              </Button>
                            </form>
                          </div>
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </Stack>
          </section>
        ) : result.ok ? (
          <EmptyState
            description="Create your first course to start building the catalogue."
            icon="[ ]"
            title="No courses yet"
          />
        ) : (
          <Card>
            <Stack gap={2}>
              <Badge tone="warning">Service offline</Badge>
              <p className="cat-meta">
                Start the course service (COURSE_STORE=memory pnpm dev in
                services/course) to manage courses here.
              </p>
            </Stack>
          </Card>
        )}
      </Stack>
    </AppShell>
  );
}
