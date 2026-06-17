import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

import type {
  AnnotationRecord,
  AnnotationStore,
  CreateAnnotationResult,
  NewAnnotationInput,
  ReleaseResult,
  UpdateAnnotationInput,
} from "./annotations.js";

export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

interface Sub {
  tenantId: string;
  submissionId: string;
  userId: string;
}

/**
 * In-memory annotation store. Annotations are tenant-filtered (RLS emulation).
 * Submissions are seeded so create/release can validate and resolve the
 * recipient learner.
 */
export class MemoryAnnotationStore implements AnnotationStore {
  private annotations: AnnotationRecord[] = [];
  private submissions: Sub[] = [];

  constructor(private readonly generateId: () => string = randomUUID) {}

  /** Seed a submission so its annotations can be created/released. */
  seedSubmission(tenantId: string, submissionId: string, userId: string): void {
    this.submissions.push({ tenantId, submissionId, userId });
  }

  private sub(ctx: TenantContext, submissionId: string): Sub | undefined {
    return this.submissions.find(
      (s) => s.tenantId === ctx.tenantId && s.submissionId === submissionId,
    );
  }

  async createAnnotation(
    ctx: TenantContext,
    submissionId: string,
    input: NewAnnotationInput,
  ): Promise<CreateAnnotationResult> {
    if (!this.sub(ctx, submissionId)) {
      return { ok: false, reason: "submission_not_found" };
    }
    const annotation: AnnotationRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      submissionId,
      authorId: input.authorId ?? null,
      body: input.body,
      anchor: input.anchor ?? {},
      released: false,
      createdAt: new Date(0).toISOString(),
    };
    this.annotations.push(annotation);
    return { ok: true, annotation };
  }

  async listAnnotations(
    ctx: TenantContext,
    submissionId: string,
    opts: { releasedOnly?: boolean } = {},
  ): Promise<AnnotationRecord[]> {
    return this.annotations.filter(
      (a) =>
        a.tenantId === ctx.tenantId &&
        a.submissionId === submissionId &&
        (!opts.releasedOnly || a.released),
    );
  }

  async updateAnnotation(
    ctx: TenantContext,
    id: string,
    input: UpdateAnnotationInput,
  ): Promise<AnnotationRecord | null> {
    const a = this.annotations.find(
      (x) => x.id === id && x.tenantId === ctx.tenantId,
    );
    if (!a) return null;
    if (input.body !== undefined) a.body = input.body;
    if (input.anchor !== undefined) a.anchor = input.anchor;
    return a;
  }

  async deleteAnnotation(ctx: TenantContext, id: string): Promise<boolean> {
    const before = this.annotations.length;
    this.annotations = this.annotations.filter(
      (a) => !(a.id === id && a.tenantId === ctx.tenantId),
    );
    return this.annotations.length < before;
  }

  async releaseFeedback(
    ctx: TenantContext,
    submissionId: string,
  ): Promise<ReleaseResult> {
    const sub = this.sub(ctx, submissionId);
    if (!sub) return { ok: false, reason: "submission_not_found" };
    let released = 0;
    for (const a of this.annotations) {
      if (
        a.tenantId === ctx.tenantId &&
        a.submissionId === submissionId &&
        !a.released
      ) {
        a.released = true;
        released += 1;
      }
    }
    return { ok: true, released, recipientId: sub.userId };
  }
}
