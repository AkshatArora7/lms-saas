import { notFound, redirect } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  Stack,
} from "@lms/ui";
import type { BadgeTone } from "@lms/ui";

import { getBranding } from "../../lib/branding";
import { getSession } from "../../lib/auth";
import {
  getCourseDetail,
  type ContentItemStatus,
  type ContentItemType,
} from "../../lib/dashboard";
import { AppShell, ContentIcon } from "../../lib/ui";
import SignOutButton from "../../sign-out-button";

/**
 * Scoped layout polish for the course-detail screen. Every visual decision
 * resolves from tenant theme tokens (var(--lms-*)) so the page stays fully
 * white-label: the same markup renders correctly for a teal/rounded brand and a
 * red/sharp one. The media query drives the 8/4 content + sticky-overview split
 * that collapses to a single column below the desktop breakpoint with no
 * horizontal overflow at 360px.
 */
const COURSE_STYLES = `
.lms-cd { display: grid; gap: var(--lms-space-5); }
.lms-cd__header {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-4);
}
.lms-cd__header-main { min-width: 0; display: grid; gap: var(--lms-space-3); }
.lms-cd__title {
  margin: 0;
  font-size: clamp(1.75rem, 4vw, 2.5rem);
  line-height: 1.1;
  font-weight: 700;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
}
.lms-cd__desc {
  margin: 0;
  max-width: 60ch;
  color: var(--lms-text-muted);
  font-size: clamp(1rem, 2vw, 1.15rem);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.lms-cd__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2);
  align-items: center;
}
.lms-cd__header-actions { flex-shrink: 0; }
@media (min-width: 768px) {
  .lms-cd__header {
    flex-direction: row;
    align-items: flex-start;
    justify-content: space-between;
  }
}
.lms-cd__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--lms-space-5);
  align-items: start;
}
@media (min-width: 1025px) {
  .lms-cd__grid {
    grid-template-columns: minmax(0, 8fr) minmax(0, 4fr);
  }
  .lms-cd__aside-card { position: sticky; top: var(--lms-space-5); }
}
.lms-cd__section-heading {
  margin: 0 0 var(--lms-space-3);
  font-size: clamp(1.15rem, 2.5vw, 1.4rem);
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.lms-cd__module-title {
  margin: 0;
  font-size: 1.05rem;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.lms-cd__items { list-style: none; margin: 0; padding: 0; }
.lms-cd__item {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2) var(--lms-space-3);
  align-items: center;
  justify-content: space-between;
  padding: var(--lms-space-3) 0;
  border-bottom: 1px solid var(--lms-border);
}
.lms-cd__item:first-child { padding-top: 0; }
.lms-cd__item:last-child { border-bottom: 0; padding-bottom: 0; }
.lms-cd__item-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--lms-space-2);
  min-width: 0;
}
.lms-cd__type {
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 11px;
}
.lms-cd__item-link {
  color: var(--lms-accent);
  font-weight: 600;
  text-decoration: none;
  overflow-wrap: anywhere;
}
.lms-cd__item-link:hover { text-decoration: underline; }
.lms-cd__ov-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-1) var(--lms-space-3);
  align-items: baseline;
  justify-content: space-between;
}
.lms-cd__ov-label { color: var(--lms-text-muted); font-size: 0.9rem; }
.lms-cd__ov-value {
  font-weight: 600;
  text-align: right;
  overflow-wrap: anywhere;
}
`;

const TYPE_LABEL: Record<ContentItemType, string> = {
  lesson: "Lesson",
  assignment: "Assignment",
  quiz: "Quiz",
};

const STATUS_META: Record<ContentItemStatus, { label: string; tone: BadgeTone }> = {
  completed: { label: "Completed", tone: "success" },
  in_progress: { label: "In progress", tone: "accent" },
  not_started: { label: "Not started", tone: "neutral" },
};

export default async function CoursePage({
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

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{COURSE_STYLES}</style>

      <div className="lms-cd">
        <Button href="/" size="sm" variant="ghost">
          ← Back to dashboard
        </Button>

        <Card>
          <header className="lms-cd__header">
            <div className="lms-cd__header-main">
              <h1 className="lms-cd__title">{course.title}</h1>
              {course.description ? (
                <p className="lms-cd__desc">{course.description}</p>
              ) : null}
              <div className="lms-cd__meta">
                {course.code ? <Badge tone="neutral">{course.code}</Badge> : null}
                {course.term ? <Badge tone="neutral">{course.term}</Badge> : null}
                <Chip tone="accent">{course.role}</Chip>
              </div>
            </div>
            <div className="lms-cd__header-actions">
              <Button
                href={`/courses/${course.id}/discussions`}
                size="sm"
                variant="secondary"
              >
                Discussions
              </Button>
            </div>
          </header>
        </Card>

        <div className="lms-cd__grid">
          <section aria-labelledby="modules-heading">
            <h2 className="lms-cd__section-heading" id="modules-heading">
              Course content
            </h2>
            {course.modules.length ? (
              <Stack gap={4}>
                {course.modules.map((module) => (
                  <Card key={module.id}>
                    <Stack gap={3}>
                      <h3 className="lms-cd__module-title">{module.title}</h3>
                      <ul className="lms-cd__items">
                        {module.items.map((item) => {
                          const status = STATUS_META[item.status];
                          return (
                            <li className="lms-cd__item" key={item.id}>
                              <span className="lms-cd__item-main">
                                <Badge tone="neutral">
                                  <span className="lms-cd__type">
                                    {TYPE_LABEL[item.type]}
                                  </span>
                                </Badge>
                                <a
                                  className="lms-cd__item-link"
                                  href={`/courses/${course.id}/items/${item.id}`}
                                >
                                  {item.title}
                                </a>
                              </span>
                              <Chip tone={status.tone}>{status.label}</Chip>
                            </li>
                          );
                        })}
                      </ul>
                    </Stack>
                  </Card>
                ))}
              </Stack>
            ) : (
              <EmptyState
                description="Content for this course hasn't been published yet."
                icon={<ContentIcon />}
                title="No modules yet"
              />
            )}
          </section>

          <aside aria-labelledby="overview-heading">
            <Card className="lms-cd__aside-card">
              <Stack gap={4}>
                <h2 className="lms-cd__section-heading" id="overview-heading">
                  Overview
                </h2>
                <Stack gap={3}>
                  <div className="lms-cd__ov-row">
                    <span className="lms-cd__ov-label">Your role</span>
                    <span className="lms-cd__ov-value">{course.role}</span>
                  </div>
                  {course.instructor ? (
                    <div className="lms-cd__ov-row">
                      <span className="lms-cd__ov-label">Instructor</span>
                      <span className="lms-cd__ov-value">
                        {course.instructor}
                      </span>
                    </div>
                  ) : null}
                  {course.term ? (
                    <div className="lms-cd__ov-row">
                      <span className="lms-cd__ov-label">Term</span>
                      <span className="lms-cd__ov-value">{course.term}</span>
                    </div>
                  ) : null}
                  {course.code ? (
                    <div className="lms-cd__ov-row">
                      <span className="lms-cd__ov-label">Course code</span>
                      <span className="lms-cd__ov-value">{course.code}</span>
                    </div>
                  ) : null}
                </Stack>
              </Stack>
            </Card>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
