import { NextResponse } from "next/server";

import { getSession } from "../../../../../lib/auth";
import { sendTutorChat, MAX_MESSAGE_CHARS } from "../../../../../lib/ai-api";

/**
 * BFF for the learner AI tutor chat (#313). Mirrors the SCORM runtime BFF
 * (app/api/scorm/packages/[id]/runtime/route.ts): it resolves the authenticated
 * session and injects the SERVER-TRUSTED identity (session.tenantId +
 * session.userId) — the client never supplies tenant/user, so a learner can't
 * chat or read history as someone else.
 *
 *   POST -> send a question, get back { chatId, answer, citations }
 *
 * The ai service's 4xx/429 codes are passed through (with Retry-After for
 * rate-limit) so the client can render the right ErrorNotice (rate-limited vs
 * cost-ceiling vs validation). Citations are enriched with topic titles inside
 * the ai-api client before they reach the browser.
 */
export async function POST(
  req: Request,
  { params }: { params: { courseId: string } },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    message?: unknown;
    chatId?: unknown;
  };

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (message.length === 0) {
    return NextResponse.json(
      { error: "invalid_request" },
      { status: 400 },
    );
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const chatId =
    typeof body.chatId === "string" && body.chatId.trim().length > 0
      ? body.chatId.trim()
      : undefined;

  const result = await sendTutorChat(
    params.courseId,
    session.userId,
    { message, chatId },
    session.tenantId,
  );

  if (!result.ok) {
    const payload: { error: string; retryAfter?: number } = {
      error: result.code,
    };
    if (result.retryAfter !== undefined) payload.retryAfter = result.retryAfter;
    const res = NextResponse.json(payload, { status: result.status });
    if (result.retryAfter !== undefined) {
      res.headers.set("retry-after", String(result.retryAfter));
    }
    return res;
  }

  return NextResponse.json(result.data, { status: 200 });
}
