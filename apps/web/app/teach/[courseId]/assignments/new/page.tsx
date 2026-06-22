import { notFound, redirect } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Stack,
  Textarea,
} from "@lms/ui";
import { getMessages, t } from "@lms/i18n";

import { getBranding } from "../../../../lib/branding";
import { getSession } from "../../../../lib/auth";
import { resolveRequestLocale } from "../../../../lib/i18n";
import { AppLocaleSwitcher } from "../../../../lib/locale-switcher";
import { AppShell } from "../../../../lib/ui";
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
  const m = getMessages(await resolveRequestLocale());

  const shellActions = (
    <>
      <AppLocaleSwitcher />
      <SignOutButton />
    </>
  );

  if (!canTeach(session.roles)) {
    return (
      <AppShell actions={shellActions} brand={brand}>
        <PageHeader
          subtitle={t(m, "teach.notAuthorizedSubtitle")}
          title={t(m, "teach.notAuthorizedTitle")}
        />
        <Alert tone="warning">
          <strong>{session.userId}</strong> — {t(m, "teach.notAuthorizedBody")}
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
    <AppShell actions={shellActions} brand={brand}>
      <style>{formCss}</style>
      <Stack gap={4}>
        <Button className="asg-back" href={base} size="sm" variant="ghost">
          {t(m, "teach.assignmentForm.backToAssignments")}
        </Button>

        <PageHeader
          subtitle={t(m, "teach.assignmentForm.newSubtitle", {
            course: course.title,
          })}
          title={t(m, "teach.assignmentForm.newTitle")}
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        <Card className="asg-form-card">
          <form action={createAssignmentAction} className="asg-form">
            <input name="courseId" type="hidden" value={courseId} />

            <section className="asg-section">
              <div className="asg-section-head">
                <h2 className="asg-section-title">
                  {t(m, "teach.assignmentForm.detailsSection")}
                </h2>
                <p className="asg-section-hint">
                  {t(m, "teach.assignmentForm.detailsHint")}
                </p>
              </div>
              <Field
                htmlFor="title"
                label={t(m, "teach.assignmentForm.fieldTitle")}
                required
              >
                <Input
                  name="title"
                  placeholder={t(m, "teach.assignmentForm.titlePlaceholder")}
                  required
                />
              </Field>
              <Field
                htmlFor="instructions"
                label={t(m, "teach.assignmentForm.fieldInstructions")}
              >
                <Textarea
                  name="instructions"
                  placeholder={t(
                    m,
                    "teach.assignmentForm.instructionsPlaceholder",
                  )}
                  rows={3}
                />
              </Field>
            </section>

            <section className="asg-section">
              <div className="asg-section-head">
                <h2 className="asg-section-title">
                  {t(m, "teach.assignmentForm.scheduleSection")}
                </h2>
                <p className="asg-section-hint">
                  {t(m, "teach.assignmentForm.scheduleHint")}
                </p>
              </div>
              <div className="asg-grid-2">
                <Field
                  htmlFor="dueAt"
                  label={t(m, "teach.assignmentForm.fieldDueDate")}
                >
                  <Input name="dueAt" type="date" />
                </Field>
                <Field
                  htmlFor="points"
                  label={t(m, "teach.assignmentForm.fieldPoints")}
                >
                  <Input name="points" type="number" defaultValue="100" />
                </Field>
              </div>
            </section>

            <section className="asg-section">
              <div className="asg-section-head">
                <h2 className="asg-section-title">
                  {t(m, "teach.assignmentForm.submissionSection")}
                </h2>
                <p className="asg-section-hint">
                  {t(m, "teach.assignmentForm.submissionHint")}
                </p>
              </div>
              <Field
                htmlFor="submissionType"
                label={t(m, "teach.assignmentForm.fieldSubmissionType")}
              >
                <Select name="submissionType" defaultValue="file">
                  <option value="file">
                    {t(m, "teach.assignmentForm.submissionFile")}
                  </option>
                  <option value="text">
                    {t(m, "teach.assignmentForm.submissionText")}
                  </option>
                  <option value="url">
                    {t(m, "teach.assignmentForm.submissionUrl")}
                  </option>
                  <option value="none">
                    {t(m, "teach.assignmentForm.submissionNone")}
                  </option>
                </Select>
              </Field>
              <label className="asg-check">
                <input defaultChecked name="allowLate" type="checkbox" />
                <span className="asg-check-text">
                  <span className="asg-check-title">
                    {t(m, "teach.assignmentForm.allowLateTitle")}
                  </span>
                  <span className="asg-check-hint">
                    {t(m, "teach.assignmentForm.allowLateHint")}
                  </span>
                </span>
              </label>
            </section>

            <div className="asg-actionbar">
              <Button href={base} variant="ghost">
                {t(m, "teach.assignmentForm.cancel")}
              </Button>
              <Button type="submit">
                {t(m, "teach.assignmentForm.create")}
              </Button>
            </div>
          </form>
        </Card>
      </Stack>
    </AppShell>
  );
}
