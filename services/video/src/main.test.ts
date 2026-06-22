import type { AppConfig } from "@lms/config";
import type { TenantContext } from "@lms/types";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { StubCaptioner } from "./captioner.js";
import {
  FakeCourseAccessPolicy,
  type CourseAccessPolicy,
} from "./access.js";
import { buildApp } from "./main.js";
import { SyncPipelineRunner } from "./pipeline.js";
import { DEMO_TENANT_ID, MemoryVideoStore } from "./store.memory.js";
import { parseCaptionTracks } from "./store.js";
import { blobBase, StubTranscoder } from "./transcoder.js";

const config = {
  TENANT_MODE: "hybrid",
  DEFAULT_TENANT_TIER: "pool",
  DATABASE_URL: "postgres://user:pass@localhost:5432/lms_test",
} as unknown as AppConfig;

const TENANT_B_ID = "22222222-2222-2222-2222-222222222222";

const TENANT_A: TenantContext = {
  tenantId: DEMO_TENANT_ID,
  tier: "pool",
  databaseUrl: "postgres://user:pass@localhost:5432/lms_test",
};
const TENANT_B: TenantContext = {
  tenantId: TENANT_B_ID,
  tier: "pool",
  databaseUrl: "postgres://user:pass@localhost:5432/lms_test",
};

function resolveTenant(req: FastifyRequest): TenantContext {
  const tenantId = req.headers["x-tenant-id"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("missing x-tenant-id");
  }
  return tenantId === TENANT_B_ID ? TENANT_B : TENANT_A;
}

const TEACHER_ID = "44444444-4444-4444-4444-444444444444";
const OTHER_ID = "55555555-5555-5555-5555-555555555555";
const ADMIN_ID = "66666666-6666-6666-6666-666666666666";
const COURSE_ID = "77777777-7777-7777-7777-777777777777";
const ENROLLED_STUDENT_ID = "88888888-8888-8888-8888-888888888888";

const TEACHER_HEADERS = {
  "x-tenant-id": DEMO_TENANT_ID,
  "x-user-id": TEACHER_ID,
  "x-user-roles": "teacher",
};
const STUDENT_HEADERS = {
  "x-tenant-id": DEMO_TENANT_ID,
  "x-user-id": OTHER_ID,
  "x-user-roles": "student",
};
const ADMIN_HEADERS = {
  "x-tenant-id": DEMO_TENANT_ID,
  "x-user-id": ADMIN_ID,
  "x-user-roles": "org_admin",
};
const ENROLLED_STUDENT_HEADERS = {
  "x-tenant-id": DEMO_TENANT_ID,
  "x-user-id": ENROLLED_STUDENT_ID,
  "x-user-roles": "student",
};

/**
 * Seeded course-access policy for #319 tests: in the demo tenant, the teacher
 * and the enrolled student have access to COURSE_ID; OTHER_ID does not (the
 * non-enrolled tenant member). Admins short-circuit by role.
 */
function seededPolicy(): FakeCourseAccessPolicy {
  return new FakeCourseAccessPolicy(
    new Map([
      [
        DEMO_TENANT_ID,
        new Map([
          [COURSE_ID, new Set([TEACHER_ID, ENROLLED_STUDENT_ID])],
        ]),
      ],
    ]),
  );
}

/** Build a test app wired to a memory store + deterministic offline seams. */
function buildTestApp(
  policy: CourseAccessPolicy = new FakeCourseAccessPolicy(),
  store = new MemoryVideoStore(undefined, undefined, policy),
) {
  const transcoder = new StubTranscoder();
  const captioner = new StubCaptioner();
  const pipeline = new SyncPipelineRunner({ store, transcoder, captioner });
  return buildApp({
    config,
    store,
    resolveTenant,
    transcoder,
    captioner,
    pipeline,
    courseAccessPolicy: policy,
  });
}

const VALID_UPLOAD = {
  filename: "lecture-01.mp4",
  contentType: "video/mp4",
  sizeBytes: 1024 * 1024,
};

async function createReadyVideo(
  app: ReturnType<typeof buildTestApp>,
  headers = TEACHER_HEADERS,
): Promise<Record<string, unknown>> {
  const res = await app.inject({
    method: "POST",
    url: "/videos",
    headers,
    payload: { title: "Lecture 1", sourceBlobUrl: "https://blob.local/t/x/video/v/lecture-01.mp4" },
  });
  expect(res.statusCode).toBe(201);
  return res.json().video as Record<string, unknown>;
}

