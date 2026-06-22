import { notFound, redirect } from "next/navigation";
import type { CSSProperties } from "react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  PageHeader,
  Stack,
  Textarea,
} from "@lms/ui";
import { getMessages, t, type Messages } from "@lms/i18n";

import { getBranding } from "../../../../../lib/branding";
import { getSession } from "../../../../../lib/auth";
import { resolveRequestLocale } from "../../../../../lib/i18n";
import { AppLocaleSwitcher } from "../../../../../lib/locale-switcher";
import { AppShell, DiscussionsIcon } from "../../../../../lib/ui";
import { canTeach, getTaughtCourse } from "../../../../../lib/teaching";
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

const threadCss = `
.tp-thread {
  display: flex;
  flex-direction: column;
  gap: var(--lms-space-3);
  list-style: none;
  margin: 0;
  padding: 0;
}
.tp-node {
  margin-left: calc(var(--tp-depth, 0) * var(--lms-space-4));
  min-width: 0;
}
.tp-node--reply {
  border-left: 2px solid var(--lms-accent-soft);
  padding-left: var(--lms-space-3);
}
.tp-head {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2) var(--lms-space-3);
  justify-content: space-between;
}
.tp-id {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-2);
  min-width: 0;
}
.tp-author {
  font-weight: 700;
  min-width: 0;
  overflow-wrap: anywhere;
}
.tp-time {
  color: var(--lms-text-muted);
  font-size: 0.8125rem;
  white-space: nowrap;
}
.tp-body {
  margin: 0;
  overflow-wrap: anywhere;
  white-space: pre-line;
}
.tp-meta {
  color: var(--lms-text-muted);
  font-size: 0.8125rem;
  margin: 0;
}
.tp-actions {
  align-items: center;
  border-top: 1px solid var(--lms-border);
  display: flex;
  flex-wrap: wrap;
  gap: var(--lms-space-1) var(--lms-space-2);
  margin-top: var(--lms-space-1);
  padding-top: var(--lms-space-2);
}
.tp-actions form {
  margin: 0;
}
.tp-reply {
  margin: 0;
}
.tp-reply > summary {
  align-items: center;
  color: var(--lms-accent);
  cursor: pointer;
  display: inline-flex;
  font-size: 0.875rem;
  font-weight: 600;
  gap: var(--lms-space-1);
  list-style: none;
  min-height: 44px;
}
.tp-reply > summary::-webkit-details-marker {
  display: none;
}
.tp-reply[open] > summary {
  margin-bottom: var(--lms-space-2);
}
@media (max-width: 600px) {
  .tp-node {
    margin-left: calc(var(--tp-depth, 0) * var(--lms-space-2));
  }
  .tp-node--reply {
    padding-left: var(--lms-space-2);
  }
}
`;

