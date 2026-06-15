import { notFound, redirect } from "next/navigation";
import type { CSSProperties } from "react";
import {
  AppShell,
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
  type ContentItemStatus,
  type ContentItemType,
} from "../../../../lib/dashboard";
import SignOutButton from "../../../../sign-out-button";

const bodyTextStyle: CSSProperties = {
  margin: 0,
  overflowWrap: "anywhere",
};

const headingStyle: CSSProperties = {
  fontSize: "1rem",
  lineHeight: 1.3,
  margin: 0,
  overflowWrap: "anywhere",
};

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
  const view = getContentItem(params.courseId, params.itemId, session.tenantId);
  if (!view) notFound();

  const { course, module, item } = view;
  const status = STATUS_META[item.status];
  const body = TYPE_BODY[item.type];

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
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

        <Card>
          <Stack gap={3}>
            <h2 style={headingStyle}>{body.heading}</h2>
            {body.lines.map((line, index) => (
              <p key={index} style={bodyTextStyle}>
                {line}
              </p>
            ))}
          </Stack>
        </Card>
      </Stack>
    </AppShell>
  );
}
