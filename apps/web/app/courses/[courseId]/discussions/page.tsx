import { notFound, redirect } from "next/navigation";
import type { CSSProperties } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Grid,
  PageHeader,
  Stack,
} from "@lms/ui";
import { getMessages, t } from "@lms/i18n";

import { getBranding } from "../../../lib/branding";
import { getSession } from "../../../lib/auth";
import { resolveRequestLocale } from "../../../lib/i18n";
import { AppLocaleSwitcher } from "../../../lib/locale-switcher";
import { getCourseDetail } from "../../../lib/dashboard";
import {
  getCourseDiscussions,
  relativeTime,
  summarizeDiscussions,
} from "../../../lib/discussions";
import { AppShell, DiscussionsIcon } from "../../../lib/ui";
import SignOutButton from "../../../sign-out-button";

/**
 * Scoped layout polish for the course-discussions screen, brought up to the
 * shared learner bar: every visual decision resolves from the tenant theme
 * tokens (var(--lms-*)) so the page stays fully white-label. The stat band uses
 * the same .stat clamp() pattern as assignments/grades, and each thread card
 * carries a token-driven left accent rail (pinned = accent, unanswered =
 * warning) PLUS a redundant TEXT badge so status is never carried by colour
 * alone. The layout reflows from a single stacked column on phones to a roomier
 * grid on wider screens with no horizontal overflow at 360px.
 */
const discussionsCss = `
.disc-stat-card {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-1);
  align-items: flex-start;
}
.disc-stat {
  font-size: clamp(1.9rem, 5vw, 2.4rem);
  font-weight: 700;
  line-height: 1;
  margin: 0;
  font-variant-numeric: tabular-nums;
  color: var(--lms-stat-accent, var(--lms-text));
}
.disc-stat-label {
  color: var(--lms-text-muted);
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.disc-list {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-3);
  list-style: none;
  margin: 0;
  padding: 0;
}
.disc-card {
  position: relative;
  padding-left: var(--lms-space-5);
}
.disc-card::before {
  content: "";
  position: absolute;
  left: 0;
  top: var(--lms-space-3);
  bottom: var(--lms-space-3);
  width: 4px;
  border-radius: var(--lms-radius-pill);
  background: var(--disc-accent, transparent);
}
.disc-title {
  font-size: clamp(1.05rem, 2.5vw, 1.2rem);
  font-weight: 700;
  line-height: 1.3;
  margin: 0;
  overflow-wrap: anywhere;
  min-width: 0;
}
.disc-meta {
  color: var(--lms-text-muted);
  margin: 0;
  font-size: 0.9rem;
  overflow-wrap: anywhere;
}
.disc-excerpt {
  color: var(--lms-text-muted);
  margin: 0;
  overflow-wrap: anywhere;
}
.disc-row {
  align-items: flex-start;
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2) var(--lms-space-3);
  justify-content: space-between;
}
.disc-headline {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2);
  min-width: 0;
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
  const m = getMessages(await resolveRequestLocale());

  const course = await getCourseDetail(
    params.courseId,
    session.userId,
    session.tenantId,
  );
  if (!course) notFound();

  const threads = await getCourseDiscussions(params.courseId, session.tenantId);
  const summary = summarizeDiscussions(threads);

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
      <style>{discussionsCss}</style>
      <Stack gap={4}>
        <Button href={`/courses/${course.id}`} size="sm" variant="ghost">
          {t(m, "item.backToCourse", { course: course.code ?? course.title })}
        </Button>

        <PageHeader
          title={t(m, "discussions.title")}
          subtitle={t(m, "discussions.subtitle", { course: course.title })}
          actions={
            course.code ? <Badge tone="neutral">{course.code}</Badge> : undefined
          }
        />

        {threads.length ? (
          <>
            <Grid gap={4} min="200px">
              <Card>
                <div
                  className="disc-stat-card"
                  style={
                    { "--lms-stat-accent": "var(--lms-accent)" } as CSSProperties
                  }
                >
                  <p className="disc-stat">{summary.total}</p>
                  <p className="disc-stat-label">
                    {t(m, "discussions.statThreads")}
                  </p>
                </div>
              </Card>
              <Card>
                <div
                  className="disc-stat-card"
                  style={
                    {
                      "--lms-stat-accent": "var(--lms-warning)",
                    } as CSSProperties
                  }
                >
                  <p className="disc-stat">{summary.unanswered}</p>
                  <p className="disc-stat-label">
                    {t(m, "discussions.statUnanswered")}
                  </p>
                </div>
              </Card>
            </Grid>

            <ul className="disc-list" aria-label={t(m, "discussions.listLabel")}>
              {threads.map((thread) => {
                const accent = thread.pinned
                  ? "var(--lms-accent)"
                  : thread.unanswered
                    ? "var(--lms-warning)"
                    : "transparent";
                return (
                  <li key={thread.id}>
                    <Card
                      className="disc-card"
                      style={{ "--disc-accent": accent } as CSSProperties}
                    >
                      <Stack gap={2}>
                        <div className="disc-row">
                          <div className="disc-headline">
                            {thread.pinned ? (
                              <Badge tone="accent">
                                {t(m, "discussions.pinned")}
                              </Badge>
                            ) : null}
                            <h2 className="disc-title">{thread.title}</h2>
                          </div>
                          {thread.unanswered ? (
                            <Badge tone="warning">
                              {t(m, "discussions.unanswered")}
                            </Badge>
                          ) : (
                            <Badge tone="neutral">
                              {t(
                                m,
                                thread.replies === 1
                                  ? "discussions.replyOne"
                                  : "discussions.replyOther",
                                { count: thread.replies },
                              )}
                            </Badge>
                          )}
                        </div>
                        <p className="disc-meta">
                          {t(m, "discussions.lastActivity", {
                            author: thread.author,
                            time: relativeTime(thread.lastActivityAt),
                          })}
                        </p>
                        {thread.excerpt ? (
                          <p className="disc-excerpt">{thread.excerpt}</p>
                        ) : null}
                      </Stack>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <EmptyState
            description={t(m, "discussions.emptyBody")}
            icon={<DiscussionsIcon />}
            title={t(m, "discussions.emptyTitle")}
          />
        )}
      </Stack>
    </AppShell>
  );
}