/** Honest relative time derived from the post's real createdAt timestamp. */
function relativeTime(m: Messages, iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return t(m, "teach.thread.justNow");
  if (mins < 60) return t(m, "teach.thread.minsAgo", { count: mins });
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return t(m, "teach.thread.hoursAgo", { count: hrs });
  const days = Math.round(hrs / 24);
  if (days < 7) return t(m, "teach.thread.daysAgo", { count: days });
  return new Date(iso).toLocaleDateString();
}

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

  const { courseId, forumId, topicId } = params;
  const course = await getTaughtCourse(session.userId, courseId, session.tenantId);
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
  const totalPosts = postsResult.ok ? postsResult.posts.length : 0;
  const replyCounts = new Map<string, number>();
  if (postsResult.ok) {
    for (const p of postsResult.posts) {
      if (p.parentId) {
        replyCounts.set(p.parentId, (replyCounts.get(p.parentId) ?? 0) + 1);
      }
    }
  }

  const hidden = (
    <>
      <input name="courseId" type="hidden" value={courseId} />
      <input name="forumId" type="hidden" value={forumId} />
      <input name="topicId" type="hidden" value={topicId} />
    </>
  );

  return (
    <AppShell actions={shellActions} brand={brand}>
      <style>{threadCss}</style>
      <Stack gap={4}>
        <Button href={forumBase} size="sm" variant="ghost">
          {t(m, "teach.thread.backToTopics")}
        </Button>

        <PageHeader
          title={topic ? topic.title : t(m, "teach.thread.fallbackTitle")}
          subtitle={topic?.description ?? course.title}
          actions={
            postsResult.ok ? (
              <Badge tone="neutral">
                {t(
                  m,
                  totalPosts === 1
                    ? "teach.thread.postOne"
                    : "teach.thread.postOther",
                  { count: totalPosts },
                )}
              </Badge>
            ) : undefined
          }
        />

        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}

        {!postsResult.ok ? (
          <Alert tone="warning">{postsResult.error}</Alert>
        ) : threaded.length === 0 ? (
          <EmptyState
            description={t(m, "teach.thread.emptyBody")}
            icon={<DiscussionsIcon />}
            title={t(m, "teach.thread.emptyTitle")}
          />
        ) : (
          <ul className="tp-thread">
            {threaded.map(({ post, depth }) => {
              const cappedDepth = Math.min(depth, 4);
              const replyCount = replyCounts.get(post.id) ?? 0;
              return (
                <li
                  key={post.id}
                  className={
                    post.parentId ? "tp-node tp-node--reply" : "tp-node"
                  }
                  style={{ "--tp-depth": cappedDepth } as CSSProperties}
                >
                  <Card>
                    <Stack gap={2}>
                      <div className="tp-head">
                        <div className="tp-id">
                          <Avatar name={post.authorId} size="sm" />
                          <span className="tp-author">{post.authorId}</span>
                          {post.isPinned ? (
                            <Badge tone="accent">
                              {t(m, "teach.thread.pinned")}
                            </Badge>
                          ) : null}
                          {post.parentId ? (
                            <Badge tone="neutral">
                              {t(m, "teach.thread.reply")}
                            </Badge>
                          ) : null}
                        </div>
                        <span className="tp-time">
                          {relativeTime(m, post.createdAt)}
                        </span>
                      </div>

                      <p className="tp-body">{post.body}</p>

                      {replyCount > 0 ? (
                        <p className="tp-meta">
                          {t(
                            m,
                            replyCount === 1
                              ? "teach.thread.replyOne"
                              : "teach.thread.replyOther",
                            { count: replyCount },
                          )}
                        </p>
                      ) : null}

                      <div className="tp-actions">
                        <Button
                          href={`${base}/${post.id}/edit`}
                          size="sm"
                          variant="ghost"
                        >
                          {t(m, "teach.thread.edit")}
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
                            {post.isPinned
                              ? t(m, "teach.thread.unpin")
                              : t(m, "teach.thread.pin")}
                          </Button>
                        </form>
                        <form action={deletePostAction}>
                          {hidden}
                          <input name="id" type="hidden" value={post.id} />
                          <Button type="submit" size="sm" variant="danger">
                            {t(m, "teach.thread.delete")}
                          </Button>
                        </form>
                      </div>

                      <details className="tp-reply">
                        <summary>{t(m, "teach.thread.replyAction")}</summary>
                        <form action={createPostAction}>
                          {hidden}
                          <input
                            name="parentId"
                            type="hidden"
                            value={post.id}
                          />
                          <Stack gap={2}>
                            <Field
                              htmlFor={`reply-${post.id}`}
                              label={t(m, "teach.thread.replyFieldLabel")}
                            >
                              <Textarea
                                name="body"
                                id={`reply-${post.id}`}
                                rows={2}
                                required
                              />
                            </Field>
                            <Button type="submit" size="sm">
                              {t(m, "teach.thread.postReply")}
                            </Button>
                          </Stack>
                        </form>
                      </details>
                    </Stack>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}

        <Card>
          <form action={createPostAction}>
            {hidden}
            <Stack gap={3}>
              <Field
                htmlFor="new-post"
                label={t(m, "teach.thread.addPostLabel")}
                required
              >
                <Textarea name="body" id="new-post" rows={3} required />
              </Field>
              <Button type="submit">{t(m, "teach.thread.post")}</Button>
            </Stack>
          </form>
        </Card>
      </Stack>
    </AppShell>
  );
}
