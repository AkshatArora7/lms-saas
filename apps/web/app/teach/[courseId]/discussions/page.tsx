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

import { getBranding } from "../../../lib/branding";
import { getSession } from "../../../lib/auth";
import { resolveRequestLocale } from "../../../lib/i18n";
import { AppLocaleSwitcher } from "../../../lib/locale-switcher";
import { AppShell, DiscussionsIcon } from "../../../lib/ui";
import { canTeach, getTaughtCourse } from "../../../lib/teaching";
import { listForums } from "../../../lib/discussions-api";
import SignOutButton from "../../../sign-out-button";

const forumsCss = `
.fd-list {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-3);
  list-style: none;
  margin: 0;
  padding: 0;
}
.fd-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2) var(--lms-space-3);
  justify-content: space-between;
}
.fd-main {
  align-items: center;
  display: flex;
  gap: var(--lms-space-3);
  min-width: 0;
}
.fd-icon {
  align-items: center;
  background: var(--lms-accent-soft);
  border-radius: var(--lms-radius-pill);
  color: var(--lms-accent);
  display: inline-flex;
  flex: none;
  height: 2.5rem;
  justify-content: center;
  width: 2.5rem;
}
.fd-icon svg {
  display: block;
  height: 1.25rem;
  width: 1.25rem;
}
.fd-title {
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.3;
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
`;

export default async function DiscussionsPage({
  params,
  searchParams,
}: {
  params: { courseId: string };
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

  const { courseId } = params;
  const course = await getTaughtCourse(session.userId, courseId, session.tenantId);
  if (!course) notFound();

  const errorMessage = Array.isArray(searchParams.error)
    ? searchParams.error[0]
    : searchParams.error;

  const base = `/teach/${courseId}/discussions`;
  const result = await listForums(courseId, session.tenantId);

  return (
    <AppShell actions={shellActions} brand={brand}>
      <style>{forumsCss}</style>
      <Stack gap={4}>
        <Button href="/teach" size="sm" variant="ghost">
          {t(m, "teach.discussions.backToTeaching")}
        </Button>

        <PageHeader
          title={t(m, "teach.discussions.title")}
          subtitle={t(m, "teach.discussions.subtitle", { course: course.title })}
          actions={
            <Button href={`${base}/new`}>
              {t(m, "teach.discussions.newForum")}
            </Button>
          }
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        {!result.ok ? (
          <Alert tone="warning">{result.error}</Alert>
        ) : result.forums.length === 0 ? (
          <EmptyState
            description={t(m, "teach.discussions.emptyBody")}
            icon={<DiscussionsIcon />}
            title={t(m, "teach.discussions.emptyTitle")}
          />
        ) : (
          <ul className="fd-list">
            {result.forums.map((forum) => (
              <li key={forum.id}>
                <Card>
                  <div className="fd-row">
                    <div className="fd-main">
                      <span className="fd-icon" aria-hidden="true">
                        <DiscussionsIcon />
                      </span>
                      <h2 className="fd-title">{forum.title}</h2>
                    </div>
                    <Button href={`${base}/${forum.id}`} variant="secondary">
                      {t(m, "teach.discussions.openTopics")}
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
