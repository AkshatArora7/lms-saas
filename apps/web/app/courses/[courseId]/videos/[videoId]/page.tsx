import { redirect } from "next/navigation";
import { Alert, Button, PageHeader, Stack } from "@lms/ui";

import { getBranding } from "../../../../lib/branding";
import { getSession } from "../../../../lib/auth";
import { AppShell } from "../../../../lib/ui";
import { getVideo } from "../../../../lib/video-api";
import { pickHlsSource } from "../../../../lib/video-status";
import SignOutButton from "../../../../sign-out-button";
import VideoPlayer from "./video-player";

/**
 * Learner video player screen (#320). The RSC resolves the session, fetches the
 * asset via the BFF read (server-trusted identity → the service's course-access
 * gate decides 404/403 — existence-hiding, so a forbidden learner never gets the
 * stream URLs), then renders one of:
 *   - the HLS player (status=ready),
 *   - a "Still processing" placeholder with light auto-refresh (uploaded|transcoding),
 *   - a "Video unavailable" placeholder (404/403),
 *   - an offline warning (service unreachable).
 *
 * Route chosen: /courses/[courseId]/videos/[videoId] (the ux JSON's primary
 * option). The 16:9 stage is width:100% with aspect-ratio:16/9 so it never
 * overflows at 360px and is capped/centred on wide desktops by the player CSS.
 */
const placeholderCss = `
.vp-back { align-self: flex-start; }
.vp-stage-fallback {
  width: 100%; box-sizing: border-box;
  border: 1px solid var(--lms-border-strong);
  border-radius: var(--lms-radius-md);
  background: var(--lms-surface-2);
  min-height: 52vh;
  display: flex; align-items: center; justify-content: center;
  padding: var(--lms-space-5); overflow: hidden;
}
@media (min-width: 601px) { .vp-stage-fallback { aspect-ratio: 16 / 9; min-height: 0; } }
.vp-ph {
  display: flex; flex-direction: column; gap: var(--lms-space-3);
  align-items: center; text-align: center; max-width: 46ch; min-width: 0;
}
.vp-ph svg { color: var(--lms-text-subtle); }
.vp-ph h2 { margin: 0; font-size: 1.15rem; font-weight: 700; }
.vp-ph p { margin: 0; color: var(--lms-text-muted); line-height: 1.6; overflow-wrap: anywhere; }
`;

const PROCESSING_ICON = (
  <svg
    aria-hidden="true"
    fill="none"
    height="48"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={1.6}
    viewBox="0 0 24 24"
    width="48"
  >
    <path d="M21 12a9 9 0 1 1-6.2-8.5" />
    <path d="M21 4v5h-5" />
  </svg>
);

const UNAVAILABLE_ICON = (
  <svg
    aria-hidden="true"
    fill="none"
    height="48"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={1.6}
    viewBox="0 0 24 24"
    width="48"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="m15 9-6 6M9 9l6 6" />
  </svg>
);

export default async function VideoPlayerPage({
  params,
}: {
  params: { courseId: string; videoId: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);
  const backHref = `/courses/${params.courseId}`;
  const shellActions = <SignOutButton />;

  const result = await getVideo(
    params.videoId,
    { userId: session.userId, roles: session.roles },
    session.tenantId,
  );

  const shell = (children: React.ReactNode, title: string, subtitle?: string) => (
    <AppShell actions={shellActions} brand={brand}>
      <style>{placeholderCss}</style>
      <Stack gap={4}>
        <Button className="vp-back" href={backHref} size="sm" variant="ghost">
          ← Back to course
        </Button>
        <PageHeader subtitle={subtitle} title={title} />
        {children}
      </Stack>
    </AppShell>
  );

  // Offline (transport) vs unavailable (404/403). 503 = offline warning.
  if (!result.ok) {
    if (result.status === 503) {
      return shell(
        <Alert tone="warning">{result.error}</Alert>,
        "Video unavailable",
        "We couldn't reach the video service.",
      );
    }
    return shell(
      <div className="vp-stage-fallback">
        <div className="vp-ph">
          {UNAVAILABLE_ICON}
          <h2>Video unavailable</h2>
          <p>
            We couldn&apos;t open this video. It may have been removed or you
            don&apos;t have access.
          </p>
          <Button href={backHref} size="sm" variant="secondary">
            Back to course
          </Button>
        </div>
      </div>,
      "Video unavailable",
    );
  }

  const video = result.video;

  if (video.status !== "ready") {
    return shell(
      <div className="vp-stage-fallback">
        <div className="vp-ph" role="status">
          {PROCESSING_ICON}
          <h2>Still processing</h2>
          <p>
            This video is being prepared and will be ready soon. Check back in a
            few minutes — this page refreshes automatically.
          </p>
          <Button href={backHref} size="sm" variant="secondary">
            Back to course
          </Button>
        </div>
      </div>,
      video.title,
      "Course video",
    );
  }

  const src = pickHlsSource(video.renditions);
  if (!src) {
    return shell(
      <div className="vp-stage-fallback">
        <div className="vp-ph">
          {UNAVAILABLE_ICON}
          <h2>Video unavailable</h2>
          <p>This video doesn&apos;t have a playable stream yet.</p>
          <Button href={backHref} size="sm" variant="secondary">
            Back to course
          </Button>
        </div>
      </div>,
      video.title,
      "Course video",
    );
  }

  return (
    <AppShell actions={shellActions} brand={brand}>
      <Stack gap={4}>
        <Button href={backHref} size="sm" variant="ghost">
          ← Back to course
        </Button>
        <PageHeader subtitle="Course video" title={video.title} />
        <VideoPlayer
          captions={video.captions}
          src={src}
          title={video.title}
          videoId={video.id}
        />
      </Stack>
    </AppShell>
  );
}
