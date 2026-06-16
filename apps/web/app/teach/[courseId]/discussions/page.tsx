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

import { getBranding } from "../../../lib/branding";
import { getSession } from "../../../lib/auth";
import { canTeach, getTaughtCourses } from "../../../lib/teaching";
import { listForums } from "../../../lib/discussions-api";
import SignOutButton from "../../../sign-out-button";

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

  const { courseId } = params;
  const course = getTaughtCourses(session.tenantId).find(
    (c) => c.id === courseId,
  );
  if (!course) notFound();

  const errorMessage = Array.isArray(searchParams.error)
    ? searchParams.error[0]
    : searchParams.error;

  const base = `/teach/${courseId}/discussions`;
  const result = await listForums(courseId, session.tenantId);

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <Stack gap={4}>
        <Button href="/teach" size="sm" variant="ghost">
          {"<- Back to teaching"}
        </Button>

        <Inline gap={3} align="center" justify="space-between">
          <PageHeader
            title="Discussions"
            subtitle={`Forums for ${course.title}.`}
          />
          <Button href={`${base}/new`}>New forum</Button>
        </Inline>

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        {!result.ok ? (
          <Alert tone="warning">{result.error}</Alert>
        ) : result.forums.length === 0 ? (
          <EmptyState
            title="No forums yet"
            description="Create a forum to start course discussions."
          />
        ) : (
          <Stack gap={3}>
            {result.forums.map((forum) => (
              <Card key={forum.id}>
                <Inline gap={3} align="center" justify="space-between">
                  <Stack gap={1}>
                    <strong style={{ fontSize: 16 }}>{forum.title}</strong>
                  </Stack>
                  <Button href={`${base}/${forum.id}`} variant="secondary">
                    Open topics
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
