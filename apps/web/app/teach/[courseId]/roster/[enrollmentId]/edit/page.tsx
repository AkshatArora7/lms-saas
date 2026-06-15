import { notFound, redirect } from "next/navigation";
import {
  Alert,
  AppShell,
  Button,
  Card,
  Field,
  Inline,
  PageHeader,
  Select,
  Stack,
} from "@lms/ui";

import { getBranding } from "../../../../../lib/branding";
import { getSession } from "../../../../../lib/auth";
import { canTeach } from "../../../../../lib/teaching";
import {
  ASSIGNABLE_ROLES,
  getEnrollment,
} from "../../../../../lib/enrollment-api";
import SignOutButton from "../../../../../sign-out-button";
import { dropEnrollmentAction, updateRoleAction } from "../../actions";

const ROLE_LABEL: Record<string, string> = {
  learner: "Learner",
  teaching_assistant: "Teaching assistant",
  instructor: "Instructor",
  observer: "Observer",
};

export default async function EditRosterMember({
  params,
  searchParams,
}: {
  params: { courseId: string; enrollmentId: string };
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

  const { courseId, enrollmentId } = params;
  const base = `/teach/${courseId}/roster`;

  const result = await getEnrollment(enrollmentId, session.tenantId);
  if (!result.ok) notFound();
  const enrollment = result.enrollment;

  const errorMessage = Array.isArray(searchParams.error)
    ? searchParams.error[0]
    : searchParams.error;

  // Keep the current role selectable even if it is outside the standard set.
  const roleOptions = ASSIGNABLE_ROLES.includes(
    enrollment.role as (typeof ASSIGNABLE_ROLES)[number],
  )
    ? ASSIGNABLE_ROLES
    : [enrollment.role, ...ASSIGNABLE_ROLES];

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <Stack gap={4}>
        <Button href={base} size="sm" variant="ghost">
          {"<- Back to roster"}
        </Button>

        <PageHeader title="Change role" subtitle={enrollment.userId} />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        <Card>
          <form action={updateRoleAction}>
            <input name="courseId" type="hidden" value={courseId} />
            <input name="id" type="hidden" value={enrollment.id} />
            <Stack gap={4}>
              <Field htmlFor="role" label="Role" required>
                <Select name="role" defaultValue={enrollment.role} required>
                  {roleOptions.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABEL[role] ?? role}
                    </option>
                  ))}
                </Select>
              </Field>
              <Inline gap={2}>
                <Button type="submit">Save role</Button>
                <Button href={base} variant="ghost">
                  Cancel
                </Button>
              </Inline>
            </Stack>
          </form>
        </Card>

        <Card>
          <Stack gap={3}>
            <p style={{ margin: 0 }}>
              Dropping a member withdraws them from this course. This removes
              them from the active roster.
            </p>
            <form action={dropEnrollmentAction}>
              <input name="courseId" type="hidden" value={courseId} />
              <input name="id" type="hidden" value={enrollment.id} />
              <Button type="submit" variant="danger">
                Drop member
              </Button>
            </form>
          </Stack>
        </Card>
      </Stack>
    </AppShell>
  );
}
