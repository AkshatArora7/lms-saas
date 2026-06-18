import { notFound, redirect } from "next/navigation";
import {
  Alert,
  AppShell,
  Button,
  Card,
  Field,
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

const formCss = `
.asg-back {
  align-self: flex-start;
}
.asg-form-card {
  padding: var(--lms-space-5);
}
.asg-form {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-5);
}
.asg-section {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-4);
}
.asg-section-head {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-1);
}
.asg-section-title {
  font-size: 0.95rem;
  font-weight: 600;
  margin: 0;
}
.asg-section-hint {
  color: var(--lms-text-muted);
  font-size: 0.875rem;
  margin: 0;
  overflow-wrap: anywhere;
}
.asg-actionbar {
  border-top: 1px solid var(--lms-border);
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2);
  justify-content: flex-end;
  padding-top: var(--lms-space-4);
}
@media (max-width: 599px) {
  .asg-actionbar {
    justify-content: stretch;
  }
  .asg-actionbar .lms-btn {
    flex: 1 1 auto;
    text-align: center;
  }
}
`;

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
      <style>{formCss}</style>
      <Stack gap={4}>
        <Button className="asg-back" href={base} size="sm" variant="ghost">
          ← Back to roster
        </Button>

        <PageHeader
          title="Enroll learner"
          subtitle={`Add a member to ${course.title}.`}
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        <Card className="asg-form-card">
          <form action={enrollUserAction} className="asg-form">
            <input name="courseId" type="hidden" value={courseId} />

            <section className="asg-section">
              <div className="asg-section-head">
                <h2 className="asg-section-title">Member</h2>
                <p className="asg-section-hint">
                  Add a member by their user id and choose the role they should
                  hold in this course.
                </p>
              </div>
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
            </section>

            <div className="asg-actionbar">
              <Button href={base} variant="ghost">
                Cancel
              </Button>
              <Button type="submit">Enroll</Button>
            </div>
          </form>
        </Card>
      </Stack>
    </AppShell>
  );
}
