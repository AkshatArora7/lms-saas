import { redirect } from "next/navigation";
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

import { getBranding } from "../lib/branding";
import { getSession, isAdmin } from "../lib/auth";
import { listCourses, type Course } from "../lib/courses-api";
import { AppShell, CoursesIcon } from "../lib/ui";
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
.cat-meta {
  color: var(--lms-text-muted);
  margin: 0;
  overflow-wrap: anywhere;
}
/* Data-dense course catalogue table. The wrapper scrolls horizontally on small
   screens within a labelled region so columns are never silently clipped. */
.admin-course-name {
  color: var(--lms-accent);
  font-weight: 600;
  margin: 0;
  overflow-wrap: anywhere;
}
.admin-course-meta {
  color: var(--lms-text-muted);
  font-size: var(--lms-font-size-sm);
  margin: 0;
  overflow-wrap: anywhere;
}
.admin-courses-table td:first-child,
.admin-courses-table th:first-child {
  min-width: 220px;
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
              <div
                aria-label="Course catalogue"
                className="lms-table-wrap"
                role="region"
                tabIndex={0}
              >
                <table className="lms-table admin-courses-table">
                  <thead>
                    <tr>
                      <th scope="col">Course</th>
                      <th scope="col">Status</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {courses.map((course) => {
                      const range = dateRange(course);
                      return (
                        <tr key={course.id}>
                          <td>
                            <p className="admin-course-name">{course.title}</p>
                            <p className="admin-course-meta">
                              {course.description ?? "No description"}
                              {range ? ` - ${range}` : ""}
                            </p>
                          </td>
                          <td>
                            <Chip
                              tone={course.isPublished ? "success" : "warning"}
                            >
                              {course.isPublished ? "Published" : "Draft"}
                            </Chip>
                          </td>
                          <td>
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
                                <Button
                                  size="sm"
                                  type="submit"
                                  variant="danger"
                                >
                                  Delete
                                </Button>
                              </form>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Stack>
          </section>
        ) : result.ok ? (
          <EmptyState
            description="Create your first course to start building the catalogue."
            icon={<CoursesIcon />}
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
