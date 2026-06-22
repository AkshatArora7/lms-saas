import { NextResponse } from "next/server";

import { getSession } from "../../../../../lib/auth";
import {
  getScormAttempt,
  saveScormAttempt,
  type SaveScormRuntimeInput,
  type ScormCompletionStatus,
  type ScormSuccessStatus,
} from "../../../../../lib/scorm-api";

/**
 * BFF for the learner SCORM runtime (#31). Both methods resolve the
 * authenticated session and inject the SERVER-TRUSTED learnerId
 * (session.userId) — the client never supplies its own learnerId, so a learner
 * can't read or record progress as someone else. The tenant is forwarded as
 * x-tenant-id, mirroring the other web BFF routes.
 *
 *   GET  -> current attempt (or null)
 *   PUT  -> upsert the runtime state (Mark complete / report a score)
 */

const COMPLETION: readonly ScormCompletionStatus[] = [
  "completed",
  "incomplete",
  "not_attempted",
  "unknown",
];
const SUCCESS: readonly ScormSuccessStatus[] = ["passed", "failed", "unknown"];

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await getScormAttempt(
    params.id,
    session.userId,
    session.tenantId,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ attempt: result.attempt });
}

export async function PUT(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const input: SaveScormRuntimeInput = {};

  if (
    typeof body.completionStatus === "string" &&
    (COMPLETION as readonly string[]).includes(body.completionStatus)
  ) {
    input.completionStatus = body.completionStatus as ScormCompletionStatus;
  }
  if (
    typeof body.successStatus === "string" &&
    (SUCCESS as readonly string[]).includes(body.successStatus)
  ) {
    input.successStatus = body.successStatus as ScormSuccessStatus;
  }
  if (typeof body.scoreRaw === "number" && Number.isFinite(body.scoreRaw)) {
    input.scoreRaw = body.scoreRaw;
  }
  if (typeof body.scoreMax === "number" && Number.isFinite(body.scoreMax)) {
    input.scoreMax = body.scoreMax;
  }
  if (typeof body.scoreScaled === "number" && Number.isFinite(body.scoreScaled)) {
    input.scoreScaled = body.scoreScaled;
  }
  if (typeof body.lessonStatus === "string") {
    input.lessonStatus = body.lessonStatus;
  }
  if (typeof body.sessionTime === "string") {
    input.sessionTime = body.sessionTime;
  }

  // Default to a completion record when the client sent nothing meaningful, so
  // the explicit "Mark complete" path always advances the learner.
  if (input.completionStatus === undefined && input.scoreRaw === undefined) {
    input.completionStatus = "completed";
  }

  const result = await saveScormAttempt(
    params.id,
    session.userId,
    input,
    session.tenantId,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ attempt: result.attempt });
}
