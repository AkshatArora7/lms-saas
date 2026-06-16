import { notFound, redirect } from "next/navigation";
import {
  Alert,
  AppShell,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Inline,
  PageHeader,
  Stack,
  Textarea,
} from "@lms/ui";

import { getBranding } from "../../../../../lib/branding";
import { getSession } from "../../../../../lib/auth";
import { canTeach, getTaughtCourses } from "../../../../../lib/teaching";
import {
  listForums,
  listPosts,
  listTopics,
  type Post,
} from "../../../../../lib/discussions-api";
import SignOutButton from "../../../../../sign-out-button";
import {
  createPostAction,
  deletePostAction,
  pinPostAction,
} from "../../actions";

/** Order posts as a reply tree so children render under their parent. */
function orderThreaded(posts: Post[]): { post: Post; depth: number }[] {
  const childrenOf = new Map<string | null, Post[]>();
  for (const post of posts) {
    const key = post.parentId;
    const list = childrenOf.get(key) ?? [];
    list.push(post);
    childrenOf.set(key, list);
  }
  const byCreated = (a: Post, b: Post) =>
    a.createdAt.localeCompare(b.createdAt);
  const out: { post: Post; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    const children = (childrenOf.get(parentId) ?? []).slice().sort(byCreated);
    for (const post of children) {
      out.push({ post, depth });
      walk(post.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export default async function TopicThreadPage({
  params,
  searchParams,
}: {
  params: { courseId: string; forumId: string; topicId: string };
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

  const { courseId, forumId, topicId } = params;
  const course = getTaughtCourses(session.tenantId).find(
    (c) => c.id === courseId,
  );
  if (!course) notFound();

  const errorMessage = Array.isArray(searchParams.error)
    ? searchParams.error[0]
    : searchParams.error;

  const forumBase = `/teach/${courseId}/discussions/${forumId}`;
  const base = `${forumBase}/${topicId}`;

  const forumsResult = await listForums(courseId, session.tenantId);
  if (forumsResult.ok && !forumsResult.forums.some((f) => f.id === forumId)) {
    notFound();
  }

  const topicsResult = await listTopics(forumId, session.tenantId);
  const topic = topicsResult.ok
    ? topicsResult.topics.find((t) => t.id === topicId)
    : undefined;
  if (topicsResult.ok && !topic) notFound();

  const postsResult = await listPosts(topicId, session.tenantId);
  const threaded = postsResult.ok ? orderThreaded(postsResult.posts) : [];

  const hidden = (
    <>
      <input name="courseId" type="hidden" value={courseId} />
      <input name="forumId" type="hidden" value={forumId} />
      <input name="topicId" type="hidden" value={topicId} />
    </>
  );

  return (
    <AppShell brand={brand} actions={<SignOutButton />}>
      <Stack gap={4}>
        <Button href={forumBase} size="sm" variant="ghost">
          {"<- Back to topics"}
        </Button>

        <PageHeader
          title={topic ? topic.title : "Thread"}
          subtitle={topic?.description ?? course.title}
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        {!postsResult.ok ? (
          <Alert tone="warning">{postsResult.error}</Alert>
        ) : threaded.length === 0 ? (
          <EmptyState
            title="No posts yet"
            description="Start the conversation below."
          />
        ) : (
          <Stack gap={3}>
            {threaded.map(({ post, depth }) => (
              <div
                key={post.id}
                style={{ marginLeft: `${Math.min(depth, 4) * 20}px` }}
              >
                <Card>
                  <Stack gap={2}>
                    <Inline gap={2} align="center" justify="space-between">
                      <Inline gap={2} align="center">
                        <strong style={{ overflowWrap: "anywhere" }}>
                          {post.authorId}
                        </strong>
                        {post.isPinned ? (
                          <Badge tone="accent">Pinned</Badge>
                        ) : null}
                        {post.parentId ? (
                          <Badge tone="neutral">Reply</Badge>
                        ) : null}
                      </Inline>
                      <span
                        style={{
                          color: "var(--lms-text-muted)",
                          fontSize: 13,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {new Date(post.createdAt).toLocaleDateString()}
                      </span>
                    </Inline>

                    <p style={{ margin: 0, overflowWrap: "anywhere" }}>
                      {post.body}
                    </p>

                    <Inline gap={2} align="center">
                      <Button
                        href={`${base}/${post.id}/edit`}
                        size="sm"
                        variant="ghost"
                      >
                        Edit
                      </Button>
                      <form action={pinPostAction}>
                        {hidden}
                        <input name="id" type="hidden" value={post.id} />
                        <input
                          name="pinned"
                          type="hidden"
                          value={post.isPinned ? "false" : "true"}
                        />
                        <Button type="submit" size="sm" variant="ghost">
                          {post.isPinned ? "Unpin" : "Pin"}
                        </Button>
                      </form>
                      <form action={deletePostAction}>
                        {hidden}
                        <input name="id" type="hidden" value={post.id} />
                        <Button type="submit" size="sm" variant="danger">
                          Delete
                        </Button>
                      </form>
                    </Inline>

                    <details>
                      <summary
                        style={{ cursor: "pointer", fontSize: 14 }}
                      >
                        Reply
                      </summary>
                      <form action={createPostAction}>
                        {hidden}
                        <input
                          name="parentId"
                          type="hidden"
                          value={post.id}
                        />
                        <Stack gap={2}>
                          <Field htmlFor={`reply-${post.id}`} label="Reply">
                            <Textarea
                              name="body"
                              id={`reply-${post.id}`}
                              rows={2}
                              required
                            />
                          </Field>
                          <Button type="submit" size="sm">
                            Post reply
                          </Button>
                        </Stack>
                      </form>
                    </details>
                  </Stack>
                </Card>
              </div>
            ))}
          </Stack>
        )}

        <Card>
          <form action={createPostAction}>
            {hidden}
            <Stack gap={3}>
              <Field htmlFor="new-post" label="Add a post" required>
                <Textarea name="body" id="new-post" rows={3} required />
              </Field>
              <Button type="submit">Post</Button>
            </Stack>
          </form>
        </Card>
      </Stack>
    </AppShell>
  );
}
