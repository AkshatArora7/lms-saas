import { notFound, redirect } from "next/navigation";
import { Alert, Button, PageHeader, Stack } from "@lms/ui";

import { getBranding } from "../../../lib/branding";
import { getSession } from "../../../lib/auth";
import { AppShell } from "../../../lib/ui";
import { canTeach, getTaughtCourse } from "../../../lib/teaching";
import { listCourseVideos } from "../../../lib/video-api";
import SignOutButton from "../../../sign-out-button";
import CourseVideosManager from "./course-videos-manager";

/**
 * Teacher "Course videos" screen (#320). The RSC resolves the session, gates on
 * the teaching role (non-teachers see a warning Alert, never the uploader),
 * confirms the instructor teaches this course, then loads the course's existing
 * video library. The interactive uploader + live status poller + library are the
 * client `CourseVideosManager`, seeded with the server-loaded list.
 *
 * Identity is server-trusted: all writes go through the BFF route handlers under
 * /api/video/* which stamp x-tenant-id/x-user-id/x-user-roles; the only
 * browser→Blob direct call is the signed PUT of the bytes.
 *
 * Layout is mobile-first and fluid: a single column on phone, the library grid
 * reflowing to 2-up (tablet) / auto-fill (desktop) with min-width:0 children, so
 * there is no horizontal overflow at 360px.
 */
export default async function CourseVideosPage({
  params,
}: {
  params: { courseId: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);
  const shellActions = <SignOutButton />;

  if (!canTeach(session.roles)) {
    return (
      <AppShell actions={shellActions} brand={brand}>
        <Stack gap={4}>
          <Button href="/teach" size="sm" variant="ghost">
            ← Back to teaching
          </Button>
          <PageHeader
            subtitle="You don't have permission to manage videos for this course."
            title="Not authorized"
          />
          <Alert tone="warning">
            <strong>{session.userId}</strong> — ask a course administrator if you
            believe you should have access.
          </Alert>
        </Stack>
      </AppShell>
    );
  }

  const { courseId } = params;
  const course = await getTaughtCourse(session.userId, courseId, session.tenantId);
  if (!course) notFound();

  const videos = await listCourseVideos(
    courseId,
    { userId: session.userId, roles: session.roles },
    session.tenantId,
  );

  return (
    <AppShell actions={shellActions} brand={brand}>
      <Stack gap={4}>
        <Button href="/teach" size="sm" variant="ghost">
          ← Back to teaching
        </Button>

        <PageHeader
          subtitle={`Add and manage videos for ${course.title}.`}
          title="Course videos"
        />

        <CourseVideosManager courseId={courseId} initialVideos={videos} />
      </Stack>
    </AppShell>
  );
}
