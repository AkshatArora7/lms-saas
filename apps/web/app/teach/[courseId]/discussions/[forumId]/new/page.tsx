import { notFound, redirect } from "next/navigation";
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

import { getBranding } from "../../../../../lib/branding";
import { getSession } from "../../../../../lib/auth";
import { resolveRequestLocale } from "../../../../../lib/i18n";
import { AppLocaleSwitcher } from "../../../../../lib/locale-switcher";
import { AppShell } from "../../../../../lib/ui";
import { canTeach, getTaughtCourse } from "../../../../../lib/teaching";
import { listForums } from "../../../../../lib/discussions-api";
import SignOutButton from "../../../../../sign-out-button";
import { createTopicAction } from "../../actions";

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

export default async function NewTopicPage({
  params,
  searchParams,
}: {
  params: { courseId: string; forumId: string };
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

  const { courseId, forumId } = params;
  const course = await getTaughtCourse(session.userId, courseId, session.tenantId);
  if (!course) notFound();

  const forumsResult = await listForums(courseId, session.tenantId);
  const forum = forumsResult.ok
    ? forumsResult.forums.find((f) => f.id === forumId)
    : undefined;
  if (forumsResult.ok && !forum) notFound();

  const errorMessage = Array.isArray(searchParams.error)
    ? searchParams.error[0]
    : searchParams.error;

  const base = `/teach/${courseId}/discussions/${forumId}`;

  return (
    <AppShell actions={shellActions} brand={brand}>
      <style>{formCss}</style>
      <Stack gap={4}>
        <Button className="asg-back" href={base} size="sm" variant="ghost">
          {t(m, "teach.topicForm.backToTopics")}
        </Button>

        <PageHeader
          subtitle={
            forum
              ? t(m, "teach.topicForm.newSubtitleIn", { forum: forum.title })
              : undefined
          }
          title={t(m, "teach.topicForm.newTitle")}
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        <Card className="asg-form-card">
          <form action={createTopicAction} className="asg-form">
            <input name="courseId" type="hidden" value={courseId} />
            <input name="forumId" type="hidden" value={forumId} />

            <section className="asg-section">
              <div className="asg-section-head">
                <h2 className="asg-section-title">
                  {t(m, "teach.topicForm.section")}
                </h2>
                <p className="asg-section-hint">
                  {t(m, "teach.topicForm.hint")}
                </p>
              </div>
              <Field
                htmlFor="title"
                label={t(m, "teach.topicForm.fieldTitle")}
                required
              >
                <Input
                  name="title"
                  placeholder={t(m, "teach.topicForm.titlePlaceholder")}
                  required
                />
              </Field>
              <Field
                htmlFor="description"
                label={t(m, "teach.topicForm.fieldDescription")}
                help={t(m, "teach.topicForm.descriptionHelp")}
              >
                <Textarea name="description" rows={3} />
              </Field>
            </section>

            <div className="asg-actionbar">
              <Button href={base} variant="ghost">
                {t(m, "teach.topicForm.cancel")}
              </Button>
              <Button type="submit">{t(m, "teach.topicForm.create")}</Button>
            </div>
          </form>
        </Card>
      </Stack>
    </AppShell>
  );
}
