/**
 * OneRoster 1.2 source PORT for the sis service (issue #14).
 *
 * The roster source is an injectable client interface — exactly like the mobile
 * BFF's {@link UpstreamClient} and the tenant service's offboarding ports — so
 * the sync engine is network-free in tests (inject a fake) while production
 * talks OneRoster REST over HTTP (see `oneroster.http.ts`). This file declares
 * ONLY the contract + record shapes + the error type; it performs no I/O.
 */

/** Options every list call accepts. */
export interface OneRosterFetchOptions {
  /**
   * RFC3339 timestamp. When set, the source returns only records modified
   * at/after this instant — the delta (incremental) sync watermark. Omitted for
   * a full sync.
   */
  since?: string;
}

/** OneRoster `/orgs` record (the bits the roster sync consumes). */
export interface OrgRecord {
  sourcedId: string;
  name: string;
  /** 'district' | 'school' | 'department' | ... */
  type: string;
  /** `org.parent.sourcedId`, when this org hangs off another. */
  parentSourcedId?: string | null;
  /** 'active' | 'tobedeleted'. */
  status?: string;
}

/** OneRoster `/users` record. */
export interface UserRecord {
  sourcedId: string;
  username?: string | null;
  givenName: string;
  familyName: string;
  email?: string | null;
  /** 'student' | 'teacher' | 'administrator' | ... */
  role: string;
  /** 'active' | 'tobedeleted'. */
  status?: string;
}

/** OneRoster `/classes` record. A class maps to an org_unit + course pair. */
export interface ClassRecord {
  sourcedId: string;
  title: string;
  /** `class.school.sourcedId` — the owning org. */
  orgSourcedId: string;
  status?: string;
}

/** OneRoster `/enrollments` record. */
export interface EnrollmentRecord {
  sourcedId: string;
  /** `enrollment.class.sourcedId`. */
  classSourcedId: string;
  /** `enrollment.user.sourcedId`. */
  userSourcedId: string;
  /** 'student' | 'teacher' | ... */
  role: string;
  /** 'active' | 'inactive' | 'tobedeleted'. */
  status?: string;
}

/**
 * The roster source contract. Production = OneRoster REST/fetch adapter; tests
 * inject a fake. List calls accept an optional `since` for delta syncs.
 */
export interface OneRosterClient {
  listOrgs(opts?: OneRosterFetchOptions): Promise<OrgRecord[]>;
  listUsers(opts?: OneRosterFetchOptions): Promise<UserRecord[]>;
  listClasses(opts?: OneRosterFetchOptions): Promise<ClassRecord[]>;
  listEnrollments(opts?: OneRosterFetchOptions): Promise<EnrollmentRecord[]>;
}

/**
 * Thrown when the OneRoster source fails at the transport/auth layer (non-2xx,
 * unreachable, malformed envelope). A throw aborts the sync run, which the
 * engine records as `status='failed'` with the error in the run stats. Mirrors
 * the mobile BFF's `UpstreamError`.
 */
export class OneRosterError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "OneRosterError";
  }
}
