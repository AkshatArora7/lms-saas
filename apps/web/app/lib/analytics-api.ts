import { TENANT_ID } from "./auth";

/**
 * Server-only client for the analytics microservice.
 *
 * BFF read boundary for the instructor /teach dashboard: each call forwards the
 * authenticated tenant as `x-tenant-id` (the trusted header the gateway injects
 * in production and the analytics resolver expects), so all reporting stays
 * tenant-scoped. `/reports/engagement?courseId=` computes a per-course
 * engagement score + at-risk learner list LIVE across the existing domain tables
 * (enrollment, attendance, submission, grade) under RLS — analytics is the
 * reporting bounded context. Reads return a discriminated-union result rather
 * than throwing, so the Server Component renders a clean empty/offline state
 * with no demo fallback when the service is down or errors.
 *
 * Teacher scoping is a BFF concern: the page only calls this for courses the
 * signed-in instructor actually teaches (resolved in `teaching.ts`); the
 * endpoint itself is tenant-scoped only, matching `/reports/org-units`.
 */

export const ANALYTICS_SERVICE_URL =
  process.env.ANALYTICS_SERVICE_URL ?? "http://localhost:4015";

/** Why a learner was flagged at-risk; mirrors the backend `RiskReason`. */
export type RiskReasonCode =
  | "low_attendance"
  | "missing_submissions"
  | "low_grades";

export interface RiskReason {
  code: RiskReasonCode;
  /** The learner's measured value for this signal (e.g. attendance %). */
  metric: number;
  /** The threshold the metric fell short of. */
  threshold: number;
}

export type RiskLevel = "high" | "medium";

/** One flagged learner. `displayName` is intentionally null until roster name
 * enrichment lands (#278/#279) — render `learnerId` as the label for now. */
export interface AtRiskLearner {
  learnerId: string;
  displayName: string | null;
  riskLevel: RiskLevel;
  reasons: RiskReason[];
}

/** The three sub-metrics that feed the engagement score; each null when the
 * underlying signal has no data (no attendance / no assignments / no grades). */
export interface EngagementComponents {
  attendanceRate: number | null;
  submissionRate: number | null;
  gradeAverage: number | null;
}

export interface CourseEngagement {
  courseId: string;
  /** 0-100 (1 dp); null when NO component has data — render an empty state,
   * never 0% and never a fabricated number. */
  score: number | null;
  learnerCount: number;
  components: EngagementComponents;
}

/** The full `/reports/engagement` payload for one course. */
export interface CourseEngagementReport {
  engagement: CourseEngagement;
  atRisk: AtRiskLearner[];
}

export type CourseEngagementResult =
  | { ok: true; report: CourseEngagementReport }
  | { ok: false; error: string };

/**
 * Trusted identity headers for a direct (non-gateway) BFF call to analytics.
 *
 * The `/teach` page calls analytics directly from the server, bypassing the
 * gateway, so we forward the same three trusted headers the gateway would stamp
 * from verified claims (auth.ts): `x-tenant-id`, `x-user-id` (= session userId),
 * and `x-user-roles` (the roles joined EXACTLY as the gateway does —
 * `roles.join(",")`, comma-separated, no spaces; see
 * services/gateway/src/auth.ts). These come only from the server-side session,
 * never from any client-supplied value, so the analytics teacher-owns-course
 * guard (#284) can authorize the caller. Empty roles forward as "" (never
 * "undefined").
 */
function callerHeaders(
  tenantId: string,
  userId: string,
  roles: string[],
): HeadersInit {
  return {
    "x-tenant-id": tenantId,
    "x-user-id": userId,
    "x-user-roles": roles.join(","),
  };
}

const UNREACHABLE =
  "The analytics service is unreachable. Engagement insights are unavailable.";

/**
 * Fetch the per-course engagement score + at-risk learners for the tenant.
 * Returns a discriminated union so the caller renders error/empty/data states
 * without a try/catch at the render site; never throws to the page.
 *
 * `userId`/`roles` are the authenticated server-side session identity, forwarded
 * as trusted `x-user-id`/`x-user-roles` headers so the analytics authorization
 * guard (#284) — which 401s without a caller — accepts this direct BFF call.
 */
export async function getCourseEngagement(
  courseId: string,
  tenantId: string = TENANT_ID,
  userId: string,
  roles: string[],
): Promise<CourseEngagementResult> {
  try {
    const url = `${ANALYTICS_SERVICE_URL}/reports/engagement?courseId=${encodeURIComponent(
      courseId,
    )}`;
    const res = await fetch(url, {
      headers: callerHeaders(tenantId, userId, roles),
      cache: "no-store",
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      return {
        ok: false,
        error: data.message ?? "Failed to load engagement insights.",
      };
    }
    return { ok: true, report: (await res.json()) as CourseEngagementReport };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

/** Human-readable, text-first label + supplementary tone for each risk reason.
 * Colour is never the only signal — the label always conveys the reason. */
export const RISK_REASON_DISPLAY: Record<
  RiskReasonCode,
  { label: string; tone: "danger" | "warning" | "neutral" }
> = {
  low_attendance: { label: "Low attendance", tone: "warning" },
  missing_submissions: { label: "Missing work", tone: "warning" },
  low_grades: { label: "Low grades", tone: "danger" },
};

/** Text-first label + tone for a risk level. */
export const RISK_LEVEL_DISPLAY: Record<
  RiskLevel,
  { label: string; tone: "danger" | "warning" }
> = {
  high: { label: "High risk", tone: "danger" },
  medium: { label: "Medium risk", tone: "warning" },
};

/**
 * A short, stable label for a learner id until roster names arrive (#278/#279).
 * Shows the leading segment of the UUID, prefixed, so two learners never read
 * identically while staying clearly an id rather than a fabricated name.
 */
export function learnerLabel(learnerId: string): string {
  const head = learnerId.split("-")[0] ?? learnerId;
  return `Learner ${head}`;
}
