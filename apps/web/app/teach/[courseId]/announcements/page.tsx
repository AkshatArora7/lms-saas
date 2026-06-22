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
import type { BadgeTone } from "@lms/ui";
import { getMessages, t, type MessageKey, type Messages } from "@lms/i18n";

import { getBranding } from "../../../lib/branding";
import { getSession } from "../../../lib/auth";
import { resolveRequestLocale } from "../../../lib/i18n";
import { AppLocaleSwitcher } from "../../../lib/locale-switcher";
import { AppShell, AnnouncementsIcon, teachPolishCss } from "../../../lib/ui";
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

const STATUS_LABEL_KEY: Record<AnnouncementStatus, MessageKey> = {
  scheduled: "teach.announcements.statusScheduled",
  published: "teach.announcements.statusPublished",
  expired: "teach.announcements.statusExpired",
};

function whenLabel(m: Messages, announcement: Announcement): string {
  const fmt = (value: string): string => {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
  };
  if (announcement.status === "scheduled") {
    return t(m, "teach.announcements.publishes", {
      when: fmt(announcement.publishAt),
    });
  }
  if (announcement.status === "expired" && announcement.expiresAt) {
    return t(m, "teach.announcements.expired", {
      when: fmt(announcement.expiresAt),
    });
  }
  return t(m, "teach.announcements.published", {
    when: fmt(announcement.publishAt),
  });
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

  const result = await listCourseAnnouncements(course.orgUnitId, session.tenantId);
  const announcements = result.ok ? result.announcements : [];
  const published = announcements.filter((a) => a.status === "published").length;
  const scheduled = announcements.filter((a) => a.status === "scheduled").length;

  return (
    <AppShell actions={shellActions} brand={brand}>
      <style>{teachPolishCss}</style>
      <style>{announcementsCss}</style>
      <Stack gap={4}>
        <Button href="/teach" size="sm" variant="ghost">
          {t(m, "teach.announcements.backToTeaching")}
        </Button>

        <PageHeader
          title={t(m, "teach.announcements.title", { course: course.title })}
          subtitle={t(m, "teach.announcements.subtitle")}
          actions={
            <Button href={`/teach/${courseId}/announcements/new`} size="sm">
              {t(m, "teach.announcements.new")}
            </Button>
          }
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
        {!result.ok ? <Alert tone="warning">{result.error}</Alert> : null}

        <Grid gap={4} min="180px">
          <Card>
            <div className="tch-stat-card">
              <p className="tch-stat">{announcements.length}</p>
              <p className="tch-stat-label">
                {t(m, "teach.announcements.statTotal")}
              </p>
            </div>
          </Card>
          <Card>
            <div className="tch-stat-card">
              <p className="tch-stat">{published}</p>
              <p className="tch-stat-label">
                {t(m, "teach.announcements.statPublished")}
              </p>
            </div>
          </Card>
          <Card>
            <div className="tch-stat-card">
              <p className="tch-stat">{scheduled}</p>
              <p className="tch-stat-label">
                {t(m, "teach.announcements.statScheduled")}
              </p>
            </div>
          </Card>
        </Grid>

        {announcements.length ? (
          <section aria-labelledby="announcements-heading">
            <Stack gap={3}>
              <h2 className="tch-section-heading" id="announcements-heading">
                {t(m, "teach.announcements.heading")}
              </h2>
              <ul
                aria-label={t(m, "teach.announcements.listLabel")}
                className="ann-list"
              >
                {announcements.map((announcement) => (
                  <li key={announcement.id}>
                    <Card>
                      <div className="ann-row">
                        <Stack gap={1}>
                          <p className="ann-name">{announcement.title}</p>
                          <p className="ann-meta">
                            {whenLabel(m, announcement)}
                          </p>
                        </Stack>
                        <Chip tone={STATUS_TONE[announcement.status]}>
                          {t(m, STATUS_LABEL_KEY[announcement.status])}
                        </Chip>
                        <div className="ann-actions">
                          <Button
                            href={`/teach/${courseId}/announcements/${announcement.id}/edit`}
                            size="sm"
                            variant="secondary"
                          >
                            {t(m, "teach.announcements.edit")}
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
                                {t(m, "teach.announcements.publishNow")}
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
                              {t(m, "teach.announcements.delete")}
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
            description={t(m, "teach.announcements.emptyBody")}
            icon={<AnnouncementsIcon />}
            title={t(m, "teach.announcements.emptyTitle")}
          />
        ) : (
          <Card>
            <Stack gap={2}>
              <Badge tone="warning">{t(m, "roster.serviceOffline")}</Badge>
              <p className="ann-meta">
                {t(m, "teach.announcements.offlineBody")}
              </p>
            </Stack>
          </Card>
        )}
      </Stack>
    </AppShell>
  );
}
