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
import type { BadgeTone } from "@lms/ui";

import { getBranding } from "../../../lib/branding";
import { getSession } from "../../../lib/auth";
import { canTeach, getTaughtCourse } from "../../../lib/teaching";
import {
  listCourseAnnouncements,
  type Announcement,
  type AnnouncementStatus,
} from "../../../lib/announcements-api";
import SignOutButton from "../../../sign-out-button";
import {
  deleteAnnouncementAction,
  publishAnnouncementAction,
} from "./actions";

const announcementsCss = `
.ann-section-title {
  font-size: 16px;
  margin: 0;
}
.ann-stat {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.1;
  margin: 0;
}
.ann-stat-label {
  color: var(--lms-text-muted);
  margin: 0;
}
.ann-name {
  color: var(--lms-accent);
  font-weight: 600;
  margin: 0;
  overflow-wrap: anywhere;
}
.ann-meta {
  color: var(--lms-text-muted);
  margin: 0;
  overflow-wrap: anywhere;
}
.ann-list {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-3);
  list-style: none;
  margin: 0;
  padding: 0;
}
.ann-row {
  align-items: start;
  display: grid;
  gap: var(--lms-space-3);
  grid-template-columns: 1fr;
}
@media (min-width: 760px) {
  .ann-row {
    align-items: center;
    grid-template-columns: minmax(0, 2fr) auto auto;
  }
}
.ann-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2);
}
.ann-actions form {
  display: inline;
  margin: 0;
}
`;

const STATUS_TONE: Record<AnnouncementStatus, BadgeTone> = {
  scheduled: "warning",
  published: "success",
  expired: "neutral",
};

const STATUS_LABEL: Record<AnnouncementStatus, string> = {
  scheduled: "Scheduled",
  published: "Published",
  expired: "Expired",
};

function whenLabel(announcement: Announcement): string {
  const fmt = (value: string): string => {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
  };
  if (announcement.status === "scheduled") {
    return `Publishes ${fmt(announcement.publishAt)}`;
  }
  if (announcement.status === "expired" && announcement.expiresAt) {
    return `Expired ${fmt(announcement.expiresAt)}`;
  }
  return `Published ${fmt(announcement.publishAt)}`;
}

export default async function CourseAnnouncements({
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
          subtitle="Your account cannot manage announcements."
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

  const result = await listCourseAnnouncements(course.orgUnitId, session.tenantId);
  const announcements = result.ok ? result.announcements : [];
  const published = announcements.filter((a) => a.status === "published").length;
  const scheduled = announcements.filter((a) => a.status === "scheduled").length;

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{announcementsCss}</style>
      <Stack gap={4}>
        <Button href="/teach" size="sm" variant="ghost">
          ← Back to teaching
        </Button>

        <PageHeader
          title={`${course.title} - announcements`}
          subtitle="Compose, schedule, publish, and remove announcements. Changes are saved straight to the announcement service for this tenant."
          actions={
            <Button href={`/teach/${courseId}/announcements/new`} size="sm">
              New announcement
            </Button>
          }
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
        {!result.ok ? <Alert tone="warning">{result.error}</Alert> : null}

        <Grid gap={4} min="180px">
          <Card>
            <Stack gap={1}>
              <p className="ann-stat">{announcements.length}</p>
              <p className="ann-stat-label">Total</p>
            </Stack>
          </Card>
          <Card>
            <Stack gap={1}>
              <p className="ann-stat">{published}</p>
              <p className="ann-stat-label">Published</p>
            </Stack>
          </Card>
          <Card>
            <Stack gap={1}>
              <p className="ann-stat">{scheduled}</p>
              <p className="ann-stat-label">Scheduled</p>
            </Stack>
          </Card>
        </Grid>

        {announcements.length ? (
          <section aria-labelledby="announcements-heading">
            <Stack gap={3}>
              <h2 className="ann-section-title" id="announcements-heading">
                Announcements
              </h2>
              <ul className="ann-list">
                {announcements.map((announcement) => (
                  <li key={announcement.id}>
                    <Card>
                      <div className="ann-row">
                        <Stack gap={1}>
                          <p className="ann-name">{announcement.title}</p>
                          <p className="ann-meta">{whenLabel(announcement)}</p>
                        </Stack>
                        <Chip tone={STATUS_TONE[announcement.status]}>
                          {STATUS_LABEL[announcement.status]}
                        </Chip>
                        <div className="ann-actions">
                          <Button
                            href={`/teach/${courseId}/announcements/${announcement.id}/edit`}
                            size="sm"
                            variant="secondary"
                          >
                            Edit
                          </Button>
                          {announcement.status !== "published" ? (
                            <form action={publishAnnouncementAction}>
                              <input
                                name="courseId"
                                type="hidden"
                                value={courseId}
                              />
                              <input
                                name="id"
                                type="hidden"
                                value={announcement.id}
                              />
                              <Button size="sm" type="submit">
                                Publish now
                              </Button>
                            </form>
                          ) : null}
                          <form action={deleteAnnouncementAction}>
                            <input
                              name="courseId"
                              type="hidden"
                              value={courseId}
                            />
                            <input
                              name="id"
                              type="hidden"
                              value={announcement.id}
                            />
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
            description="Compose your first announcement to keep learners informed."
            icon="[ ]"
            title="No announcements yet"
          />
        ) : (
          <Card>
            <Stack gap={2}>
              <Badge tone="warning">Service offline</Badge>
              <p className="ann-meta">
                Start the announcement service (ANNOUNCEMENT_STORE=memory pnpm
                dev in services/announcement) to manage announcements here.
              </p>
            </Stack>
          </Card>
        )}
      </Stack>
    </AppShell>
  );
}
