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

import { getBranding } from "../../../lib/branding";
import { getSession } from "../../../lib/auth";
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

  if (!canTeach(session.roles)) {
    return (
      <AppShell brand={brand} actions={<SignOutButton />}>
        <Stack gap={4}>
          <Button href="/teach" size="sm" variant="ghost">
            ← Back to teaching
          </Button>
          <PageHeader
            title="Discussions"
            subtitle="Manage the forums for your course."
          />
          <Alert tone="info">
            Discussions are available to instructors. Your account does not
            currently hold a teaching role.
          </Alert>
        </Stack>
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
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{forumsCss}</style>
      <Stack gap={4}>
        <Button href="/teach" size="sm" variant="ghost">
          ← Back to teaching
        </Button>

        <PageHeader
          title="Discussions"
          subtitle={`Forums for ${course.title}.`}
          actions={<Button href={`${base}/new`}>New forum</Button>}
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        {!result.ok ? (
          <Alert tone="warning">{result.error}</Alert>
        ) : result.forums.length === 0 ? (
          <EmptyState
            icon="💬"
            title="No forums yet"
            description="Create a forum to start course discussions."
          />
        ) : (
          <ul className="fd-list">
            {result.forums.map((forum) => (
              <li key={forum.id}>
                <Card>
                  <div className="fd-row">
                    <div className="fd-main">
                      <span className="fd-icon" aria-hidden="true">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
                        </svg>
                      </span>
                      <h2 className="fd-title">{forum.title}</h2>
                    </div>
                    <Button href={`${base}/${forum.id}`} variant="secondary">
                      Open topics
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
