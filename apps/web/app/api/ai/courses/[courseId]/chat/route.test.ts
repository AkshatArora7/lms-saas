import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the AI tutor BFF route (#313).
 *
 * Pure unit tests: the auth lib (`getSession`) and the server-only ai-api client
 * (`sendTutorChat`) are mocked, so there is no Next runtime, no identity service,
 * no ai service and no Postgres. `next/server` `NextResponse` is the real
 * Web-standard implementation, so we can read status/body/headers back.
 *
 * Asserts:
 *  - no session -> 401, the ai client is never called (identity is server-trusted);
 *  - a valid send stamps the SERVER-TRUSTED userId/tenantId (client never supplies them);
 *  - empty/whitespace and over-limit messages -> 400 invalid_request, no upstream call;
 *  - upstream 4xx/429 codes pass through with the same status + error code;
 *  - rate_limited passes through Retry-After (header + body).
 */

const getSession = vi.fn();
vi.mock("../../../../../lib/auth", () => ({
  getSession: () => getSession(),
}));

const sendTutorChat = vi.fn();
vi.mock("../../../../../lib/ai-api", () => ({
  sendTutorChat: (...args: unknown[]) => sendTutorChat(...args),
  // The route imports the real MAX_MESSAGE_CHARS constant.
  MAX_MESSAGE_CHARS: 4000,
}));

import { POST } from "./route";

const SESSION = {
  userId: "user-1",
  tenantId: "tenant-1",
  tier: "pro",
  roles: ["learner"],
  scopes: [],
  locale: "en",
};

function req(body: unknown): Request {
  return new Request("http://web.test/api/ai/courses/course-9/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const PARAMS = { params: { courseId: "course-9" } };

describe("POST /api/ai/courses/[courseId]/chat (BFF)", () => {
  beforeEach(() => {
    getSession.mockReset();
    sendTutorChat.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 and never calls the ai service when there is no session", async () => {
    getSession.mockResolvedValue(null);

    const res = await POST(req({ message: "hi" }), PARAMS);

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
    expect(sendTutorChat).not.toHaveBeenCalled();
  });

  it("stamps the server-trusted userId + tenantId from the session (client never supplies identity)", async () => {
    getSession.mockResolvedValue(SESSION);
    sendTutorChat.mockResolvedValue({
      ok: true,
      data: { chatId: "chat-1", answer: "An answer.", citations: [] },
    });

    // Even if the client tries to spoof identity in the body, it must be ignored.
    const res = await POST(
      req({ message: "  How does X work?  ", userId: "attacker", tenantId: "evil" }),
      PARAMS,
    );

    expect(res.status).toBe(200);
    expect(sendTutorChat).toHaveBeenCalledTimes(1);
    const [courseId, userId, input, tenantId] = sendTutorChat.mock
      .calls[0] as [string, string, { message: string; chatId?: string }, string];
    expect(courseId).toBe("course-9");
    expect(userId).toBe("user-1");
    expect(tenantId).toBe("tenant-1");
    // message is trimmed; no chatId on a fresh send.
    expect(input.message).toBe("How does X work?");
    expect(input.chatId).toBeUndefined();

    const body = (await res.json()) as { chatId: string; answer: string };
    expect(body.chatId).toBe("chat-1");
    expect(body.answer).toBe("An answer.");
  });

  it("threads the chatId through to the ai client when provided", async () => {
    getSession.mockResolvedValue(SESSION);
    sendTutorChat.mockResolvedValue({
      ok: true,
      data: { chatId: "chat-7", answer: "More.", citations: [] },
    });

    await POST(req({ message: "follow up", chatId: "chat-7" }), PARAMS);

    const [, , input] = sendTutorChat.mock.calls[0] as [
      string,
      string,
      { message: string; chatId?: string },
      string,
    ];
    expect(input.chatId).toBe("chat-7");
  });

  it("rejects an empty/whitespace message with 400 invalid_request and no upstream call", async () => {
    getSession.mockResolvedValue(SESSION);

    const res = await POST(req({ message: "   " }), PARAMS);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
    expect(sendTutorChat).not.toHaveBeenCalled();
  });

  it("rejects an over-limit message with 400 invalid_request and no upstream call", async () => {
    getSession.mockResolvedValue(SESSION);

    const res = await POST(req({ message: "x".repeat(4001) }), PARAMS);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
    expect(sendTutorChat).not.toHaveBeenCalled();
  });

  it("passes through a cost_exceeded 429 with the same status + error code (no retry)", async () => {
    getSession.mockResolvedValue(SESSION);
    sendTutorChat.mockResolvedValue({
      ok: false,
      status: 429,
      code: "cost_exceeded",
    });

    const res = await POST(req({ message: "hi" }), PARAMS);

    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string; retryAfter?: number };
    expect(body.error).toBe("cost_exceeded");
    expect(body.retryAfter).toBeUndefined();
  });

  it("passes through a rate_limited 429 with Retry-After on both header and body", async () => {
    getSession.mockResolvedValue(SESSION);
    sendTutorChat.mockResolvedValue({
      ok: false,
      status: 429,
      code: "rate_limited",
      retryAfter: 30,
    });

    const res = await POST(req({ message: "hi" }), PARAMS);

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    const body = (await res.json()) as { error: string; retryAfter?: number };
    expect(body.error).toBe("rate_limited");
    expect(body.retryAfter).toBe(30);
  });

  it("passes through a not_found 404 so the client can drop a stale chatId", async () => {
    getSession.mockResolvedValue(SESSION);
    sendTutorChat.mockResolvedValue({
      ok: false,
      status: 404,
      code: "not_found",
    });

    const res = await POST(req({ message: "hi", chatId: "stale" }), PARAMS);

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });
});
