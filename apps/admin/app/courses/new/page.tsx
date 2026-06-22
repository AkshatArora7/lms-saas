import { redirect } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Stack,
  Textarea,
} from "@lms/ui";
import { getMessages, t } from "@lms/i18n";

import { getBranding } from "../../lib/branding";
import { getSession, isAdmin } from "../../lib/auth";
import { resolveRequestLocale } from "../../lib/i18n";
import { AppLocaleSwitcher } from "../../lib/locale-switcher";
import { AppShell } from "../../lib/ui";
import SignOutButton from "../../sign-out-button";
import { createCourseAction } from "../actions";

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
`;

export default async function NewCourse({
  searchParams,
}: {
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

  return (
    <AppShell brand={brand} actions={actions}>
      <style>{formCss}</style>
      <Stack gap={5}>
        <Button className="asg-back" href="/courses" size="sm" variant="ghost">
          {t(m, "admin.backToCatalogue")}
        </Button>

        <PageHeader
          title={t(m, "admin.courseForm.newTitle")}
          subtitle={t(m, "admin.courseForm.newSubtitle")}
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        <Card className="asg-form-card">
          <form action={createCourseAction} className="asg-form">
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
                <Input
                  name="title"
                  placeholder={t(m, "admin.courseForm.titlePlaceholder")}
                  required
                />
              </Field>
              <Field
                htmlFor="description"
                label={t(m, "admin.courseForm.fieldDescription")}
              >
                <Textarea
                  name="description"
                  placeholder={t(m, "admin.courseForm.descriptionPlaceholder")}
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
                  <Input name="startDate" type="date" />
                </Field>
                <Field
                  htmlFor="endDate"
                  label={t(m, "admin.courseForm.endDate")}
                >
                  <Input name="endDate" type="date" />
                </Field>
              </div>
            </section>

            <div className="asg-actionbar">
              <Button href="/courses" variant="ghost">
                {t(m, "common.cancel")}
              </Button>
              <Button type="submit">{t(m, "admin.courseForm.create")}</Button>
            </div>
          </form>
        </Card>
      </Stack>
    </AppShell>
  );
}
