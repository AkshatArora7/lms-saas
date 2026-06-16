import { notFound, redirect } from "next/navigation";
import {
  Alert,
  AppShell,
  Button,
  Card,
  Field,
  Inline,
  Input,
  PageHeader,
  Stack,
  Textarea,
} from "@lms/ui";

import { getBranding } from "../../../../../lib/branding";
import { getSession } from "../../../../../lib/auth";
import { canTeach, getTaughtCourses } from "../../../../../lib/teaching";
import { listForums } from "../../../../../lib/discussions-api";
import SignOutButton from "../../../../../sign-out-button";
import { createTopicAction } from "../../actions";

export default async function NewTopicPage({
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

  const forumsResult = await listForums(courseId, session.tenantId);
  const forum = forumsResult.ok
    ? forumsResult.forums.find((f) => f.id === forumId)
    : undefined;
  if (forumsResult.ok && !forum) notFound();

  const errorMessage = Array.isArray(searchParams.error)
    ? searchParams.error[0]
    : searchParams.error;

  const base = `/teach/${courseId}/discussions/${forumId}`;

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <Stack gap={4}>
        <Button href={base} size="sm" variant="ghost">
          {"<- Back to topics"}
        </Button>

        <PageHeader
          title="New topic"
          subtitle={forum ? `In ${forum.title}.` : undefined}
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        <Card>
          <form action={createTopicAction}>
            <input name="courseId" type="hidden" value={courseId} />
            <input name="forumId" type="hidden" value={forumId} />
            <Stack gap={4}>
              <Field htmlFor="title" label="Topic title" required>
                <Input
                  name="title"
                  placeholder="e.g. Week 1: Linear equations"
                  required
                />
              </Field>
              <Field
                htmlFor="description"
                label="Description"
                help="Optional context for the thread"
              >
                <Textarea name="description" rows={3} />
              </Field>
              <Inline gap={2}>
                <Button type="submit">Create topic</Button>
                <Button href={base} variant="ghost">
                  Cancel
                </Button>
              </Inline>
            </Stack>
          </form>
        </Card>
      </Stack>
    </AppShell>
  );
}
