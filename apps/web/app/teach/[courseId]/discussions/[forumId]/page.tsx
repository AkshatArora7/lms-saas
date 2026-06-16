import { notFound, redirect } from "next/navigation";
import {
  Alert,
  AppShell,
  Button,
  Card,
  EmptyState,
  Inline,
  PageHeader,
  Stack,
} from "@lms/ui";

import { getBranding } from "../../../../lib/branding";
import { getSession } from "../../../../lib/auth";
import { canTeach, getTaughtCourses } from "../../../../lib/teaching";
import { listForums, listTopics } from "../../../../lib/discussions-api";
import SignOutButton from "../../../../sign-out-button";

export default async function ForumTopicsPage({
  params,
  searchParams,
}: {
  params: { courseId: string; forumId: string };
  searchParams: { error?: string | string[] };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);

  if (!canTeach(session.roles)) {
    return (
      <AppShell brand={brand} actions={<SignOutButton />}>
        <PageHeader
          title="Not authorized"
          subtitle="Your account cannot manage discussions."
        />
        <Alert tone="warning">
          You are signed in as <strong>{session.userId}</strong>, but your
          account does not hold a teaching role.
        </Alert>
      </AppShell>
    );
  }

  const { courseId, forumId } = params;
  const course = getTaughtCourses(session.tenantId).find(
    (c) => c.id === courseId,
  );
  if (!course) notFound();

  const errorMessage = Array.isArray(searchParams.error)
    ? searchParams.error[0]
    : searchParams.error;

  const discussionsBase = `/teach/${courseId}/discussions`;
  const base = `${discussionsBase}/${forumId}`;

  const forumsResult = await listForums(courseId, session.tenantId);
  const forum = forumsResult.ok
    ? forumsResult.forums.find((f) => f.id === forumId)
    : undefined;
  // Tenant-scope check: the forum must belong to this course.
  if (forumsResult.ok && !forum) notFound();

  const topicsResult = await listTopics(forumId, session.tenantId);

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <Stack gap={4}>
        <Button href={discussionsBase} size="sm" variant="ghost">
          {"<- Back to forums"}
        </Button>

        <Inline gap={3} align="center" justify="space-between">
          <PageHeader
            title={forum ? forum.title : "Forum"}
            subtitle={`Topics in ${course.title}.`}
          />
          <Button href={`${base}/new`}>New topic</Button>
        </Inline>

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        {!forumsResult.ok ? (
          <Alert tone="warning">{forumsResult.error}</Alert>
        ) : !topicsResult.ok ? (
          <Alert tone="warning">{topicsResult.error}</Alert>
        ) : topicsResult.topics.length === 0 ? (
          <EmptyState
            title="No topics yet"
            description="Create a topic to start a thread."
          />
        ) : (
          <Stack gap={3}>
            {topicsResult.topics.map((topic) => (
              <Card key={topic.id}>
                <Inline gap={3} align="center" justify="space-between">
                  <Stack gap={1}>
                    <strong style={{ fontSize: 16 }}>{topic.title}</strong>
                    {topic.description ? (
                      <span style={{ color: "var(--lms-text-muted)" }}>
                        {topic.description}
                      </span>
                    ) : null}
                  </Stack>
                  <Button
                    href={`${base}/${topic.id}`}
                    variant="secondary"
                  >
                    Open thread
                  </Button>
                </Inline>
              </Card>
            ))}
          </Stack>
        )}
      </Stack>
    </AppShell>
  );
}
