import { notFound, redirect } from "next/navigation";
import type { CSSProperties } from "react";
import {
  AppShell,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  Grid,
  Inline,
  PageHeader,
  ProgressBar,
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
import SignOutButton from "../../sign-out-button";

const headingStyle: CSSProperties = {
  fontSize: "1rem",
  lineHeight: 1.3,
  margin: 0,
  overflowWrap: "anywhere",
};

const bodyTextStyle: CSSProperties = {
  margin: 0,
  overflowWrap: "anywhere",
};

const itemTitleStyle: CSSProperties = {
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

export default async function CoursePage({
  params,
}: {
  params: { courseId: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);
  const course = getCourseDetail(params.courseId, session.tenantId);
  if (!course) notFound();

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <Stack gap={4}>
        <Button href="/" size="sm" variant="ghost">
          ← Back to dashboard
        </Button>

        <PageHeader
          title={course.title}
          subtitle={course.description}
          actions={
            <Inline gap={2}>
              <Badge tone="neutral">{course.code}</Badge>
              <Badge tone="neutral">{course.term}</Badge>
              <Chip tone="accent">{course.role}</Chip>
            </Inline>
          }
        />

        <Grid gap={5} min="280px">
          <section aria-labelledby="modules-heading">
            <Stack gap={3}>
              <h2 id="modules-heading" style={headingStyle}>
                Course content
              </h2>
              {course.modules.length ? (
                <Stack gap={4}>
                  {course.modules.map((module) => (
                    <Card key={module.id}>
                      <Stack gap={3}>
                        <h3 style={headingStyle}>{module.title}</h3>
                        <Stack gap={2}>
                          {module.items.map((item) => {
                            const status = STATUS_META[item.status];
                            return (
                              <Inline
                                align="center"
                                gap={2}
                                justify="space-between"
                                key={item.id}
                              >
                                <Inline align="center" gap={2}>
                                  <Badge tone="neutral">
                                    {TYPE_LABEL[item.type]}
                                  </Badge>
                                  <p style={itemTitleStyle}>{item.title}</p>
                                </Inline>
                                <Chip tone={status.tone}>{status.label}</Chip>
                              </Inline>
                            );
                          })}
                        </Stack>
                      </Stack>
                    </Card>
                  ))}
                </Stack>
              ) : (
                <EmptyState
                  description="Content for this course hasn't been published yet."
                  icon="📖"
                  title="No modules yet"
                />
              )}
            </Stack>
          </section>

          <aside aria-labelledby="overview-heading">
            <Card>
              <Stack gap={3}>
                <h2 id="overview-heading" style={headingStyle}>
                  Overview
                </h2>
                <ProgressBar
                  label={`${course.title} progress`}
                  value={course.progress}
                />
                <Badge tone="accent">{course.progress}% complete</Badge>
                <Stack gap={1}>
                  <p style={bodyTextStyle}>
                    <strong>Instructor:</strong> {course.instructor}
                  </p>
                  <p style={bodyTextStyle}>
                    <strong>Term:</strong> {course.term}
                  </p>
                  <p style={bodyTextStyle}>
                    <strong>Course code:</strong> {course.code}
                  </p>
                </Stack>
              </Stack>
            </Card>
          </aside>
        </Grid>
      </Stack>
    </AppShell>
  );
}
