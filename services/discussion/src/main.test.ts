import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { buildApp } from "./main.js";
import {
  createSeededMemoryStore,
  DEMO_TENANT_ID,
  MemoryDiscussionStore,
} from "./store.memory.js";

const config = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
} as unknown as AppConfig;

const TENANT: TenantContext = {
  tenantId: DEMO_TENANT_ID,
  tier: "pool",
  databaseUrl: "postgres://user:pass@localhost:5432/lms_test",
};

const OTHER_TENANT: TenantContext = {
  tenantId: "22222222-2222-2222-2222-222222222222",
  tier: "pool",
  databaseUrl: "postgres://user:pass@localhost:5432/lms_test",
};

function resolveTenant(req: FastifyRequest): TenantContext {
  const tenantId = req.headers["x-tenant-id"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("missing x-tenant-id");
  }
  return tenantId === OTHER_TENANT.tenantId ? OTHER_TENANT : TENANT;
}

function buildTestApp(store = new MemoryDiscussionStore()) {
  return buildApp({ config, store, resolveTenant });
}

const HEADERS = { "x-tenant-id": DEMO_TENANT_ID };

async function createForum(
  app: ReturnType<typeof buildTestApp>,
  overrides: Record<string, unknown> = {},
) {
  const res = await app.inject({
    method: "POST",
    url: "/forums",
    headers: HEADERS,
    payload: { courseId: "course-1", title: "General", ...overrides },
  });
  return res;
}

async function createTopic(
  app: ReturnType<typeof buildTestApp>,
  forumId: string,
  overrides: Record<string, unknown> = {},
) {
  return app.inject({
    method: "POST",
    url: `/forums/${forumId}/topics`,
    headers: HEADERS,
    payload: { title: "Week 1", ...overrides },
  });
}

async function createPost(
  app: ReturnType<typeof buildTestApp>,
  topicId: string,
  overrides: Record<string, unknown> = {},
) {
  return app.inject({
    method: "POST",
    url: `/topics/${topicId}/posts`,
    headers: HEADERS,
    payload: { authorId: "stu-1", body: "Hello", ...overrides },
  });
}

describe("discussion service health", () => {
  it("reports ok", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ service: "discussion", status: "ok" });
  });
});

describe("forums and topics", () => {
  it("creates a forum (201) and lists it by course", async () => {
    const app = buildTestApp();
    const created = await createForum(app);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ forum: { title: "General" } });

    const list = await app.inject({
      method: "GET",
      url: "/forums?courseId=course-1",
      headers: HEADERS,
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { forums: unknown[] }).forums).toHaveLength(1);
  });

  it("requires courseId when listing forums (400)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/forums",
      headers: HEADERS,
    });
    expect(res.statusCode).toBe(400);
  });

  it("creates a topic in a forum (201)", async () => {
    const app = buildTestApp();
    const { forum } = (await createForum(app)).json() as {
      forum: { id: string };
    };
    const topic = await createTopic(app, forum.id);
    expect(topic.statusCode).toBe(201);
    expect(topic.json()).toMatchObject({ topic: { title: "Week 1" } });
  });

  it("returns 404 creating a topic in an unknown forum", async () => {
    const app = buildTestApp();
    const res = await createTopic(app, "missing-forum");
    expect(res.statusCode).toBe(404);
  });
});

