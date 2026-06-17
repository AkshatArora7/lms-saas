import { notFound, redirect } from "next/navigation";
import {
  Alert,
  AppShell,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Stack,
} from "@lms/ui";

import { getBranding } from "../../../../lib/branding";
import { getSession } from "../../../../lib/auth";
import { canTeach, getTaughtCourses } from "../../../../lib/teaching";
import { listForums, listTopics } from "../../../../lib/discussions-api";
import SignOutButton from "../../../../sign-out-button";

const topicsCss = `
.td-list {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-3);
  list-style: none;
  margin: 0;
  padding: 0;
}
.td-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2) var(--lms-space-3);
  justify-content: space-between;
}
.td-main {
  min-width: 0;
}
.td-title {
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.3;
  margin: 0;
  overflow-wrap: anywhere;
}
.td-desc {
  color: var(--lms-text-muted);
  margin: var(--lms-space-1) 0 0;
  overflow-wrap: anywhere;
}
`;

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
        <Stack gap={4}>
          <Button href="/teach" size="sm" variant="ghost">
            ← Back to teaching
          </Button>
          <PageHeader
            title="Discussions"
            subtitle="Manage the topics in this forum."
          />
          <Alert tone="info">
            Discussions are available to instructors. Your account does not
            currently hold a teaching role.
          </Alert>
        </Stack>
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
      <style>{topicsCss}</style>
      <Stack gap={4}>
        <Button href={discussionsBase} size="sm" variant="ghost">
          ← Back to forums
        </Button>

        <PageHeader
          title={forum ? forum.title : "Forum"}
          subtitle={`Topics in ${course.title}.`}
          actions={<Button href={`${base}/new`}>New topic</Button>}
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        {!forumsResult.ok ? (
          <Alert tone="warning">{forumsResult.error}</Alert>
        ) : !topicsResult.ok ? (
          <Alert tone="warning">{topicsResult.error}</Alert>
        ) : topicsResult.topics.length === 0 ? (
          <EmptyState
            icon="💬"
            title="No topics yet"
            description="Create a topic to start a thread."
          />
        ) : (
          <ul className="td-list">
            {topicsResult.topics.map((topic) => (
              <li key={topic.id}>
                <Card>
                  <div className="td-row">
                    <div className="td-main">
                      <h2 className="td-title">{topic.title}</h2>
                      {topic.description ? (
                        <p className="td-desc">{topic.description}</p>
                      ) : null}
                    </div>
                    <Button href={`${base}/${topic.id}`} variant="secondary">
                      Open thread
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Stack>
    </AppShell>
  );
}
