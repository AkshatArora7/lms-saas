import { redirect } from "next/navigation";
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

import { getBranding } from "../../lib/branding";
import { getSession, isAdmin } from "../../lib/auth";
import SignOutButton from "../../sign-out-button";
import { createCourseAction } from "../actions";

export default async function NewCourse({
  searchParams,
}: {
  searchParams: { error?: string | string[] };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const brand = getBranding(session.tenantId);

  if (!isAdmin(session)) {
    return (
      <AppShell brand={brand} actions={<SignOutButton />}>
        <PageHeader
          title="Not authorized"
          subtitle="Your account cannot access the administration console."
        />
        <Alert tone="warning">
          You are signed in as <strong>{session.userId}</strong>, but your
          account does not hold an administrator role.
        </Alert>
      </AppShell>
    );
  }

  const errorMessage = Array.isArray(searchParams.error)
    ? searchParams.error[0]
    : searchParams.error;

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <Stack gap={4}>
        <Button href="/courses" size="sm" variant="ghost">
          {"<- Back to catalogue"}
        </Button>

        <PageHeader
          title="New course"
          subtitle="Add a course to this tenant. It starts as a draft until you publish it."
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        <Card>
          <form action={createCourseAction}>
            <Stack gap={4}>
              <Field htmlFor="title" label="Title" required>
                <Input name="title" placeholder="e.g. Algebra I" required />
              </Field>
              <Field htmlFor="description" label="Description">
                <Textarea
                  name="description"
                  placeholder="What this course covers"
                  rows={3}
                />
              </Field>
              <Inline gap={3}>
                <Field htmlFor="startDate" label="Start date">
                  <Input name="startDate" type="date" />
                </Field>
                <Field htmlFor="endDate" label="End date">
                  <Input name="endDate" type="date" />
                </Field>
              </Inline>
              <Inline gap={2}>
                <Button type="submit">Create course</Button>
                <Button href="/courses" variant="ghost">
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
