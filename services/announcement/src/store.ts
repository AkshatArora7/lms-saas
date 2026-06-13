import type { TenantContext } from "@lms/types";

/** Visibility state derived from publish/expiry timestamps. */
export type AnnouncementStatus = "scheduled" | "published" | "expired";

/** A course/org-unit-scoped announcement with scheduled publish and expiry. */
export interface AnnouncementRecord {
  id: string;
  tenantId: string;
  orgUnitId: string;
  authorId: string | null;
  title: string;
  body: string;
  publishAt: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface NewAnnouncementInput {
  orgUnitId: string;
  authorId?: string | null;
  title: string;
  body: string;
  publishAt?: string | null;
  expiresAt?: string | null;
}

export interface UpdateAnnouncementInput {
  title?: string;
  body?: string;
  publishAt?: string | null;
  expiresAt?: string | null;
}

/**
 * Persistence boundary for the announcement service. Routes depend only on this
 * interface, so production uses an RLS-scoped Postgres implementation while
 * tests inject an in-memory one — mirroring the other domain services.
 */
export interface AnnouncementStore {
  create(
    ctx: TenantContext,
    input: NewAnnouncementInput,
  ): Promise<AnnouncementRecord>;

  get(ctx: TenantContext, id: string): Promise<AnnouncementRecord | null>;

  /** All announcements for an org unit (newest publish first). */
  listForOrgUnit(
    ctx: TenantContext,
    orgUnitId: string,
    opts?: { visibleOnly?: boolean; now?: Date },
  ): Promise<AnnouncementRecord[]>;

  update(
    ctx: TenantContext,
    id: string,
    input: UpdateAnnouncementInput,
  ): Promise<AnnouncementRecord | null>;

  /** Bring an announcement's publish time forward to now ("publish now"). */
  publishNow(
    ctx: TenantContext,
    id: string,
    now?: Date,
  ): Promise<AnnouncementRecord | null>;

  remove(ctx: TenantContext, id: string): Promise<boolean>;
}

/** True when `record` is live at `now` (published and not expired). */
export function isVisible(record: AnnouncementRecord, now: Date): boolean {
  const at = now.getTime();
  if (new Date(record.publishAt).getTime() > at) return false;
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= at) {
    return false;
  }
  return true;
}

/** Classify an announcement as scheduled / published / expired at `now`. */
export function statusOf(
  record: AnnouncementRecord,
  now: Date,
): AnnouncementStatus {
  const at = now.getTime();
  if (new Date(record.publishAt).getTime() > at) return "scheduled";
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= at) {
    return "expired";
  }
  return "published";
}
