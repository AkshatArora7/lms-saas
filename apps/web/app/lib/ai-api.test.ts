import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the server-only ai-api client (#313).
 *
 * Pure unit tests: global `fetch` and the content-api enrichment helpers
 * (`listModules`/`listTopics`) are mocked — no ai service, no content service,
 * no Postgres. Asserts the request shape (identity headers, body, method), the
 * error/429 mapping (incl. Retry-After), and best-effort citation enrichment
 * (title resolved vs fallback, href always built).
 */

const listModules = vi.fn();
const listTopics = vi.fn();
vi.mock("./content-api", () => ({
  listModules: (...args: unknown[]) => listModules(...args),
  listTopics: (...args: unknown[]) => listTopics(...args),
}));

import { sendTutorChat, enrichCitations } from "./ai-api";

const TENANT = "tenant-1";
const USER = "user-1";
const COURSE = "course-9";

describe("sendTutorChat", () => {
  beforeEach(() => {
    listModules.mockReset();
    listTopics.mockReset();
    vi.unstubAllGlobals();
    // No citations by default -> enrichment short-circuits, no content calls.
    listModules.mockResolvedValue([]);
    listTopics.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the ai service with identity headers, JSON body and no chatId on a fresh send", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ chatId: "chat-1", answer: "Hello.", citations: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendTutorChat(
      COURSE,
      USER,
      { message: "How does X work?" },
      TENANT,
    );

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/courses/${COURSE}/chat`);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-tenant-id"]).toBe(TENANT);
    expect(headers["x-user-id"]).toBe(USER);
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({
      message: "How does X work?",
    });
  });

  it("threads the chatId into the request body when continuing a chat", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ chatId: "chat-7", answer: "More.", citations: [] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendTutorChat(COURSE, USER, { message: "again", chatId: "chat-7" }, TENANT);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      message: "again",
      chatId: "chat-7",
    });
  });

  it("enriches citations with resolved topic titles and an item href", async () => {
    listModules.mockResolvedValue([{ id: "mod-1" }]);
    listTopics.mockResolvedValue([
      { id: "topic-a", title: "Cellular Respiration" },
    ]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          chatId: "chat-1",
          answer: "Grounded answer. [1]",
          citations: [
            { sourceType: "content_topic", sourceId: "topic-a", chunk: "snippet", score: 0.9 },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendTutorChat(COURSE, USER, { message: "q" }, TENANT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.citations).toHaveLength(1);
    const citation = result.data.citations[0]!;
    expect(citation.title).toBe("Cellular Respiration");
    expect(citation.href).toBe(`/courses/${COURSE}/items/topic-a`);
    expect(citation.chunk).toBe("snippet");
  });

  it("falls back to title:null (chip label resolved by the client) for an unresolved topic", async () => {
    listModules.mockResolvedValue([{ id: "mod-1" }]);
    listTopics.mockResolvedValue([{ id: "other", title: "Unrelated" }]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          chatId: "chat-1",
          answer: "Answer.",
          citations: [
            { sourceType: "content_topic", sourceId: "missing", chunk: "c", score: 0.5 },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendTutorChat(COURSE, USER, { message: "q" }, TENANT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.citations[0]!.title).toBeNull();
    expect(result.data.citations[0]!.href).toBe(`/courses/${COURSE}/items/missing`);
  });

  it("maps a 429 cost_exceeded to a typed result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "cost_exceeded" }), { status: 429 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendTutorChat(COURSE, USER, { message: "q" }, TENANT);

    expect(result).toEqual({ ok: false, status: 429, code: "cost_exceeded" });
  });

  it("maps a 429 rate_limited and parses Retry-After (seconds)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: { "retry-after": "45" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendTutorChat(COURSE, USER, { message: "q" }, TENANT);

    expect(result).toEqual({
      ok: false,
      status: 429,
      code: "rate_limited",
      retryAfter: 45,
    });
  });

  it("falls back to RateLimit-Reset when Retry-After is absent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: { "ratelimit-reset": "12" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendTutorChat(COURSE, USER, { message: "q" }, TENANT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("rate_limited");
    expect(result.retryAfter).toBe(12);
  });

  it("maps a 400 invalid_request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_request" }), { status: 400 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendTutorChat(COURSE, USER, { message: "q" }, TENANT);

    expect(result).toEqual({ ok: false, status: 400, code: "invalid_request" });
  });

  it("maps a 404 not_found (stale/unowned chatId)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "not_found" }), { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendTutorChat(
      COURSE,
      USER,
      { message: "q", chatId: "stale" },
      TENANT,
    );

    expect(result).toEqual({ ok: false, status: 404, code: "not_found" });
  });

  it("maps a network failure to an 'unavailable' result without throwing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendTutorChat(COURSE, USER, { message: "q" }, TENANT);

    expect(result).toEqual({ ok: false, status: 503, code: "unavailable" });
  });
});

describe("enrichCitations", () => {
  beforeEach(() => {
    listModules.mockReset();
    listTopics.mockReset();
  });

  it("returns [] for no citations without touching the content service", async () => {
    const result = await enrichCitations(COURSE, [], TENANT);
    expect(result).toEqual([]);
    expect(listModules).not.toHaveBeenCalled();
  });

  it("keeps title:null and still builds the href when enrichment fails", async () => {
    listModules.mockRejectedValue(new Error("content down"));

    const result = await enrichCitations(
      COURSE,
      [{ sourceType: "content_topic", sourceId: "topic-x", chunk: "c", score: 1 }],
      TENANT,
    );

    expect(result[0]!.title).toBeNull();
    expect(result[0]!.href).toBe(`/courses/${COURSE}/items/topic-x`);
  });
});
