import { notFound, redirect } from "next/navigation";
import type { CSSProperties } from "react";
import {
  AppShell,
  Alert,
  Badge,
  Button,
  Card,
  Chip,
  Inline,
  PageHeader,
  Stack,
} from "@lms/ui";
import type { BadgeTone } from "@lms/ui";

import { getBranding } from "../../../../lib/branding";
import { getSession } from "../../../../lib/auth";
import {
  getContentItem,
  type ContentItem,
  type ContentItemStatus,
  type ContentItemType,
} from "../../../../lib/dashboard";
import SignOutButton from "../../../../sign-out-button";

/**
 * Scoped layout polish for the learner content-item (course player) screen.
 * Every visual decision resolves from the tenant theme tokens (var(--lms-*)) so
 * the page stays fully white-label: the same markup renders correctly for a
 * teal/rounded brand and a red/sharp one. The reading column is the focal
 * point, with a slim "In this module" context rail that sits beside the body on
 * desktop and stacks below it on phone/tablet. Status is always carried by TEXT
 * (a visible label), never colour alone. The grid collapses to a single column
 * with no horizontal overflow at 360px.
 */
const itemCss = `
.ci-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--lms-space-5);
  align-items: start;
}
@media (min-width: 1025px) {
  .ci-grid {
    grid-template-columns: minmax(0, 1fr) 18rem;
  }
}
.ci-reading {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-4);
  min-width: 0;
}
.ci-section-heading {
  font-size: clamp(1.15rem, 3vw, 1.4rem);
  font-weight: 700;
  line-height: 1.25;
  margin: 0 0 var(--lms-space-3);
  padding-bottom: var(--lms-space-3);
  border-bottom: 1px solid var(--lms-border);
  overflow-wrap: anywhere;
}
.ci-body {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-3);
}
.ci-body p {
  margin: 0;
  line-height: 1.6;
  color: var(--lms-text);
  overflow-wrap: anywhere;
}
.ci-action {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.ci-action .lms-btn {
  width: 100%;
}
@media (min-width: 601px) {
  .ci-action .lms-btn {
    width: auto;
  }
}
.ci-nav {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-3);
  border-top: 1px solid var(--lms-border);
  padding-top: var(--lms-space-4);
}
@media (min-width: 601px) {
  .ci-nav {
    flex-direction: row;
    justify-content: space-between;
    align-items: stretch;
  }
}
.ci-nav__slot {
  display: flex;
  min-width: 0;
  flex: 1 1 0;
}
.ci-nav__slot--next {
  justify-content: flex-end;
}
.ci-nav__link {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-1);
  min-width: 0;
  max-width: 100%;
  padding: var(--lms-space-3);
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius-md);
  background: var(--lms-surface);
  color: var(--lms-text);
  text-decoration: none;
}
.ci-nav__slot--next .ci-nav__link {
  text-align: right;
  align-items: flex-end;
}
.ci-nav__link:hover {
  border-color: var(--lms-accent);
}
.ci-nav__link:focus-visible {
  outline: 2px solid var(--lms-accent);
  outline-offset: 2px;
}
.ci-nav__dir {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--lms-text-muted);
}
.ci-nav__title {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.ci-nav__empty {
  display: flex;
  align-items: center;
  flex: 1 1 0;
  margin: 0;
  padding: var(--lms-space-3);
  border: 1px dashed var(--lms-border);
  border-radius: var(--lms-radius-md);
  color: var(--lms-text-muted);
  font-size: 0.85rem;
}
.ci-rail {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-3);
}
@media (min-width: 1025px) {
  .ci-rail {
    position: sticky;
    top: var(--lms-space-5);
  }
}
.ci-rail__heading {
  font-size: 1rem;
  font-weight: 700;
  line-height: 1.3;
  margin: 0 0 var(--lms-space-2);
  padding-bottom: var(--lms-space-2);
  border-bottom: 1px solid var(--lms-border);
}
.ci-rail__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-1);
}
.ci-rail__row {
  display: flex;
  align-items: flex-start;
  gap: var(--lms-space-2);
  padding: var(--lms-space-2);
  border-radius: var(--lms-radius-sm);
  border-left: 3px solid transparent;
  text-decoration: none;
  color: var(--lms-text);
  min-width: 0;
}
a.ci-rail__row:hover {
  background: var(--lms-surface-2);
}
a.ci-rail__row:focus-visible {
  outline: 2px solid var(--lms-accent);
  outline-offset: 2px;
}
.ci-rail__row--current {
  background: var(--lms-surface-2);
  border-left-color: var(--lms-accent);
}
.ci-rail__dot {
  flex-shrink: 0;
  width: 0.7rem;
  height: 0.7rem;
  margin-top: 0.3rem;
  border-radius: var(--lms-radius-pill);
  background: var(--ci-dot, var(--lms-text-muted));
}
.ci-rail__label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.ci-rail__title {
  font-size: 0.9rem;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.ci-rail__row--current .ci-rail__title {
  font-weight: 700;
}
.ci-rail__status {
  font-size: 0.7rem;
  color: var(--lms-text-muted);
}
.ci-rail__count {
  margin: 0;
  padding-top: var(--lms-space-2);
  border-top: 1px solid var(--lms-border);
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--lms-text-muted);
}
`;

const TYPE_LABEL: Record<ContentItemType, string> = {
  lesson: "Lesson",
  assignment: "Assignment",
  quiz: "Quiz",
};

const TYPE_ACTION: Record<ContentItemType, string> = {
  lesson: "Mark lesson complete",
  assignment: "Open assignment",
  quiz: "Start quiz",
};

const STATUS_META: Record<
  ContentItemStatus,
  { label: string; tone: BadgeTone; dot: string }
