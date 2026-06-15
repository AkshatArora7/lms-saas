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
  Select,
  Stack,
  Textarea,
} from "@lms/ui";

import { getBranding } from "../../../../lib/branding";
import { getSession } from "../../../../lib/auth";
import { canTeach, getTaughtCourses } from "../../../../lib/teaching";
import SignOutButton from "../../../../sign-out-button";
import { createAssignmentAction } from "../actions";

export default async function NewAssignment({
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
          subtitle="Your account cannot manage assignments."
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

  const base = `/teach/${courseId}/assignments`;

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <Stack gap={4}>
        <Button href={base} size="sm" variant="ghost">
          {"<- Back to assignments"}
        </Button>

        <PageHeader
          title="New assignment"
          subtitle={`Add an assignment to ${course.title}.`}
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        <Card>
          <form action={createAssignmentAction}>
            <input name="courseId" type="hidden" value={courseId} />
            <Stack gap={4}>
              <Field htmlFor="title" label="Title" required>
                <Input name="title" placeholder="e.g. Chapter 3 quiz" required />
              </Field>
              <Field htmlFor="instructions" label="Instructions">
                <Textarea
                  name="instructions"
                  placeholder="What learners need to do"
                  rows={3}
                />
              </Field>
              <Inline gap={3}>
                <Field htmlFor="dueAt" label="Due date">
                  <Input name="dueAt" type="date" />
                </Field>
                <Field htmlFor="points" label="Points">
                  <Input name="points" type="number" defaultValue="100" />
                </Field>
              </Inline>
              <Field htmlFor="submissionType" label="Submission type">
                <Select name="submissionType" defaultValue="file">
                  <option value="file">File upload</option>
                  <option value="text">Text entry</option>
                  <option value="url">URL</option>
                  <option value="none">No submission</option>
                </Select>
              </Field>
              <label>
                <Inline gap={2}>
                  <input defaultChecked name="allowLate" type="checkbox" />
                  <span>Allow late submissions</span>
                </Inline>
              </label>
              <Inline gap={2}>
                <Button type="submit">Create assignment</Button>
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
