import { notFound, redirect } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Stack,
} from "@lms/ui";
import { getMessages, t } from "@lms/i18n";

import { getBranding } from "../../../../lib/branding";
import { getSession } from "../../../../lib/auth";
import { resolveRequestLocale } from "../../../../lib/i18n";
import { AppLocaleSwitcher } from "../../../../lib/locale-switcher";
import { AppShell, DiscussionsIcon } from "../../../../lib/ui";
import { canTeach, getTaughtCourse } from "../../../../lib/teaching";
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
  const m = getMessages(await resolveRequestLocale());

  const shellActions = (
    <>
      <AppLocaleSwitcher />
      <SignOutButton />
    </>
  );

  if (!canTeach(session.roles)) {
    return (
      <AppShell actions={shellActions} brand={brand}>
        <PageHeader
          subtitle={t(m, "teach.notAuthorizedSubtitle")}
          title={t(m, "teach.notAuthorizedTitle")}
        />
        <Alert tone="warning">
          <strong>{session.userId}</strong> — {t(m, "teach.notAuthorizedBody")}
        </Alert>
      </AppShell>
    );
  }

  const { courseId, forumId } = params;
  const course = await getTaughtCourse(session.userId, courseId, session.tenantId);
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
    <AppShell actions={shellActions} brand={brand}>
      <style>{topicsCss}</style>
      <Stack gap={4}>
        <Button href={discussionsBase} size="sm" variant="ghost">
          {t(m, "teach.forum.backToForums")}
        </Button>

        <PageHeader
          title={forum ? forum.title : t(m, "teach.forum.fallbackTitle")}
          subtitle={t(m, "teach.forum.subtitle", { course: course.title })}
          actions={
            <Button href={`${base}/new`}>{t(m, "teach.forum.newTopic")}</Button>
          }
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        {!forumsResult.ok ? (
          <Alert tone="warning">{forumsResult.error}</Alert>
        ) : !topicsResult.ok ? (
          <Alert tone="warning">{topicsResult.error}</Alert>
        ) : topicsResult.topics.length === 0 ? (
          <EmptyState
            description={t(m, "teach.forum.emptyBody")}
            icon={<DiscussionsIcon />}
            title={t(m, "teach.forum.emptyTitle")}
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
                      {t(m, "teach.forum.openThread")}
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
