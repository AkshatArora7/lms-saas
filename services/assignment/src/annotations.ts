import type { TenantContext } from "@lms/types";

/** An inline feedback comment on a submission. */
export interface AnnotationRecord {
  id: string;
  tenantId: string;
  submissionId: string;
  authorId: string | null;
  body: string;
  /** Locates the comment (page/line/range/quoted text). */
  anchor: Record<string, unknown>;
  released: boolean;
  createdAt: string;
}

export interface NewAnnotationInput {
  body: string;
  anchor?: Record<string, unknown>;
  authorId?: string | null;
}

export interface UpdateAnnotationInput {
  body?: string;
  anchor?: Record<string, unknown>;
}

export type CreateAnnotationResult =
  | { ok: true; annotation: AnnotationRecord }
  | { ok: false; reason: "submission_not_found" };

/** Result of releasing feedback: counts + the recipient learner to notify. */
export type ReleaseResult =
  | { ok: true; released: number; recipientId: string }
  | { ok: false; reason: "submission_not_found" };

/**
 * Persistence boundary for submission annotations. Separate from the core
 * assignment/submission store so that path is untouched; both are RLS-scoped
 * via withTenant.
 */
export interface AnnotationStore {
  createAnnotation(
    ctx: TenantContext,
    submissionId: string,
    input: NewAnnotationInput,
  ): Promise<CreateAnnotationResult>;

  /** List annotations for a submission; `releasedOnly` for the learner view. */
  listAnnotations(
    ctx: TenantContext,
    submissionId: string,
    opts?: { releasedOnly?: boolean },
  ): Promise<AnnotationRecord[]>;

  updateAnnotation(
    ctx: TenantContext,
    id: string,
    input: UpdateAnnotationInput,
  ): Promise<AnnotationRecord | null>;

  deleteAnnotation(ctx: TenantContext, id: string): Promise<boolean>;

  /**
   * Release all of a submission's feedback: mark annotations released, set the
   * submission 'returned', and emit submission.feedback_released so the learner
   * is notified. Returns the recipient (submission owner).
   */
  releaseFeedback(
    ctx: TenantContext,
    submissionId: string,
  ): Promise<ReleaseResult>;
}
