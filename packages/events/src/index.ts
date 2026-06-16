import { z } from "zod";

/**
 * Transport-agnostic event contracts (the "Distributed Event Framework").
 * Producers publish; the analytics service and notification service consume.
 * Transport can be Postgres LISTEN/NOTIFY, Upstash/QStash, or Kafka later —
 * the envelope stays stable.
 */

export const EventEnvelope = z.object({
  id: z.string().uuid(),
  type: z.string(), // e.g. "enrollment.created"
  tenantId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  actorId: z.string().uuid().nullable(),
  /** Org unit the event is scoped to, when applicable. */
  orgUnitId: z.string().uuid().nullable(),
  version: z.number().int().default(1),
  payload: z.record(z.unknown()),
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;

/** Canonical event type registry — keep in sync across services. */
export const EVENT_TYPES = {
  TENANT_PROVISIONED: "tenant.provisioned",
  USER_CREATED: "user.created",
  USER_ROLE_ASSIGNED: "user.role_assigned",
  COURSE_PUBLISHED: "course.published",
  ENROLLMENT_CREATED: "enrollment.created",
  CONTENT_VIEWED: "content.viewed",
  ASSIGNMENT_SUBMITTED: "assignment.submitted",
  QUIZ_ATTEMPT_GRADED: "quiz.attempt_graded",
  GRADE_RELEASED: "grade.released",
  DISCUSSION_POST_CREATED: "discussion.post_created",
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export interface EventPublisher {
  publish(event: EventEnvelope): Promise<void>;
}

export interface EventConsumer {
  on(type: EventType, handler: (e: EventEnvelope) => Promise<void>): void;
}

// Concrete publisher + transport seam. The relay drains the outbox and calls
// OutboxPublisher.publish() per row; transports decide how the event is
// delivered (in-process for dev/test, HTTP to a consumer, QStash in future).
export {
  type EventTransport,
  type EventHandler,
  type RoutingTable,
  InProcessTransport,
  HttpTransport,
  type HttpTransportOptions,
} from "./transport.js";
export { OutboxPublisher } from "./publisher.js";
