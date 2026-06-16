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

import { getBranding } from "../../../../lib/branding";
import { getSession } from "../../../../lib/auth";
import { canTeach, getTaughtCourses } from "../../../../lib/teaching";
import SignOutButton from "../../../../sign-out-button";
import { createAnnouncementAction } from "../actions";

export default async function NewAnnouncement({
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
          subtitle="Your account cannot manage announcements."
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

  const base = `/teach/${courseId}/announcements`;

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <Stack gap={4}>
        <Button href={base} size="sm" variant="ghost">
          {"<- Back to announcements"}
        </Button>

        <PageHeader
          title="New announcement"
          subtitle={`Post an announcement to ${course.title}. Leave the publish time blank to post immediately.`}
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        <Card>
          <form action={createAnnouncementAction}>
            <input name="courseId" type="hidden" value={courseId} />
            <Stack gap={4}>
              <Field htmlFor="title" label="Title" required>
                <Input
                  name="title"
                  placeholder="e.g. Unit 1 quiz is live"
                  required
                />
              </Field>
              <Field htmlFor="body" label="Message" required>
                <Textarea
                  name="body"
                  placeholder="What you want learners to know"
                  required
                  rows={4}
                />
              </Field>
              <Inline gap={3}>
                <Field
                  htmlFor="publishAt"
                  label="Publish at"
                  help="Leave blank to publish now"
                >
                  <Input name="publishAt" type="datetime-local" />
                </Field>
                <Field
                  htmlFor="expiresAt"
                  label="Expires at"
                  help="Optional"
                >
                  <Input name="expiresAt" type="datetime-local" />
                </Field>
              </Inline>
              <Inline gap={2}>
                <Button type="submit">Post announcement</Button>
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
