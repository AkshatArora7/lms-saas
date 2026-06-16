import { redirect } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import {
  AppShell,
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  Grid,
  Inline,
  ProgressBar,
  Stack,
} from "@lms/ui";

import { getBranding } from "./lib/branding";
import { getSession } from "./lib/auth";
import { getDashboardCourses } from "./lib/dashboard";
import {
  formatDue,
  getAssignments,
  type AssignmentView,
} from "./lib/assignments";
import {
  getAnnouncements,
  relativeTime,
  summarizeAnnouncements,
} from "./lib/announcements";
import { canTeach } from "./lib/teaching";
import SignOutButton from "./sign-out-button";

/**
 * Scoped layout polish for the dashboard. Everything visual resolves from the
 * tenant theme tokens (var(--lms-*)) so the screen stays fully white-label: a
 * red/sharp brand renders just as correctly as a teal/rounded one. The media
 * query drives the wide-content + narrow-sticky-sidebar split that collapses to
 * a single column on phones/tablets with no horizontal overflow.
 */
const DASHBOARD_STYLES = `
.lms-dash { display: grid; gap: var(--lms-space-6); }
.lms-dash__hero-title {
  margin: 0;
  font-size: clamp(1.75rem, 4vw, 2.5rem);
  line-height: 1.1;
  overflow-wrap: anywhere;
}
.lms-dash__hero-subtitle {
  margin: var(--lms-space-2) 0 0;
  color: var(--lms-text-muted);
  font-size: clamp(1rem, 2vw, 1.15rem);
  overflow-wrap: anywhere;
}
.lms-dash__nav {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2);
  align-items: center;
}
.lms-dash__main {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--lms-space-5);
  align-items: start;
}
@media (min-width: 1025px) {
  .lms-dash__main {
    grid-template-columns: minmax(0, 1fr) clamp(280px, 28vw, 340px);
  }
  .lms-dash__aside-card { position: sticky; top: var(--lms-space-5); }
}
.lms-dash__section-heading {
  margin: 0;
  font-size: clamp(1.15rem, 2.5vw, 1.4rem);
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.lms-dash__heading-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2) var(--lms-space-3);
  align-items: baseline;
  justify-content: space-between;
  padding-bottom: var(--lms-space-2);
  border-bottom: 1px solid var(--lms-border);
}
.lms-dash__list { list-style: none; margin: 0; padding: 0; }
.lms-dash__row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2) var(--lms-space-3);
  align-items: center;
  justify-content: space-between;
  padding: var(--lms-space-3) 0;
  border-bottom: 1px solid var(--lms-border);
}
.lms-dash__row:last-child { border-bottom: 0; padding-bottom: 0; }
.lms-dash__row:first-child { padding-top: 0; }
.lms-dash__ann {
  display: flex;
  gap: var(--lms-space-3);
  align-items: flex-start;
  padding: var(--lms-space-3);
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius-sm);
  background: var(--lms-surface-2);
}
.lms-dash__ann-dot {
  flex-shrink: 0;
  width: 9px;
  height: 9px;
  margin-top: 6px;
  border-radius: var(--lms-radius-pill);
  background: var(--lms-accent);
}
.lms-dash__clamp2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--lms-text-muted);
}
`;

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "1rem",
  lineHeight: 1.3,
  overflowWrap: "anywhere",
};

const bodyTextStyle: CSSProperties = {
  margin: 0,
  overflowWrap: "anywhere",
};

const labelStyle: CSSProperties = {
  fontSize: "0.8rem",
  fontWeight: 600,
  letterSpacing: "0.02em",
  textTransform: "uppercase",
  color: "var(--lms-text-muted)",
};

const itemTitleStyle: CSSProperties = {
  fontWeight: 600,
  overflowWrap: "anywhere",
};