describe("threaded posts", () => {
  it("creates a post and a reply, then returns the thread tree", async () => {
    const app = buildTestApp();
    const { forum } = (await createForum(app)).json() as {
      forum: { id: string };
    };
    const { topic } = (await createTopic(app, forum.id)).json() as {
      topic: { id: string };
    };

    const root = await createPost(app, topic.id, { body: "Root" });
    expect(root.statusCode).toBe(201);
    const rootId = (root.json() as { post: { id: string } }).post.id;

    const reply = await createPost(app, topic.id, {
      body: "Reply",
      parentId: rootId,
    });
    expect(reply.statusCode).toBe(201);

    const thread = await app.inject({
      method: "GET",
      url: `/topics/${topic.id}/posts?view=thread`,
      headers: HEADERS,
    });
    expect(thread.statusCode).toBe(200);
    const tree = (thread.json() as { thread: Array<{ replies: unknown[] }> })
      .thread;
    expect(tree).toHaveLength(1);
    expect(tree[0].replies).toHaveLength(1);
  });

  it("rejects a post to an unknown topic (404)", async () => {
    const app = buildTestApp();
    const res = await createPost(app, "missing-topic");
    expect(res.statusCode).toBe(404);
  });

  it("rejects a reply to an unknown parent (400)", async () => {
    const app = buildTestApp();
    const { forum } = (await createForum(app)).json() as {
      forum: { id: string };
    };
    const { topic } = (await createTopic(app, forum.id)).json() as {
      topic: { id: string };
    };
    const res = await createPost(app, topic.id, { parentId: "nope" });
    expect(res.statusCode).toBe(400);
  });

  it("requires authorId and body (400)", async () => {
    const app = buildTestApp();
    const { forum } = (await createForum(app)).json() as {
      forum: { id: string };
    };
    const { topic } = (await createTopic(app, forum.id)).json() as {
      topic: { id: string };
    };
    const res = await app.inject({
      method: "POST",
      url: `/topics/${topic.id}/posts`,
      headers: HEADERS,
      payload: { body: "no author" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("moderation", () => {
  it("pins a post so it surfaces first in the flat list", async () => {
    const app = buildTestApp();
    const { forum } = (await createForum(app)).json() as {
      forum: { id: string };
    };
    const { topic } = (await createTopic(app, forum.id)).json() as {
      topic: { id: string };
    };
    await createPost(app, topic.id, { body: "first" });
    const second = await createPost(app, topic.id, { body: "second" });
    const secondId = (second.json() as { post: { id: string } }).post.id;

    const pin = await app.inject({
      method: "POST",
      url: `/posts/${secondId}/pin`,
      headers: HEADERS,
      payload: {},
    });
    expect(pin.statusCode).toBe(200);
    expect(pin.json()).toMatchObject({ post: { isPinned: true } });

    const posts = await app.inject({
      method: "GET",
      url: `/topics/${topic.id}/posts`,
      headers: HEADERS,
    });
    const list = (posts.json() as { posts: Array<{ id: string }> }).posts;
    expect(list[0].id).toBe(secondId);
  });

  it("deletes a post and cascades to its replies", async () => {
    const app = buildTestApp();
    const { forum } = (await createForum(app)).json() as {
      forum: { id: string };
    };
    const { topic } = (await createTopic(app, forum.id)).json() as {
      topic: { id: string };
    };
    const root = await createPost(app, topic.id, { body: "root" });
    const rootId = (root.json() as { post: { id: string } }).post.id;
    await createPost(app, topic.id, { body: "reply", parentId: rootId });

    const del = await app.inject({
      method: "DELETE",
      url: `/posts/${rootId}`,
      headers: HEADERS,
    });
    expect(del.statusCode).toBe(204);

    const posts = await app.inject({
      method: "GET",
      url: `/topics/${topic.id}/posts`,
      headers: HEADERS,
    });
    expect((posts.json() as { posts: unknown[] }).posts).toEqual([]);
  });

  it("returns 404 deleting an unknown post", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "DELETE",
      url: "/posts/missing",
      headers: HEADERS,
    });
    expect(res.statusCode).toBe(404);
  });

  it("edits a post body (200)", async () => {
    const app = buildTestApp();
    const { forum } = (await createForum(app)).json() as {
      forum: { id: string };
    };
    const { topic } = (await createTopic(app, forum.id)).json() as {
      topic: { id: string };
    };
    const post = await createPost(app, topic.id, { body: "original" });
    const postId = (post.json() as { post: { id: string } }).post.id;

    const res = await app.inject({
      method: "PATCH",
      url: `/posts/${postId}`,
      headers: HEADERS,
      payload: { body: "edited" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ post: { id: postId, body: "edited" } });
  });

  it("requires a body when editing a post (400)", async () => {
    const app = buildTestApp();
    const { forum } = (await createForum(app)).json() as {
      forum: { id: string };
    };
    const { topic } = (await createTopic(app, forum.id)).json() as {
      topic: { id: string };
    };
    const post = await createPost(app, topic.id, { body: "original" });
    const postId = (post.json() as { post: { id: string } }).post.id;

    const res = await app.inject({
      method: "PATCH",
      url: `/posts/${postId}`,
      headers: HEADERS,
      payload: { body: "   " },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 editing an unknown post", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/posts/missing",
      headers: HEADERS,
      payload: { body: "edited" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("graded participation", () => {
  it("counts posts per author across a forum's topics", async () => {
    const app = buildTestApp();
    const { forum } = (await createForum(app)).json() as {
      forum: { id: string };
    };
    const { topic } = (await createTopic(app, forum.id)).json() as {
      topic: { id: string };
    };
    await createPost(app, topic.id, { authorId: "stu-1", body: "a" });
    await createPost(app, topic.id, { authorId: "stu-1", body: "b" });
    await createPost(app, topic.id, { authorId: "stu-2", body: "c" });

    const res = await app.inject({
      method: "GET",
      url: `/forums/${forum.id}/participation`,
      headers: HEADERS,
    });
    expect(res.statusCode).toBe(200);
    const rows = (
      res.json() as { participation: Array<{ authorId: string; posts: number }> }
    ).participation;
    expect(rows[0]).toMatchObject({ authorId: "stu-1", posts: 2 });
  });
});

describe("tenant isolation", () => {
  it("hides another tenant's forums", async () => {
    const app = buildTestApp(createSeededMemoryStore());
    const ours = await app.inject({
      method: "GET",
      url: "/forums?courseId=demo-course",
      headers: HEADERS,
    });
    expect((ours.json() as { forums: unknown[] }).forums).toHaveLength(1);

    const theirs = await app.inject({
      method: "GET",
      url: "/forums?courseId=demo-course",
      headers: { "x-tenant-id": OTHER_TENANT.tenantId },
    });
    expect((theirs.json() as { forums: unknown[] }).forums).toEqual([]);
  });

  it("requires a tenant context (400)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/forums?courseId=course-1",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "tenant_required" });
  });
});
