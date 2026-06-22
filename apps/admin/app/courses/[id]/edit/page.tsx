import { redirect } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  Chip,
  Field,
  Input,
  PageHeader,
  Stack,
  Textarea,
} from "@lms/ui";
import { getMessages, t } from "@lms/i18n";

import { getBranding } from "../../../lib/branding";
import { getSession, isAdmin } from "../../../lib/auth";
import { getCourse } from "../../../lib/courses-api";
import { resolveRequestLocale } from "../../../lib/i18n";
import { AppLocaleSwitcher } from "../../../lib/locale-switcher";
import { AppShell } from "../../../lib/ui";
import SignOutButton from "../../../sign-out-button";
import {
  deleteCourseAction,
  publishCourseAction,
  updateCourseAction,
} from "../../actions";

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
.asg-lifecycle {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-3);
  padding: var(--lms-space-5);
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
  const m = getMessages(await resolveRequestLocale());

  const actions = (
    <>
      <AppLocaleSwitcher />
      <SignOutButton />
    </>
  );

  if (!isAdmin(session)) {
    return (
      <AppShell brand={brand} actions={actions}>
        <PageHeader
          title={t(m, "admin.notAuthorizedTitle")}
          subtitle={t(m, "admin.notAuthorizedSubtitle")}
        />
        <Alert tone="warning">
          You are signed in as <strong>{session.userId}</strong>.{" "}
          {t(m, "admin.notAuthorizedBody")}
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
      <AppShell brand={brand} actions={actions}>
        <style>{formCss}</style>
        <Stack gap={5}>
          <Button
            className="asg-back"
            href="/courses"
            size="sm"
            variant="ghost"
          >
            {t(m, "admin.backToCatalogue")}
          </Button>
          <PageHeader title={t(m, "admin.courseForm.unavailableTitle")} />
          <Alert tone="warning">{result.error}</Alert>
        </Stack>
      </AppShell>
    );
  }

  const course = result.course;

  return (
    <AppShell brand={brand} actions={actions}>
      <style>{formCss}</style>
      <Stack gap={5}>
        <Button className="asg-back" href="/courses" size="sm" variant="ghost">
          {t(m, "admin.backToCatalogue")}
        </Button>

        <PageHeader
          title={t(m, "admin.courseForm.editTitle")}
          subtitle={course.title}
          actions={
            <Chip tone={course.isPublished ? "success" : "warning"}>
              {course.isPublished
                ? t(m, "admin.courses.statusPublished")
                : t(m, "admin.courses.statusDraft")}
            </Chip>
          }
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        <Card className="asg-form-card">
          <form action={updateCourseAction} className="asg-form">
            <input name="id" type="hidden" value={course.id} />

            <section className="asg-section">
              <div className="asg-section-head">
                <h2 className="asg-section-title">
                  {t(m, "admin.courseForm.detailsTitle")}
                </h2>
                <p className="asg-section-hint">
                  {t(m, "admin.courseForm.detailsHint")}
                </p>
              </div>
              <Field
                htmlFor="title"
                label={t(m, "admin.courseForm.fieldTitle")}
                required
              >
                <Input name="title" defaultValue={course.title} required />
              </Field>
              <Field
                htmlFor="description"
                label={t(m, "admin.courseForm.fieldDescription")}
              >
                <Textarea
                  name="description"
                  defaultValue={course.description ?? undefined}
                  rows={3}
                />
              </Field>
            </section>

            <section className="asg-section">
              <div className="asg-section-head">
                <h2 className="asg-section-title">
                  {t(m, "admin.courseForm.scheduleTitle")}
                </h2>
                <p className="asg-section-hint">
                  {t(m, "admin.courseForm.scheduleHint")}
                </p>
              </div>
              <div className="asg-grid-2">
                <Field
                  htmlFor="startDate"
                  label={t(m, "admin.courseForm.startDate")}
                >
                  <Input
                    name="startDate"
                    type="date"
                    defaultValue={toDateInput(course.startDate)}
                  />
                </Field>
                <Field
                  htmlFor="endDate"
                  label={t(m, "admin.courseForm.endDate")}
                >
                  <Input
                    name="endDate"
                    type="date"
                    defaultValue={toDateInput(course.endDate)}
                  />
                </Field>
              </div>
            </section>

            <div className="asg-actionbar">
              <Button href="/courses" variant="ghost">
                {t(m, "common.cancel")}
              </Button>
              <Button type="submit">
                {t(m, "admin.courseForm.saveChanges")}
              </Button>
            </div>
          </form>
        </Card>

        <Card className="asg-lifecycle">
          <div className="asg-section-head">
            <h2 className="asg-section-title">
              {t(m, "admin.courseForm.lifecycleTitle")}
            </h2>
            <p className="asg-section-hint">
              {t(m, "admin.courseForm.lifecycleHint")}
            </p>
          </div>
          {!course.isPublished ? (
            <form action={publishCourseAction}>
              <input name="id" type="hidden" value={course.id} />
              <Button type="submit">
                {t(m, "admin.courseForm.publishCourse")}
              </Button>
            </form>
          ) : (
            <Alert tone="success">
              {t(m, "admin.courseForm.alreadyPublished")}
            </Alert>
          )}
        </Card>

        <Card className="asg-danger">
          <div className="asg-danger-row">
            <div className="asg-danger-copy">
              <p className="asg-danger-title">
                {t(m, "admin.courseForm.dangerTitle")}
              </p>
              <p className="asg-danger-text">
                {t(m, "admin.courseForm.dangerText")}
              </p>
            </div>
            <form action={deleteCourseAction}>
              <input name="id" type="hidden" value={course.id} />
              <Button type="submit" variant="danger">
                {t(m, "admin.courseForm.deleteCourse")}
              </Button>
            </form>
          </div>
        </Card>
      </Stack>
    </AppShell>
  );
}
