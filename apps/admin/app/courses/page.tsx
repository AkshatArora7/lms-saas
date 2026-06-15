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
  Inline,
  PageHeader,
  Stack,
} from "@lms/ui";
import type { BadgeTone } from "@lms/ui";

import { getBranding } from "../lib/branding";
import { getSession, isAdmin } from "../lib/auth";
import {
  filterCatalogue,
  getCatalogue,
  isCourseStatus,
  summarizeCatalogue,
  type CourseStatus,
} from "../lib/catalog";
import SignOutButton from "../sign-out-button";

const catalogueCss = `
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
@media (min-width: 720px) {
  .cat-row {
    align-items: center;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1.2fr) auto auto;
  }
}
.cat-filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2);
}
`;

const STATUS_META: Record<CourseStatus, { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "success" },
  draft: { label: "Draft", tone: "warning" },
  archived: { label: "Archived", tone: "neutral" },
};

const FILTERS: { key: string; label: string; status?: CourseStatus }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active", status: "active" },
  { key: "draft", label: "Draft", status: "draft" },
  { key: "archived", label: "Archived", status: "archived" },
];

export default async function AdminCourses({
  searchParams,
}: {
  searchParams: { status?: string | string[] };
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

  const rawStatus = Array.isArray(searchParams.status)
    ? searchParams.status[0]
    : searchParams.status;
  const activeFilter: CourseStatus | undefined =
    rawStatus && isCourseStatus(rawStatus) ? rawStatus : undefined;

  const courses = getCatalogue(session.tenantId);
  const summary = summarizeCatalogue(courses);
  const visible = filterCatalogue(courses, activeFilter);

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{catalogueCss}</style>
      <Stack gap={4}>
        <Button href="/" size="sm" variant="ghost">
          ← Back to console
        </Button>

        <PageHeader
          title="Course catalogue"
          subtitle="Every course in this tenant, with its term, instructor, enrolment, and lifecycle status."
        />

        <Grid gap={4} min="180px">
          <Card>
            <Stack gap={1}>
              <p className="admin-stat">{summary.total}</p>
              <p className="admin-stat-label">Total courses</p>
            </Stack>
          </Card>
          <Card>
            <Stack gap={1}>
              <p className="admin-stat">{summary.active}</p>
              <p className="admin-stat-label">Active</p>
            </Stack>
          </Card>
          <Card>
            <Stack gap={1}>
              <p className="admin-stat">{summary.totalEnrolled}</p>
              <p className="admin-stat-label">Total enrolment</p>
            </Stack>
          </Card>
        </Grid>

        {courses.length ? (
          <section aria-labelledby="catalogue-heading">
            <Stack gap={3}>
              <Inline align="center" gap={3} justify="space-between">
                <h2 className="admin-section-title" id="catalogue-heading">
                  Courses
                </h2>
                <nav aria-label="Filter by status" className="cat-filters">
                  {FILTERS.map((filter) => {
                    const isActive =
                      (filter.status ?? undefined) === activeFilter;
                    const href = filter.status
                      ? `/courses?status=${filter.status}`
                      : "/courses";
                    return (
                      <Button
                        key={filter.key}
                        href={href}
                        size="sm"
                        variant={isActive ? "primary" : "secondary"}
                      >
                        {filter.label}
                      </Button>
                    );
                  })}
                </nav>
              </Inline>

              {visible.length ? (
                <ul className="cat-list">
                  {visible.map((course) => {
                    const status = STATUS_META[course.status];
                    return (
                      <li key={course.id}>
                        <Card>
                          <div className="cat-row">
                            <Stack gap={1}>
                              <p className="cat-name">{course.title}</p>
                              <p className="cat-meta">
                                {course.code} · {course.instructor}
                              </p>
                            </Stack>
                            <Badge tone="neutral">{course.term}</Badge>
                            <Badge tone="neutral">
                              {course.enrolled} enrolled
                            </Badge>
                            <Chip tone={status.tone}>{status.label}</Chip>
                          </div>
                        </Card>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <EmptyState
                  description="No courses match this status filter. Try a different status."
                  icon="🔎"
                  title="Nothing here"
                />
              )}
            </Stack>
          </section>
        ) : (
          <EmptyState
            description="Create courses or connect your SIS to populate the catalogue."
            icon="📚"
            title="No courses yet"
          />
        )}
      </Stack>
    </AppShell>
  );
}
