import { redirect } from "next/navigation";
import {
  Alert,
  AppShell,
  Button,
  Card,
  Chip,
  Field,
  Inline,
  Input,
  PageHeader,
  Stack,
  Textarea,
} from "@lms/ui";

import { getBranding } from "../../../lib/branding";
import { getSession, isAdmin } from "../../../lib/auth";
import { getCourse } from "../../../lib/courses-api";
import SignOutButton from "../../../sign-out-button";
import {
  deleteCourseAction,
  publishCourseAction,
  updateCourseAction,
} from "../../actions";

function toDateInput(value: string | null): string | undefined {
  if (!value) return undefined;
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : undefined;
}

export default async function EditCourse({
  params,
  searchParams,
}: {
  params: { id: string };
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

  const result = await getCourse(params.id, session.tenantId);

  if (!result.ok) {
    return (
      <AppShell brand={brand} actions={<SignOutButton />}>
        <Stack gap={4}>
          <Button href="/courses" size="sm" variant="ghost">
            {"<- Back to catalogue"}
          </Button>
          <PageHeader title="Course unavailable" />
          <Alert tone="warning">{result.error}</Alert>
        </Stack>
      </AppShell>
    );
  }

  const course = result.course;

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <Stack gap={4}>
        <Button href="/courses" size="sm" variant="ghost">
          {"<- Back to catalogue"}
        </Button>

        <PageHeader
          title="Edit course"
          subtitle={course.title}
          actions={
            <Chip tone={course.isPublished ? "success" : "warning"}>
              {course.isPublished ? "Published" : "Draft"}
            </Chip>
          }
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        <Card>
          <form action={updateCourseAction}>
            <Stack gap={4}>
              <input name="id" type="hidden" value={course.id} />
              <Field htmlFor="title" label="Title" required>
                <Input
                  name="title"
                  defaultValue={course.title}
                  required
                />
              </Field>
              <Field htmlFor="description" label="Description">
                <Textarea
                  name="description"
                  defaultValue={course.description ?? undefined}
                  rows={3}
                />
              </Field>
              <Inline gap={3}>
                <Field htmlFor="startDate" label="Start date">
                  <Input
                    name="startDate"
                    type="date"
                    defaultValue={toDateInput(course.startDate)}
                  />
                </Field>
                <Field htmlFor="endDate" label="End date">
                  <Input
                    name="endDate"
                    type="date"
                    defaultValue={toDateInput(course.endDate)}
                  />
                </Field>
              </Inline>
              <Inline gap={2}>
                <Button type="submit">Save changes</Button>
                <Button href="/courses" variant="ghost">
                  Cancel
                </Button>
              </Inline>
            </Stack>
          </form>
        </Card>

        <Card>
          <Stack gap={3}>
            <h2 style={{ fontSize: "16px", margin: 0 }}>Lifecycle</h2>
            <Inline gap={2}>
              {!course.isPublished ? (
                <form action={publishCourseAction}>
                  <input name="id" type="hidden" value={course.id} />
                  <Button type="submit">Publish course</Button>
                </form>
              ) : (
                <Alert tone="success">This course is published.</Alert>
              )}
              <form action={deleteCourseAction}>
                <input name="id" type="hidden" value={course.id} />
                <Button type="submit" variant="danger">
                  Delete course
                </Button>
              </form>
            </Inline>
          </Stack>
        </Card>
      </Stack>
    </AppShell>
  );
}
