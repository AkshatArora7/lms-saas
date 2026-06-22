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
} from "@lms/ui";
import { getMessages, t, type MessageKey, type Messages } from "@lms/i18n";

import { getBranding } from "../../../../lib/branding";
import { getSession } from "../../../../lib/auth";
import { resolveRequestLocale } from "../../../../lib/i18n";
import { AppLocaleSwitcher } from "../../../../lib/locale-switcher";
import { AppShell } from "../../../../lib/ui";
import { canTeach, getTaughtCourse } from "../../../../lib/teaching";
import { ASSIGNABLE_ROLES } from "../../../../lib/enrollment-api";
import SignOutButton from "../../../../sign-out-button";
import { enrollUserAction } from "../actions";

const ROLE_LABEL_KEY: Record<string, MessageKey> = {
  learner: "roster.roleLearner",
  teaching_assistant: "roster.roleTeachingAssistant",
  instructor: "roster.roleInstructor",
  observer: "roster.roleObserver",
};

function roleLabel(m: Messages, role: string): string {
  const key = ROLE_LABEL_KEY[role];
  return key ? t(m, key) : role;
}

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

  const base = `/teach/${courseId}/roster`;

  return (
    <AppShell actions={shellActions} brand={brand}>
      <style>{formCss}</style>
      <Stack gap={4}>
        <Button className="asg-back" href={base} size="sm" variant="ghost">
          {t(m, "teach.rosterForm.backToRoster")}
        </Button>

        <PageHeader
          subtitle={t(m, "teach.rosterForm.newSubtitle", {
            course: course.title,
          })}
          title={t(m, "teach.rosterForm.newTitle")}
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        <Card className="asg-form-card">
          <form action={enrollUserAction} className="asg-form">
            <input name="courseId" type="hidden" value={courseId} />
            <input name="orgUnitId" type="hidden" value={course.orgUnitId} />

            <section className="asg-section">
              <div className="asg-section-head">
                <h2 className="asg-section-title">
                  {t(m, "teach.rosterForm.memberSection")}
                </h2>
                <p className="asg-section-hint">
                  {t(m, "teach.rosterForm.memberHint")}
                </p>
              </div>
              <Field
                htmlFor="userId"
                label={t(m, "teach.rosterForm.fieldUserId")}
                help={t(m, "teach.rosterForm.userIdHelp")}
                required
              >
                <Input
                  name="userId"
                  placeholder={t(m, "teach.rosterForm.userIdPlaceholder")}
                  required
                />
              </Field>
              <Field
                htmlFor="role"
                label={t(m, "teach.rosterForm.fieldRole")}
                required
              >
                <Select name="role" defaultValue="learner" required>
                  {ASSIGNABLE_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {roleLabel(m, role)}
                    </option>
                  ))}
                </Select>
              </Field>
            </section>

            <div className="asg-actionbar">
              <Button href={base} variant="ghost">
                {t(m, "teach.rosterForm.cancel")}
              </Button>
              <Button type="submit">{t(m, "teach.rosterForm.enroll")}</Button>
            </div>
          </form>
        </Card>
      </Stack>
    </AppShell>
  );
}
