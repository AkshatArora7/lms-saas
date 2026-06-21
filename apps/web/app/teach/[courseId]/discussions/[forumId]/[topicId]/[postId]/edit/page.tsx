import { notFound, redirect } from "next/navigation";
import {
  Alert,
  AppShell,
  Button,
  Card,
  Field,
  PageHeader,
  Stack,
  Textarea,
} from "@lms/ui";

import { getBranding } from "../../../../../../../lib/branding";
import { getSession } from "../../../../../../../lib/auth";
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

  if (!canTeach(session.roles)) {
    return (
      <AppShell brand={brand} actions={<SignOutButton />}>
        <PageHeader
          title="Not authorized"
          subtitle="Your account cannot manage discussions."
        />
        <Alert tone="warning">
          You are signed in as <strong>{session.userId}</strong>, but your
          account does not hold a teaching role.
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
      <AppShell brand={brand} actions={<SignOutButton />}>
        <style>{formCss}</style>
        <Stack gap={4}>
          <Button className="asg-back" href={base} size="sm" variant="ghost">
            ← Back to thread
          </Button>
          <PageHeader title="Edit post" />
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
    <AppShell brand={brand} actions={<SignOutButton />}>
      <style>{formCss}</style>
      <Stack gap={4}>
        <Button className="asg-back" href={base} size="sm" variant="ghost">
          ← Back to thread
        </Button>

        <PageHeader title="Edit post" subtitle={`By ${post.authorId}`} />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        <Card className="asg-form-card">
          <form action={updatePostAction} className="asg-form">
            <input name="courseId" type="hidden" value={courseId} />
            <input name="forumId" type="hidden" value={forumId} />
            <input name="topicId" type="hidden" value={topicId} />
            <input name="id" type="hidden" value={post.id} />

            <section className="asg-section">
              <div className="asg-section-head">
                <h2 className="asg-section-title">Post</h2>
                <p className="asg-section-hint">
                  Update the contents of this post. Changes are visible to
                  learners right away.
                </p>
              </div>
              <Field htmlFor="body" label="Post body" required>
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
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </div>
          </form>
        </Card>
      </Stack>
    </AppShell>
  );
}