> = {
  completed: { label: "Completed", tone: "success", dot: "var(--lms-success)" },
  in_progress: { label: "In progress", tone: "accent", dot: "var(--lms-accent)" },
  not_started: {
    label: "Not started",
    tone: "neutral",
    dot: "var(--lms-text-muted)",
  },
};

const TYPE_BODY: Record<ContentItemType, { heading: string; lines: string[] }> = {
  lesson: {
    heading: "Lesson",
    lines: [
      "Work through the reading below, then mark the lesson complete to track your progress.",
      "This is placeholder lesson content. Once the content service is wired in, the authored lesson body, media, and activities will render here.",
    ],
  },
  assignment: {
    heading: "Assignment",
    lines: [
      "Read the brief, complete your work, and submit before the due date.",
      "This is a placeholder assignment. Submission, rubric, and feedback will render here once the assignment service is connected.",
    ],
  },
  quiz: {
    heading: "Quiz",
    lines: [
      "Review the instructions, then start the quiz when you're ready.",
      "This is a placeholder quiz. Questions, timing, and scoring will render here once the assessment service is connected.",
    ],
  },
};

export default async function ContentItemPage({
  params,
}: {
  params: { courseId: string; itemId: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);
  const view = await getContentItem(
    params.courseId,
    params.itemId,
    session.userId,
    session.tenantId,
  );
  if (!view) notFound();

  const { course, module, item } = view;
  const status = STATUS_META[item.status];
  const body = TYPE_BODY[item.type];

  const siblings = module.items;
  const index = siblings.findIndex((sibling) => sibling.id === item.id);
  const position = index + 1;
  const total = siblings.length;
  const previous: ContentItem | undefined =
    index > 0 ? siblings[index - 1] : undefined;
  const next: ContentItem | undefined =
    index >= 0 && index < total - 1 ? siblings[index + 1] : undefined;

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{itemCss}</style>
      <Stack gap={4}>
        <Button href={`/courses/${course.id}`} size="sm" variant="ghost">
          ← Back to {course.title}
        </Button>

        <PageHeader
          title={item.title}
          subtitle={`${course.code} · ${module.title}`}
          actions={
            <Inline gap={2}>
              <Badge tone="neutral">{TYPE_LABEL[item.type]}</Badge>
              <Chip tone={status.tone}>{status.label}</Chip>
            </Inline>
          }
        />

        <div className="ci-grid">
          <div className="ci-reading">
            <Card>
              <Stack gap={4}>
                <div>
                  <h2 className="ci-section-heading">{body.heading}</h2>
                  <div className="ci-body">
                    {body.lines.map((line, lineIndex) => (
                      <p key={lineIndex}>{line}</p>
                    ))}
                  </div>
                </div>

                <Alert tone="info">
                  Full content coming soon. The content service isn&apos;t wired
                  up yet, so the authored body, media, and activities will appear
                  here once it&apos;s connected.
                </Alert>

                <div className="ci-action">
                  <Button
                    aria-label={`${TYPE_ACTION[item.type]} — available once the content service is connected`}
                    disabled
                  >
                    {TYPE_ACTION[item.type]}
                  </Button>
                </div>
              </Stack>
            </Card>

            <nav aria-label="Within-module navigation" className="ci-nav">
              <div className="ci-nav__slot ci-nav__slot--prev">
                {previous ? (
                  <a
                    className="ci-nav__link"
                    href={`/courses/${course.id}/items/${previous.id}`}
                  >
                    <span className="ci-nav__dir">← Previous</span>
                    <span className="ci-nav__title">{previous.title}</span>
                  </a>
                ) : (
                  <p className="ci-nav__empty">
                    You&apos;re at the start of this module.
                  </p>
                )}
              </div>
              <div className="ci-nav__slot ci-nav__slot--next">
                {next ? (
                  <a
                    className="ci-nav__link"
                    href={`/courses/${course.id}/items/${next.id}`}
                  >
                    <span className="ci-nav__dir">Next →</span>
                    <span className="ci-nav__title">{next.title}</span>
                  </a>
                ) : (
                  <p className="ci-nav__empty">
                    You&apos;re at the end of this module.
                  </p>
                )}
              </div>
            </nav>
          </div>

          <aside aria-label="In this module">
            <Card className="ci-rail">
              <div>
                <h2 className="ci-rail__heading">In this module</h2>
                <ul className="ci-rail__list">
                  {siblings.map((sibling) => {
                    const siblingStatus = STATUS_META[sibling.status];
                    const isCurrent = sibling.id === item.id;
                    const dotStyle = {
                      "--ci-dot": siblingStatus.dot,
                    } as CSSProperties;

                    const inner = (
                      <>
                        <span
                          aria-hidden="true"
                          className="ci-rail__dot"
                          style={dotStyle}
                        />
                        <span className="ci-rail__label">
                          <span className="ci-rail__title">{sibling.title}</span>
                          <span className="ci-rail__status">
                            {TYPE_LABEL[sibling.type]} · {siblingStatus.label}
                          </span>
                        </span>
                      </>
                    );

                    return (
                      <li key={sibling.id}>
                        {isCurrent ? (
                          <span
                            aria-current="page"
                            className="ci-rail__row ci-rail__row--current"
                          >
                            {inner}
                          </span>
                        ) : (
                          <a
                            className="ci-rail__row"
                            href={`/courses/${course.id}/items/${sibling.id}`}
                          >
                            {inner}
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
              {total > 0 ? (
                <p className="ci-rail__count">
                  Item {position} of {total}
                </p>
              ) : null}
            </Card>
          </aside>
        </div>
      </Stack>
    </AppShell>
  );
}
