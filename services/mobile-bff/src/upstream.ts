/**
 * Upstream access for the mobile BFF.
 *
 * The BFF owns no database — it aggregates domain data from the existing
 * services. Routes depend only on the {@link UpstreamClient} interface, so
 * production talks to the API gateway over HTTP (which re-verifies the bearer
 * token and scopes RLS), while tests inject a fake. This mirrors the
 * store-abstraction other services use, applied to a composition layer.
 */

export interface CourseSummary {
  id: string;
  title: string;
  [key: string]: unknown;
}

export interface CalendarItem {
  id: string;
  title: string;
  startsAt: string;
  [key: string]: unknown;
}

export interface NotificationItem {
  id: string;
  title: string;
  readAt: string | null;
  [key: string]: unknown;
}

export interface SubmissionResult {
  id: string;
  status: string;
  [key: string]: unknown;
}

export interface DeviceRegistration {
  id: string;
  platform: DevicePlatform;
  [key: string]: unknown;
}

export type DevicePlatform = "ios" | "android" | "web";

export interface DeviceInput {
  platform: DevicePlatform;
  /** Provider push token (APNs/FCM/WebPush). */
  pushToken: string;
}

/** Pull the bearer token from an Authorization header value. */
export function bearerToken(header: string | undefined): string | null {
  const [scheme, token] = (header ?? "").split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

/** Everything the BFF needs to act on a caller's behalf against upstream. */
export interface UpstreamContext {
  /** The caller's bearer access token, forwarded verbatim upstream. */
  token: string;
  tenantId: string;
  userId: string;
}

export interface UpstreamClient {
  listEnrolledCourses(ctx: UpstreamContext): Promise<CourseSummary[]>;
  listDueSoon(ctx: UpstreamContext, limit?: number): Promise<CalendarItem[]>;
  unreadCount(ctx: UpstreamContext): Promise<number>;
  listNotifications(ctx: UpstreamContext): Promise<NotificationItem[]>;
  getCourse(
    ctx: UpstreamContext,
    courseId: string,
  ): Promise<CourseSummary | null>;
  listCourseAssignments(
    ctx: UpstreamContext,
    courseId: string,
  ): Promise<unknown[]>;
  submitAssignment(
    ctx: UpstreamContext,
    assignmentId: string,
    payload: Record<string, unknown>,
  ): Promise<SubmissionResult>;
  /** Register a device push token (delivery is owned by the notification service). */
  registerDevice(
    ctx: UpstreamContext,
    input: DeviceInput,
  ): Promise<DeviceRegistration>;
}

export interface HttpUpstreamOptions {
  /** Base URL of the API gateway, e.g. http://gateway:4000. */
  gatewayUrl: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/** Thrown when an upstream call returns a non-2xx so routes can map status. */
export class UpstreamError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

/**
 * Gateway-backed upstream client. Every request forwards the caller's bearer
 * token; the gateway authenticates it and resolves the tenant, so the BFF never
 * re-implements tenant routing. Paths are the gateway's service-prefixed routes
 * and are kept as named constants so they track upstream contracts.
 */
export function createHttpUpstreamClient(
  opts: HttpUpstreamOptions,
): UpstreamClient {
  const base = opts.gatewayUrl.replace(/\/$/, "");
  const doFetch = opts.fetchImpl ?? fetch;

  async function call<T>(
    ctx: UpstreamContext,
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const res = await doFetch(`${base}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${ctx.token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new UpstreamError(res.status, `upstream ${path} -> ${res.status}`);
    }
    return (await res.json()) as T;
  }

  return {
    async listEnrolledCourses(ctx) {
      const body = await call<{ courses?: CourseSummary[] }>(
        ctx,
        `/enrollment/users/${encodeURIComponent(ctx.userId)}/courses`,
      );
      return body.courses ?? [];
    },
    async listDueSoon(ctx, limit = 5) {
      const body = await call<{ events?: CalendarItem[] }>(
        ctx,
        `/calendar/events?from=now&limit=${limit}`,
      );
      return body.events ?? [];
    },
    async unreadCount(ctx) {
      const body = await call<{ notifications?: NotificationItem[] }>(
        ctx,
        `/notification/users/${encodeURIComponent(ctx.userId)}/notifications?unread=true`,
      );
      return body.notifications?.length ?? 0;
    },
    async listNotifications(ctx) {
      const body = await call<{ notifications?: NotificationItem[] }>(
        ctx,
        `/notification/users/${encodeURIComponent(ctx.userId)}/notifications`,
      );
      return body.notifications ?? [];
    },
    async getCourse(ctx, courseId) {
      try {
        const body = await call<{ course?: CourseSummary }>(
          ctx,
          `/course/courses/${encodeURIComponent(courseId)}`,
        );
        return body.course ?? null;
      } catch (err) {
        if (err instanceof UpstreamError && err.status === 404) return null;
        throw err;
      }
    },
    async listCourseAssignments(ctx, courseId) {
      const body = await call<{ assignments?: unknown[] }>(
        ctx,
        `/assignment/courses/${encodeURIComponent(courseId)}/assignments`,
      );
      return body.assignments ?? [];
    },
    async submitAssignment(ctx, assignmentId, payload) {
      const body = await call<{ submission: SubmissionResult }>(
        ctx,
        `/assignment/assignments/${encodeURIComponent(assignmentId)}/submissions`,
        { method: "POST", body: JSON.stringify(payload) },
      );
      return body.submission;
    },
    async registerDevice(ctx, input) {
      const body = await call<{ device: DeviceRegistration }>(
        ctx,
        `/notification/users/${encodeURIComponent(ctx.userId)}/devices`,
        { method: "POST", body: JSON.stringify(input) },
      );
      return body.device;
    },
  };
}
