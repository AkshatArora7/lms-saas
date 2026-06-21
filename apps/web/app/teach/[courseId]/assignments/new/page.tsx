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
  Textarea,
} from "@lms/ui";

import { getBranding } from "../../../../lib/branding";
import { getSession } from "../../../../lib/auth";
import { canTeach, getTaughtCourse } from "../../../../lib/teaching";
import SignOutButton from "../../../../sign-out-button";
import { createAssignmentAction } from "../actions";

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
.asg-section + .asg-section {
  border-top: 1px solid var(--lms-border);
  padding-top: var(--lms-space-5);
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
.asg-grid-2 {
  display: grid;
  gap: var(--lms-space-4);
  grid-template-columns: 1fr;
}
@media (min-width: 600px) {
  .asg-grid-2 {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}
.asg-check {
  align-items: flex-start;
  background: var(--lms-surface-2);
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius-md);
  cursor: pointer;
  display: flex;
  gap: var(--lms-space-3);
  min-height: 44px;
  padding: var(--lms-space-3);
}
.asg-check input {
  accent-color: var(--lms-accent);
  flex-shrink: 0;
  height: 18px;
  margin-top: 2px;
  width: 18px;
}
.asg-check-text {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-1);
}
.asg-check-title {
  font-weight: 600;
}
.asg-check-hint {
  color: var(--lms-text-muted);
  font-size: 0.875rem;
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
  const course = await getTaughtCourse(session.userId, courseId, session.tenantId);
  if (!course) notFound();

  const errorMessage = Array.isArray(searchParams.error)
    ? searchParams.error[0]
    : searchParams.error;

  const base = `/teach/${courseId}/assignments`;

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{formCss}</style>
      <Stack gap={4}>
        <Button className="asg-back" href={base} size="sm" variant="ghost">
          ← Back to assignments
        </Button>

        <PageHeader
          title="New assignment"
          subtitle={`Add an assignment to ${course.title}.`}
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        <Card className="asg-form-card">
          <form action={createAssignmentAction} className="asg-form">
            <input name="courseId" type="hidden" value={courseId} />

            <section className="asg-section">
              <div className="asg-section-head">
                <h2 className="asg-section-title">Details</h2>
                <p className="asg-section-hint">
                  Give the assignment a clear title and tell learners what to do.
                </p>
              </div>
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
            </section>

            <section className="asg-section">
              <div className="asg-section-head">
                <h2 className="asg-section-title">Schedule &amp; grading</h2>
                <p className="asg-section-hint">
                  Set when work is due and how many points it is worth.
                </p>
              </div>
              <div className="asg-grid-2">
                <Field htmlFor="dueAt" label="Due date">
                  <Input name="dueAt" type="date" />
                </Field>
                <Field htmlFor="points" label="Points">
                  <Input name="points" type="number" defaultValue="100" />
                </Field>
              </div>
            </section>

            <section className="asg-section">
              <div className="asg-section-head">
                <h2 className="asg-section-title">Submission</h2>
                <p className="asg-section-hint">
                  Choose how learners hand in their work.
                </p>
              </div>
              <Field htmlFor="submissionType" label="Submission type">
                <Select name="submissionType" defaultValue="file">
                  <option value="file">File upload</option>
                  <option value="text">Text entry</option>
                  <option value="url">URL</option>
                  <option value="none">No submission</option>
                </Select>
              </Field>
              <label className="asg-check">
                <input defaultChecked name="allowLate" type="checkbox" />
                <span className="asg-check-text">
                  <span className="asg-check-title">Allow late submissions</span>
                  <span className="asg-check-hint">
                    Learners can submit after the due date.
                  </span>
                </span>
              </label>
            </section>

            <div className="asg-actionbar">
              <Button href={base} variant="ghost">
                Cancel
              </Button>
              <Button type="submit">Create assignment</Button>
            </div>
          </form>
        </Card>
      </Stack>
    </AppShell>
  );
}
