/**
 * Tenant offboarding & data export (issue #7).
 *
 * On contract end a district can (a) **export** all of a school's data as
 * OneRoster CSV + a content archive manifest, and (b) **purge** it across every
 * service, with the export/delete written to the tamper-evident audit log. The
 * tenant service ORCHESTRATES this; the per-service reads/deletes and the audit
 * append are behind the {@link OffboardingPorts} interface, so production wires
 * HTTP adapters while tests inject fakes — keeping it unit-testable with no DB.
 */

export interface OrgRow {
  sourcedId: string;
  name: string;
  type: string;
  parentSourcedId?: string | null;
}

export interface UserRow {
  sourcedId: string;
  username: string;
  givenName: string;
  familyName: string;
  email: string;
  role: string;
  enabled?: boolean;
}

export interface EnrollmentRow {
  sourcedId: string;
  classSourcedId: string;
  userSourcedId: string;
  role: string;
  status: string;
}

export interface AcademicSessionRow {
  sourcedId: string;
  title: string;
  type: string;
  startDate?: string | null;
  endDate?: string | null;
}

/** The roster slice exported as OneRoster CSV. */
export interface OneRosterData {
  orgs: OrgRow[];
  users: UserRow[];
  enrollments: EnrollmentRow[];
  academicSessions: AcademicSessionRow[];
}

/** An item in the content archive manifest (file/page/upload). */
export interface ContentArchiveItem {
  id: string;
  type: string;
  title: string;
  url?: string | null;
}

/** Result of purging one service's data for a tenant. */
export interface PurgeResult {
  service: string;
  ok: boolean;
  /** Rows/objects removed, when the service reports it. */
  purged?: number;
  error?: string;
}

export interface AuditEvent {
  action: string;
  actorId?: string | null;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Every tenant-scoped service whose data a purge must fan out to. Kept explicit
 * so a missing target is a visible omission, not a silent data remnant.
 */
export const PURGE_TARGETS: readonly string[] = [
  "user-org",
  "enrollment",
  "course",
  "content",
  "assignment",
  "assessment",
  "grading",
  "rubric",
  "discussion",
  "calendar",
  "attendance",
  "announcement",
  "notification",
  "billing",
  "analytics",
  "ai",
  "video",
  "search",
  "sis",
  "lti",
  "audit",
];

/** Ports the offboarding orchestration depends on (HTTP in prod, fakes in test). */
export interface OffboardingPorts {
  exportRoster(tenantId: string): Promise<OneRosterData>;
  exportContent(tenantId: string): Promise<ContentArchiveItem[]>;
  /** Purge one service's data for the tenant; must be idempotent. */
  purge(tenantId: string, service: string): Promise<PurgeResult>;
  /** Append to the tamper-evident audit log (actor + hash chain). */
  audit(tenantId: string, event: AuditEvent): Promise<void>;
}

// --- Pure OneRoster CSV generation (RFC 4180) -----------------------------

/** Quote a CSV field if it contains a comma, quote, or newline. */
export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Render rows (array of ordered cell arrays) with a header into CSV text. */
export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header, ...rows].map((cells) => cells.map(csvCell).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** Build the OneRoster CSV file set from a roster slice. */
export function toOneRosterCsv(data: OneRosterData): Record<string, string> {
  return {
    "orgs.csv": toCsv(
      ["sourcedId", "name", "type", "parentSourcedId"],
      data.orgs.map((o) => [o.sourcedId, o.name, o.type, o.parentSourcedId ?? ""]),
    ),
    "users.csv": toCsv(
      ["sourcedId", "username", "givenName", "familyName", "email", "role", "enabledUser"],
      data.users.map((u) => [
        u.sourcedId,
        u.username,
        u.givenName,
        u.familyName,
        u.email,
        u.role,
        u.enabled === false ? "false" : "true",
      ]),
    ),
    "enrollments.csv": toCsv(
      ["sourcedId", "classSourcedId", "userSourcedId", "role", "status"],
      data.enrollments.map((e) => [
        e.sourcedId,
        e.classSourcedId,
        e.userSourcedId,
        e.role,
        e.status,
      ]),
    ),
    "academicSessions.csv": toCsv(
      ["sourcedId", "title", "type", "startDate", "endDate"],
      data.academicSessions.map((s) => [
        s.sourcedId,
        s.title,
        s.type,
        s.startDate ?? "",
        s.endDate ?? "",
      ]),
    ),
  };
}
