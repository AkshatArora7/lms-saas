import { notFound, redirect } from "next/navigation";
import {
  Alert,
  AppShell,
  Button,
  Card,
  Field,
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
.asg-danger {
  border: 1px solid var(--lms-danger);
}
.asg-danger-row {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-3);
}
@media (min-width: 600px) {
  .asg-danger-row {
    align-items: center;
    flex-direction: row;
    justify-content: space-between;
  }
}
.asg-danger-copy {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-1);
}
.asg-danger-title {
  color: var(--lms-danger);
  font-weight: 600;
  margin: 0;
}
.asg-danger-text {
  color: var(--lms-text-muted);
  margin: 0;
  overflow-wrap: anywhere;
}
`;

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
      <style>{formCss}</style>
      <Stack gap={4}>
        <Button className="asg-back" href={base} size="sm" variant="ghost">
          ← Back to roster
        </Button>

        <PageHeader title="Change role" subtitle={enrollment.userId} />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        <Card className="asg-form-card">
          <form action={updateRoleAction} className="asg-form">
            <input name="courseId" type="hidden" value={courseId} />
            <input name="id" type="hidden" value={enrollment.id} />

            <section className="asg-section">
              <div className="asg-section-head">
                <h2 className="asg-section-title">Role</h2>
                <p className="asg-section-hint">
                  Choose the role this member should hold in the course.
                </p>
              </div>
              <Field htmlFor="role" label="Role" required>
                <Select name="role" defaultValue={enrollment.role} required>
                  {roleOptions.map((role) => (
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
              <Button type="submit">Save role</Button>
            </div>
          </form>
        </Card>

        <Card className="asg-danger">
          <div className="asg-danger-row">
            <div className="asg-danger-copy">
              <p className="asg-danger-title">Danger zone</p>
              <p className="asg-danger-text">
                Dropping a member withdraws them from this course. This removes
                them from the active roster.
              </p>
            </div>
            <form action={dropEnrollmentAction}>
              <input name="courseId" type="hidden" value={courseId} />
              <input name="id" type="hidden" value={enrollment.id} />
              <Button type="submit" variant="danger">
                Drop member
              </Button>
            </form>
          </div>
        </Card>
      </Stack>
    </AppShell>
  );
}
