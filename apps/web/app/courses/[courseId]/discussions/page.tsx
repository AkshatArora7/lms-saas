import { notFound, redirect } from "next/navigation";
import {
  AppShell,
  Badge,
  Breadcrumbs,
  Card,
  EmptyState,
  Grid,
  Inline,
  PageHeader,
  StatCard,
  Stack,
} from "@lms/ui";

import { getBranding } from "../../../lib/branding";
import { getSession } from "../../../lib/auth";
import { getCourseDetail } from "../../../lib/dashboard";
import { GenericIcon } from "../../../lib/ui";
import {
  getCourseDiscussions,
  relativeTime,
  summarizeDiscussions,
} from "../../../lib/discussions";
import SignOutButton from "../../../sign-out-button";

const discussionsCss = `
.disc-list {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-3);
  list-style: none;
  margin: 0;
  padding: 0;
}
.disc-title {
  font-weight: 600;
  margin: 0;
  overflow-wrap: anywhere;
}
.disc-meta {
  color: var(--lms-text-muted);
  margin: 0;
  overflow-wrap: anywhere;
}
.disc-excerpt {
  margin: 0;
  overflow-wrap: anywhere;
}
.disc-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2) var(--lms-space-3);
  justify-content: space-between;
}
`;

export default async function CourseDiscussionsPage({
  params,
}: {
  params: { courseId: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);

  const course = await getCourseDetail(
    params.courseId,
    session.userId,
    session.tenantId,
  );
  if (!course) notFound();

  const threads = await getCourseDiscussions(params.courseId, session.tenantId);
  const summary = summarizeDiscussions(threads);

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{discussionsCss}</style>
      <Stack gap={4}>
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/" },
            { label: course.code ?? course.title, href: `/courses/${course.id}` },
            { label: "Discussions" },
          ]}
        />

        <PageHeader
          title="Discussions"
          subtitle={`Threads for ${course.title}.`}
          actions={
            course.code ? <Badge tone="neutral">{course.code}</Badge> : undefined
          }
        />

        {threads.length ? (
          <>
            <Grid gap={4} min="200px">
              <StatCard label="Threads" value={summary.total} />
              <StatCard label="Unanswered" value={summary.unanswered} />
            </Grid>

            <ul className="disc-list">
              {threads.map((thread) => (
                <li key={thread.id}>
                  <Card>
                    <Stack gap={2}>
                      <div className="disc-row">
                        <Inline gap={2}>
                          {thread.pinned ? (
                            <Badge tone="accent">Pinned</Badge>
                          ) : null}
                          <p className="disc-title">{thread.title}</p>
                        </Inline>
                        {thread.unanswered ? (
                          <Badge tone="warning">Unanswered</Badge>
                        ) : (
                          <Badge tone="neutral">
                            {thread.replies}{" "}
                            {thread.replies === 1 ? "reply" : "replies"}
                          </Badge>
                        )}
                      </div>
                      <p className="disc-meta">
                        {thread.author} · last activity{" "}
                        {relativeTime(thread.lastActivityAt)}
                      </p>
                      {thread.excerpt ? (
                        <p className="disc-excerpt">{thread.excerpt}</p>
                      ) : null}
                    </Stack>
                  </Card>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <EmptyState
            description="No discussion threads have been started in this course yet."
            icon={<GenericIcon />}
            title="No discussions yet"
          />
        )}
      </Stack>
    </AppShell>
  );
}
