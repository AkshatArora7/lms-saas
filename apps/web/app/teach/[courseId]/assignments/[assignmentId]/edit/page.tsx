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

import { getBranding } from "../../../../../lib/branding";
import { getSession } from "../../../../../lib/auth";
import { canTeach } from "../../../../../lib/teaching";
import { getAssignment } from "../../../../../lib/assignments-api";
import SignOutButton from "../../../../../sign-out-button";
import { deleteAssignmentAction, updateAssignmentAction } from "../../actions";

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

function toDateInput(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export default async function EditAssignment({
  params,
  searchParams,
}: {
  params: { courseId: string; assignmentId: string };
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

  const { courseId, assignmentId } = params;
  const base = `/teach/${courseId}/assignments`;

  const result = await getAssignment(assignmentId, session.tenantId);
  if (!result.ok) notFound();
  const assignment = result.assignment;

  const errorMessage = Array.isArray(searchParams.error)
    ? searchParams.error[0]
    : searchParams.error;

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{formCss}</style>
      <Stack gap={4}>
        <Button className="asg-back" href={base} size="sm" variant="ghost">
          ← Back to assignments
        </Button>

        <PageHeader
          title="Edit assignment"
          subtitle={assignment.title}
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        <Card className="asg-form-card">
          <form action={updateAssignmentAction} className="asg-form">
            <input name="courseId" type="hidden" value={courseId} />
            <input name="id" type="hidden" value={assignment.id} />

            <section className="asg-section">
              <div className="asg-section-head">
                <h2 className="asg-section-title">Details</h2>
                <p className="asg-section-hint">
                  Give the assignment a clear title and tell learners what to do.
                </p>
              </div>
              <Field htmlFor="title" label="Title" required>
                <Input name="title" defaultValue={assignment.title} required />
              </Field>
              <Field htmlFor="instructions" label="Instructions">
                <Textarea
                  name="instructions"
                  defaultValue={assignment.instructions ?? ""}
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
                  <Input
                    name="dueAt"
                    type="date"
                    defaultValue={toDateInput(assignment.dueAt)}
                  />
                </Field>
                <Field htmlFor="points" label="Points">
                  <Input
                    name="points"
                    type="number"
                    defaultValue={String(assignment.points)}
                  />
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
                <Select
                  name="submissionType"
                  defaultValue={assignment.submissionType}
                >
                  <option value="file">File upload</option>
                  <option value="text">Text entry</option>
                  <option value="url">URL</option>
                  <option value="none">No submission</option>
                </Select>
              </Field>
              <label className="asg-check">
                <input
                  defaultChecked={assignment.allowLate}
                  name="allowLate"
                  type="checkbox"
                />
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
              <Button type="submit">Save changes</Button>
            </div>
          </form>
        </Card>

        <Card className="asg-danger">
          <div className="asg-danger-row">
            <div className="asg-danger-copy">
              <p className="asg-danger-title">Danger zone</p>
              <p className="asg-danger-text">
                Deleting an assignment also removes its submissions. This cannot
                be undone.
              </p>
            </div>
            <form action={deleteAssignmentAction}>
              <input name="courseId" type="hidden" value={courseId} />
              <input name="id" type="hidden" value={assignment.id} />
              <Button type="submit" variant="danger">
                Delete assignment
              </Button>
            </form>
          </div>
        </Card>
      </Stack>
    </AppShell>
  );
}
