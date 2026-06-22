import { redirect } from "next/navigation";
import {
  Alert,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  Grid,
  Inline,
  PageHeader,
  Stack,
} from "@lms/ui";
import { getMessages, t } from "@lms/i18n";

import { getBranding } from "../lib/branding";
import { getSession, isAdmin } from "../lib/auth";
import { listCourses, type Course } from "../lib/courses-api";
import { resolveRequestLocale } from "../lib/i18n";
import { AppLocaleSwitcher } from "../lib/locale-switcher";
import { adminPolishCss, AppShell, CoursesIcon } from "../lib/ui";
import SignOutButton from "../sign-out-button";
import { deleteCourseAction, publishCourseAction } from "./actions";

const coursesCss = `${adminPolishCss}
.admin-courses-table td:first-child,
.admin-courses-table th:first-child {
  min-width: 220px;
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
  const m = getMessages(await resolveRequestLocale());

  const actions = (
    <>
      <AppLocaleSwitcher />
      <SignOutButton />
    </>
  );

  if (!isAdmin(session)) {
    return (
      <AppShell brand={brand} actions={actions}>
        <PageHeader
          title={t(m, "admin.notAuthorizedTitle")}
          subtitle={t(m, "admin.notAuthorizedSubtitle")}
        />
        <Alert tone="warning">
          You are signed in as <strong>{session.userId}</strong>.{" "}
          {t(m, "admin.notAuthorizedBody")}
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
    <AppShell brand={brand} actions={actions}>
      <style>{coursesCss}</style>
      <Stack gap={5}>
        <Button href="/" size="sm" variant="ghost">
          {t(m, "admin.backToConsole")}
        </Button>

        <PageHeader
          title={t(m, "admin.courses.title")}
          subtitle={t(m, "admin.courses.subtitle")}
          actions={
            <Button href="/courses/new" size="sm">
              {t(m, "admin.courses.newCourse")}
            </Button>
          }
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
        {!result.ok ? <Alert tone="warning">{result.error}</Alert> : null}

        <Grid gap={4} min="180px">
          <Card>
            <Inline align="flex-start" gap={3}>
              <span aria-hidden="true" className="admin-stat-card__icon">
                <CoursesIcon />
              </span>
              <Stack gap={1}>
                <p className="admin-stat-value">{courses.length}</p>
                <p className="admin-stat-label">
                  {t(m, "admin.courses.statTotal")}
                </p>
              </Stack>
            </Inline>
          </Card>
          <Card>
            <Inline align="flex-start" gap={3}>
              <span aria-hidden="true" className="admin-stat-card__icon">
                <CoursesIcon />
              </span>
              <Stack gap={1}>
                <p className="admin-stat-value">{published}</p>
                <p className="admin-stat-label">
                  {t(m, "admin.courses.statPublished")}
                </p>
              </Stack>
            </Inline>
          </Card>
          <Card>
            <Inline align="flex-start" gap={3}>
              <span aria-hidden="true" className="admin-stat-card__icon">
                <CoursesIcon />
              </span>
              <Stack gap={1}>
                <p className="admin-stat-value">{courses.length - published}</p>
                <p className="admin-stat-label">
                  {t(m, "admin.courses.statDrafts")}
                </p>
              </Stack>
            </Inline>
          </Card>
        </Grid>

        {courses.length ? (
          <section aria-labelledby="catalogue-heading">
            <Stack gap={3}>
              <h2 className="admin-section-title" id="catalogue-heading">
                {t(m, "admin.courses.heading")}
              </h2>
              <div
                aria-label={t(m, "admin.courses.tableLabel")}
                className="lms-table-wrap"
                role="region"
                tabIndex={0}
              >
                <table className="lms-table admin-courses-table">
                  <thead>
                    <tr>
                      <th scope="col">{t(m, "admin.courses.colCourse")}</th>
                      <th scope="col">{t(m, "admin.courses.colStatus")}</th>
                      <th scope="col">{t(m, "admin.courses.colActions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {courses.map((course) => {
                      const range = dateRange(course);
                      return (
                        <tr key={course.id}>
                          <td>
                            <p className="admin-link-name">{course.title}</p>
                            <p className="admin-cell-meta">
                              {course.description ??
                                t(m, "admin.courses.noDescription")}
                              {range ? ` - ${range}` : ""}
                            </p>
                          </td>
                          <td>
                            <Chip
                              tone={course.isPublished ? "success" : "warning"}
                            >
                              {course.isPublished
                                ? t(m, "admin.courses.statusPublished")
                                : t(m, "admin.courses.statusDraft")}
                            </Chip>
                          </td>
                          <td>
                            <div className="admin-row-actions">
                              <Button
                                href={`/courses/${course.id}/edit`}
                                size="sm"
                                variant="secondary"
                              >
                                {t(m, "admin.courses.edit")}
                              </Button>
                              {!course.isPublished ? (
                                <form action={publishCourseAction}>
                                  <input
                                    name="id"
                                    type="hidden"
                                    value={course.id}
                                  />
                                  <Button size="sm" type="submit">
                                    {t(m, "admin.courses.publish")}
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
                                  {t(m, "admin.courses.delete")}
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
            actions={
              <Button href="/courses/new" variant="primary">
                {t(m, "admin.courses.newCourse")}
              </Button>
            }
            description={t(m, "admin.courses.emptyBody")}
            icon={<CoursesIcon />}
            title={t(m, "admin.courses.emptyTitle")}
          />
        ) : (
          <Card>
            <Stack gap={2}>
              <Badge tone="warning">{t(m, "admin.serviceOffline")}</Badge>
              <p className="admin-cell-meta">
                {t(m, "admin.courses.offlineBody")}
              </p>
            </Stack>
          </Card>
        )}
      </Stack>
    </AppShell>
  );
}
