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
} from "@lms/ui";

import { getBranding } from "../../../../lib/branding";
import { getSession } from "../../../../lib/auth";
import { canTeach, getTaughtCourses } from "../../../../lib/teaching";
import { ASSIGNABLE_ROLES } from "../../../../lib/enrollment-api";
import SignOutButton from "../../../../sign-out-button";
import { enrollUserAction } from "../actions";

const ROLE_LABEL: Record<string, string> = {
  learner: "Learner",
  teaching_assistant: "Teaching assistant",
  instructor: "Instructor",
  observer: "Observer",
};

export default async function EnrollLearner({
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
          subtitle="Your account cannot manage the roster."
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

  const base = `/teach/${courseId}/roster`;

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <Stack gap={4}>
        <Button href={base} size="sm" variant="ghost">
          {"<- Back to roster"}
        </Button>

        <PageHeader
          title="Enroll learner"
          subtitle={`Add a member to ${course.title}.`}
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        <Card>
          <form action={enrollUserAction}>
            <input name="courseId" type="hidden" value={courseId} />
            <Stack gap={4}>
              <Field
                htmlFor="userId"
                label="User id"
                help="The learner's user id or username"
                required
              >
                <Input name="userId" placeholder="e.g. ada.lovelace" required />
              </Field>
              <Field htmlFor="role" label="Role" required>
                <Select name="role" defaultValue="learner" required>
                  {ASSIGNABLE_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABEL[role] ?? role}
                    </option>
                  ))}
                </Select>
              </Field>
              <Inline gap={2}>
                <Button type="submit">Enroll</Button>
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