describe("video service", () => {
  it("reports health", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ service: "video", status: "ok" });
  });

  // --- Uploads ----------------------------------------------------------
  it("signs a tenant-namespaced video upload", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/uploads",
      headers: TEACHER_HEADERS,
      payload: VALID_UPLOAD,
    });
    expect(res.statusCode).toBe(201);
    const { upload } = res.json();
    expect(upload.key).toMatch(
      new RegExp(`^t/${DEMO_TENANT_ID}/video/[0-9a-f-]+/lecture-01\\.mp4$`),
    );
    expect(upload.uploadUrl).toContain(upload.key);
    expect(upload.blobUrl).toContain(upload.key);
  });

  it("rejects an unsupported upload type with 415", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/uploads",
      headers: TEACHER_HEADERS,
      payload: { ...VALID_UPLOAD, contentType: "application/pdf" },
    });
    expect(res.statusCode).toBe(415);
    expect(res.json().error).toBe("unsupported_type");
  });

  it("rejects an oversize upload with 413", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/uploads",
      headers: TEACHER_HEADERS,
      payload: { ...VALID_UPLOAD, sizeBytes: 50 * 1024 * 1024 * 1024 },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toBe("too_large");
  });

  // --- Create + pipeline ------------------------------------------------
  it("creates a video and drives it to ready with renditions + captions + duration", async () => {
    const app = buildTestApp();
    const video = await createReadyVideo(app);
    expect(video.status).toBe("ready");
    const renditions = video.renditions as Array<Record<string, unknown>>;
    expect(renditions.map((r) => r.quality)).toEqual(["480p", "720p", "1080p"]);
    expect(renditions.every((r) => r.type === "hls")).toBe(true);
    const base = blobBase("https://blob.local/t/x/video/v/lecture-01.mp4");
    expect(renditions[0]!.url).toBe(`${base}/480p.m3u8`);
    const captions = video.captions as Array<Record<string, unknown>>;
    expect(captions).toHaveLength(1);
    expect(captions[0]).toMatchObject({ lang: "en", kind: "auto" });
    expect(typeof video.durationSeconds).toBe("number");
    expect(video.ownerId).toBe(TEACHER_ID);
  });

  it("reflects ready state in list and by-id reads", async () => {
    const app = buildTestApp();
    const created = await createReadyVideo(app);

    const list = await app.inject({
      method: "GET",
      url: "/videos",
      headers: STUDENT_HEADERS, // any tenant member may read
    });
    expect(list.statusCode).toBe(200);
    const videos = list.json().videos as Array<Record<string, unknown>>;
    expect(videos).toHaveLength(1);
    expect(videos[0]!.status).toBe("ready");

    const byId = await app.inject({
      method: "GET",
      url: `/videos/${created.id}`,
      headers: STUDENT_HEADERS,
    });
    expect(byId.statusCode).toBe(200);
    expect(byId.json().video.status).toBe("ready");
  });

  it("returns 404 for an unknown video", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/videos/99999999-9999-9999-9999-999999999999",
      headers: STUDENT_HEADERS,
    });
    expect(res.statusCode).toBe(404);
  });

  // --- Manual caption edit ----------------------------------------------
  it("replaces captions on a manual edit (owner)", async () => {
    const app = buildTestApp();
    const created = await createReadyVideo(app);
    const res = await app.inject({
      method: "PATCH",
      url: `/videos/${created.id}/captions`,
      headers: TEACHER_HEADERS,
      payload: {
        captions: [
          { lang: "fr", label: "Français", url: "https://blob.local/fr.vtt" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const captions = res.json().video.captions as Array<Record<string, unknown>>;
    expect(captions).toHaveLength(1);
    expect(captions[0]).toMatchObject({ lang: "fr", kind: "manual" });
  });

  it("rejects malformed caption tracks with 400", async () => {
    const app = buildTestApp();
    const created = await createReadyVideo(app);
    const res = await app.inject({
      method: "PATCH",
      url: `/videos/${created.id}/captions`,
      headers: TEACHER_HEADERS,
      payload: { captions: [{ label: "no lang or url" }] },
    });
    expect(res.statusCode).toBe(400);
  });

  // --- Transcode re-run --------------------------------------------------
  it("re-runs the transcode pipeline (admin)", async () => {
    const app = buildTestApp();
    const created = await createReadyVideo(app);
    const res = await app.inject({
      method: "POST",
      url: `/videos/${created.id}/transcode`,
      headers: ADMIN_HEADERS, // admin may transcode any tenant video
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().video.status).toBe("ready");
    expect(res.json().video.renditions).toHaveLength(3);
  });

  // --- Write authz -------------------------------------------------------
  it("requires an authenticated caller to upload (401)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/uploads",
      headers: { "x-tenant-id": DEMO_TENANT_ID },
      payload: VALID_UPLOAD,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("user_required");
  });

  it("forbids a non-uploader role from creating a video (403)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/videos",
      headers: STUDENT_HEADERS,
      payload: { title: "x", sourceBlobUrl: "https://blob.local/x.mp4" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("forbidden");
  });

  it("forbids a non-owner non-admin from editing captions (403)", async () => {
    const app = buildTestApp();
    const created = await createReadyVideo(app); // owned by TEACHER_ID
    const res = await app.inject({
      method: "PATCH",
      url: `/videos/${created.id}/captions`,
      headers: {
        "x-tenant-id": DEMO_TENANT_ID,
        "x-user-id": OTHER_ID,
        "x-user-roles": "teacher", // an uploader, but not the owner
      },
      payload: { captions: [{ lang: "en", url: "https://blob.local/en.vtt" }] },
    });
    expect(res.statusCode).toBe(403);
  });

  // --- Tenant header required -------------------------------------------
  it("requires a tenant header (400)", async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/videos",
      headers: { "x-user-id": TEACHER_ID },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("tenant_required");
  });

  // --- Two-tenant isolation ---------------------------------------------
  it("isolates videos between tenants", async () => {
    const app = buildTestApp();
    const created = await createReadyVideo(app); // tenant A (demo)

    // Tenant B lists nothing.
    const listB = await app.inject({
      method: "GET",
      url: "/videos",
      headers: { "x-tenant-id": TENANT_B_ID, "x-user-id": OTHER_ID },
    });
    expect(listB.statusCode).toBe(200);
    expect(listB.json().videos).toHaveLength(0);

    // Tenant B cannot read tenant A's video by id.
    const getB = await app.inject({
      method: "GET",
      url: `/videos/${created.id}`,
      headers: { "x-tenant-id": TENANT_B_ID, "x-user-id": OTHER_ID },
    });
    expect(getB.statusCode).toBe(404);

    // Tenant B cannot transcode tenant A's video.
    const transcodeB = await app.inject({
      method: "POST",
      url: `/videos/${created.id}/transcode`,
      headers: { "x-tenant-id": TENANT_B_ID, ...{ "x-user-id": ADMIN_ID, "x-user-roles": "org_admin" } },
    });
    expect(transcodeB.statusCode).toBe(404);

    // Tenant A still sees its own video.
    const listA = await app.inject({
      method: "GET",
      url: "/videos",
      headers: STUDENT_HEADERS,
    });
    expect(listA.json().videos).toHaveLength(1);
  });

  // --- Course-scoped streaming access control (#319) --------------------
  async function createCourseVideo(
    app: ReturnType<typeof buildTestApp>,
  ): Promise<Record<string, unknown>> {
    const res = await app.inject({
      method: "POST",
      url: "/videos",
      headers: TEACHER_HEADERS, // uploader role; teacher is also enrolled
      payload: {
        title: "Course Lecture",
        sourceBlobUrl: "https://blob.local/t/x/video/v/course-01.mp4",
        courseId: COURSE_ID,
      },
    });
    expect(res.statusCode).toBe(201);
    const video = res.json().video as Record<string, unknown>;
    expect(video.courseId).toBe(COURSE_ID);
    return video;
  }

  it("lets an enrolled student read a course-scoped video", async () => {
    const app = buildTestApp(seededPolicy());
    const created = await createCourseVideo(app);
    const res = await app.inject({
      method: "GET",
      url: `/videos/${created.id}`,
      headers: ENROLLED_STUDENT_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().video.id).toBe(created.id);
  });

  it("lets a teacher/TA (enrollment row) read a course-scoped video", async () => {
    const app = buildTestApp(seededPolicy());
    const created = await createCourseVideo(app);
    const res = await app.inject({
      method: "GET",
      url: `/videos/${created.id}`,
      headers: TEACHER_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().video.id).toBe(created.id);
  });

  it("lets an admin read a course-scoped video", async () => {
    const app = buildTestApp(seededPolicy());
    const created = await createCourseVideo(app);
    const res = await app.inject({
      method: "GET",
      url: `/videos/${created.id}`,
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().video.id).toBe(created.id);
  });

  it("returns 404 to a non-enrolled tenant member on a course-scoped video", async () => {
    const app = buildTestApp(seededPolicy());
    const created = await createCourseVideo(app);
    const res = await app.inject({
      method: "GET",
      url: `/videos/${created.id}`,
      headers: STUDENT_HEADERS, // OTHER_ID is not enrolled
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("not_found");
  });

  it("denies the stream/playback URLs to a forbidden caller (404, no body URLs)", async () => {
    const app = buildTestApp(seededPolicy());
    const created = await createCourseVideo(app);
    const res = await app.inject({
      method: "GET",
      url: `/videos/${created.id}`,
      headers: STUDENT_HEADERS,
    });
    expect(res.statusCode).toBe(404);
    // The playback contract (sourceBlobUrl / renditions) is in the 200 body;
    // a 404 means a forbidden course-scoped video never yields a stream URL.
    expect(res.json().video).toBeUndefined();
    expect(JSON.stringify(res.json())).not.toContain("course-01.mp4");
  });

  it("excludes course-scoped videos from the list for a non-enrolled member", async () => {
    const app = buildTestApp(seededPolicy());
    await createCourseVideo(app);
    const list = await app.inject({
      method: "GET",
      url: "/videos",
      headers: STUDENT_HEADERS,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().videos).toHaveLength(0);
  });

  it("includes a course-scoped video in the list for an enrolled student, but not for a non-enrolled member", async () => {
    const app = buildTestApp(seededPolicy());
    const created = await createCourseVideo(app);

    const enrolledList = await app.inject({
      method: "GET",
      url: "/videos",
      headers: ENROLLED_STUDENT_HEADERS,
    });
    const enrolledVideos = enrolledList.json().videos as Array<
      Record<string, unknown>
    >;
    expect(enrolledVideos).toHaveLength(1);
    expect(enrolledVideos[0]!.id).toBe(created.id);

    const otherList = await app.inject({
      method: "GET",
      url: "/videos",
      headers: STUDENT_HEADERS,
    });
    expect(otherList.json().videos).toHaveLength(0);
  });

  it("keeps null-course videos readable + listed by any tenant member (no regression)", async () => {
    const app = buildTestApp(seededPolicy());
    const nullCourse = await createReadyVideo(app); // no courseId → null
    await createCourseVideo(app); // course-scoped, OTHER_ID not enrolled

    // Any tenant member reads the null-course video by id.
    const byId = await app.inject({
      method: "GET",
      url: `/videos/${nullCourse.id}`,
      headers: STUDENT_HEADERS,
    });
    expect(byId.statusCode).toBe(200);

    // The list for a non-enrolled member shows ONLY the null-course video.
    const list = await app.inject({
      method: "GET",
      url: "/videos",
      headers: STUDENT_HEADERS,
    });
    const videos = list.json().videos as Array<Record<string, unknown>>;
    expect(videos).toHaveLength(1);
    expect(videos[0]!.id).toBe(nullCourse.id);
    expect(videos[0]!.courseId).toBeNull();
  });

  it("keeps cross-tenant isolation on a course-scoped video (foreign tenant 404)", async () => {
    const app = buildTestApp(seededPolicy());
    const created = await createCourseVideo(app); // tenant A

    const getB = await app.inject({
      method: "GET",
      url: `/videos/${created.id}`,
      headers: {
        "x-tenant-id": TENANT_B_ID,
        "x-user-id": ENROLLED_STUDENT_ID,
        "x-user-roles": "student",
      },
    });
    expect(getB.statusCode).toBe(404);
  });

  // --- Pure helper unit tests -------------------------------------------
  it("parseCaptionTracks normalizes valid tracks to manual kind", () => {
    const result = parseCaptionTracks([
      { lang: "en", url: "https://blob.local/en.vtt" },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.captions[0]).toMatchObject({
        lang: "en",
        label: "en",
        kind: "manual",
      });
    }
  });

  it("parseCaptionTracks rejects a non-array", () => {
    const result = parseCaptionTracks("nope");
    expect(result.ok).toBe(false);
  });
});