/** Section heading with an optional "view all" affordance, server-rendered. */
function SectionHeading({
  id,
  title,
  href,
  linkLabel,
}: {
  id: string;
  title: string;
  href?: string;
  linkLabel?: string;
}): ReactNode {
  return (
    <div className="lms-dash__heading-row">
      <h2 className="lms-dash__section-heading" id={id}>
        {title}
      </h2>
      {href ? (
        <Button href={href} size="sm" variant="ghost">
          {linkLabel ?? "View all"}
        </Button>
      ) : null}
    </div>
  );
}

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");

  const brand = getBranding(session.tenantId);
  const courses = getDashboardCourses(session.tenantId);

  const allAnnouncements = getAnnouncements(session.tenantId);
  const announcementsSummary = summarizeAnnouncements(allAnnouncements);
  const recentAnnouncements = allAnnouncements.slice(0, 3);

  const upNext: AssignmentView[] = getAssignments(session.tenantId)
    .filter(
      (a) => a.status === "overdue" || a.status === "not_started",
    )
    .slice(0, 4);

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{DASHBOARD_STYLES}</style>

      <div className="lms-dash">
        <header>
          <h1 className="lms-dash__hero-title">Welcome back</h1>
          <p className="lms-dash__hero-subtitle">
            Here&apos;s your learning at a glance.
          </p>
          <nav aria-label="Quick links" className="lms-dash__nav" style={{ marginTop: "var(--lms-space-4)" }}>
            {canTeach(session.roles) ? (
              <Button href="/teach" size="sm" variant="secondary">
                Teaching
              </Button>
            ) : null}
            <Button href="/schedule" size="sm" variant="secondary">
              Schedule
            </Button>
            <Button href="/announcements" size="sm" variant="secondary">
              Announcements
              {announcementsSummary.unread
                ? ` (${announcementsSummary.unread})`
                : ""}
            </Button>
            <Button href="/assignments" size="sm" variant="secondary">
              Assignments
            </Button>
            <Button href="/grades" size="sm" variant="secondary">
              View grades
            </Button>
          </nav>
        </header>

        <div className="lms-dash__main">
          <Stack gap={5}>
            <section aria-labelledby="courses-heading">
              <Stack gap={4}>
                <SectionHeading id="courses-heading" title="My courses" />
                {courses.length ? (
                  <Grid min="240px">
                    {courses.map((course) => (
                      <Card
                        aria-label={`Open ${course.title}`}
                        as="a"
                        href={`/courses/${course.id}`}
                        interactive
                        key={course.id}
                      >
                        <Stack gap={3}>
                          <Inline gap={2} justify="space-between">
                            <Badge tone="accent">{course.code}</Badge>
                            <Badge tone="neutral">{course.term}</Badge>
                          </Inline>
                          <h3 style={sectionTitleStyle}>{course.title}</h3>
                          <Stack gap={2}>
                            <Inline gap={2} justify="space-between">
                              <span style={labelStyle}>Progress</span>
                              <span style={{ fontWeight: 700 }}>
                                {course.progress}%
                              </span>
                            </Inline>
                            <ProgressBar
                              label={`${course.title} progress`}
                              value={course.progress}
                            />
                          </Stack>
                          <Chip tone="accent">{course.role}</Chip>
                        </Stack>
                      </Card>
                    ))}
                  </Grid>
                ) : (
                  <EmptyState
                    description="Once you're enrolled, your courses will appear here."
                    icon="📚"
                    title="No courses yet"
                  />
                )}
              </Stack>
            </section>

            <Grid gap={4} min="260px">
              <section aria-labelledby="upnext-heading">
                <Card>
                  <Stack gap={3}>
                    <SectionHeading
                      href="/assignments"
                      id="upnext-heading"
                      title="Up next"
                    />
                    {upNext.length ? (
                      <ul className="lms-dash__list">
                        {upNext.map((assignment) => {
                          const overdue = assignment.status === "overdue";
                          return (
                            <li className="lms-dash__row" key={assignment.id}>
                              <span style={{ minWidth: 0 }}>
                                <span style={itemTitleStyle}>
                                  {assignment.title}
                                </span>
                                <span
                                  style={{
                                    display: "block",
                                    color: "var(--lms-text-muted)",
                                    fontSize: "0.85rem",
                                    overflowWrap: "anywhere",
                                  }}
                                >
                                  {assignment.code}
                                </span>
                              </span>
                              <Badge tone={overdue ? "danger" : "neutral"}>
                                {overdue ? "Overdue · " : "Due "}
                                {formatDue(assignment.dueAt)}
                              </Badge>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <EmptyState
                        description="You're all caught up. New work will show up here."
                        icon="✅"
                        title="Nothing due"
                      />
                    )}
                  </Stack>
                </Card>
              </section>

              <section aria-labelledby="announcements-heading">
                <Card>
                  <Stack gap={3}>
                    <SectionHeading
                      href="/announcements"
                      id="announcements-heading"
                      title="Recent announcements"
                    />
                    {recentAnnouncements.length ? (
                      <Stack gap={2}>
                        {recentAnnouncements.map((announcement) => (
                          <div
                            className="lms-dash__ann"
                            key={announcement.id}
                          >
                            {announcement.unread ? (
                              <span
                                aria-hidden="true"
                                className="lms-dash__ann-dot"
                              />
                            ) : (
                              <span
                                aria-hidden="true"
                                className="lms-dash__ann-dot"
                                style={{ background: "transparent" }}
                              />
                            )}
                            <Stack gap={1}>
                              <Inline gap={2}>
                                <span style={itemTitleStyle}>
                                  {announcement.title}
                                </span>
                                {announcement.unread ? (
                                  <Badge tone="accent">Unread</Badge>
                                ) : null}
                              </Inline>
                              <span className="lms-dash__clamp2">
                                {announcement.body}
                              </span>
                              <span style={labelStyle}>
                                {relativeTime(announcement.postedAt)} ·{" "}
                                {announcement.author}
                              </span>
                            </Stack>
                          </div>
                        ))}
                      </Stack>
                    ) : (
                      <EmptyState
                        description="School and course updates will appear here."
                        icon="📣"
                        title="No announcements"
                      />
                    )}
                  </Stack>
                </Card>
              </section>
            </Grid>
          </Stack>

          <aside aria-labelledby="account-heading">
            <Card className="lms-dash__aside-card">
              <Stack gap={4}>
                <Inline gap={3}>
                  <Avatar name={session.userId} />
                  <h2
                    className="lms-dash__section-heading"
                    id="account-heading"
                  >
                    Your account
                  </h2>
                </Inline>
                <Stack gap={3}>
                  <Stack gap={1}>
                    <span style={labelStyle}>User</span>
                    <span style={bodyTextStyle}>{session.userId}</span>
                  </Stack>
                  <Stack gap={1}>
                    <span style={labelStyle}>Tenant</span>
                    <span style={bodyTextStyle}>
                      {session.tenantId} ({session.tier})
                    </span>
                  </Stack>
                  <Stack gap={2}>
                    <span style={labelStyle}>Roles</span>
                    <Inline gap={2}>
                      {session.roles.length ? (
                        session.roles.map((role) => (
                          <Badge key={role} tone="accent">
                            {role}
                          </Badge>
                        ))
                      ) : (
                        <span style={bodyTextStyle}>none</span>
                      )}
                    </Inline>
                  </Stack>
                  <Stack gap={2}>
                    <span style={labelStyle}>Scopes</span>
                    <Inline gap={2}>
                      {session.scopes.length ? (
                        session.scopes.map((scope) => (
                          <Badge key={scope} tone="neutral">
                            {scope}
                          </Badge>
                        ))
                      ) : (
                        <span style={bodyTextStyle}>none</span>
                      )}
                    </Inline>
                  </Stack>
                </Stack>
                <Button fullWidth href="/profile" variant="secondary">
                  View profile
                </Button>
              </Stack>
            </Card>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
