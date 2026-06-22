import { notFound, redirect } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  Field,
  PageHeader,
  Stack,
  Textarea,
} from "@lms/ui";
import { getMessages, t } from "@lms/i18n";

import { getBranding } from "../../../../../../../lib/branding";
import { getSession } from "../../../../../../../lib/auth";
import { resolveRequestLocale } from "../../../../../../../lib/i18n";
import { AppLocaleSwitcher } from "../../../../../../../lib/locale-switcher";
import { AppShell } from "../../../../../../../lib/ui";
import { canTeach, getTaughtCourse } from "../../../../../../../lib/teaching";
import { listPosts } from "../../../../../../../lib/discussions-api";
import SignOutButton from "../../../../../../../sign-out-button";
import { updatePostAction } from "../../../../actions";

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

export default async function EditPostPage({
  params,
  searchParams,
}: {
  params: {
    courseId: string;
    forumId: string;
    topicId: string;
    postId: string;
  };
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

  const { courseId, forumId, topicId, postId } = params;
  const course = await getTaughtCourse(session.userId, courseId, session.tenantId);
  if (!course) notFound();

  const base = `/teach/${courseId}/discussions/${forumId}/${topicId}`;

  const postsResult = await listPosts(topicId, session.tenantId);
  if (!postsResult.ok) {
    return (
      <AppShell actions={shellActions} brand={brand}>
        <style>{formCss}</style>
        <Stack gap={4}>
          <Button className="asg-back" href={base} size="sm" variant="ghost">
            {t(m, "teach.postForm.backToThread")}
          </Button>
          <PageHeader title={t(m, "teach.postForm.title")} />
          <Alert tone="warning">{postsResult.error}</Alert>
        </Stack>
      </AppShell>
    );
  }

  const post = postsResult.posts.find((p) => p.id === postId);
  if (!post) notFound();

  const errorMessage = Array.isArray(searchParams.error)
    ? searchParams.error[0]
    : searchParams.error;

  return (
    <AppShell actions={shellActions} brand={brand}>
      <style>{formCss}</style>
      <Stack gap={4}>
        <Button className="asg-back" href={base} size="sm" variant="ghost">
          {t(m, "teach.postForm.backToThread")}
        </Button>

        <PageHeader
          subtitle={t(m, "teach.postForm.subtitleBy", {
            author: post.authorId,
          })}
          title={t(m, "teach.postForm.title")}
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        <Card className="asg-form-card">
          <form action={updatePostAction} className="asg-form">
            <input name="courseId" type="hidden" value={courseId} />
            <input name="forumId" type="hidden" value={forumId} />
            <input name="topicId" type="hidden" value={topicId} />
            <input name="id" type="hidden" value={post.id} />

            <section className="asg-section">
              <div className="asg-section-head">
                <h2 className="asg-section-title">
                  {t(m, "teach.postForm.section")}
                </h2>
                <p className="asg-section-hint">{t(m, "teach.postForm.hint")}</p>
              </div>
              <Field
                htmlFor="body"
                label={t(m, "teach.postForm.fieldBody")}
                required
              >
                <Textarea
                  name="body"
                  rows={5}
                  defaultValue={post.body}
                  required
                />
              </Field>
            </section>

            <div className="asg-actionbar">
              <Button href={base} variant="ghost">
                {t(m, "teach.postForm.cancel")}
              </Button>
              <Button type="submit">{t(m, "teach.postForm.save")}</Button>
            </div>
          </form>
        </Card>
      </Stack>
    </AppShell>
  );
}
