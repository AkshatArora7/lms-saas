/**
 * HTTP adapter for the OneRoster 1.2 source port (issue #14).
 *
 * The thin network layer: it calls the OneRoster REST endpoints, applies the
 * delta `since` as a `filter`, carries a bearer token, and maps the JSON
 * envelopes (`{ orgs: [...] }`, `{ users: [...] }`, ...) onto the typed records
 * declared in `oneroster.ts`. It owns NO domain logic — the sync engine never
 * imports this module directly; `main.ts` wires it as the default client.
 */
import {
  OneRosterError,
  type ClassRecord,
  type EnrollmentRecord,
  type OneRosterClient,
  type OneRosterFetchOptions,
  type OrgRecord,
  type UserRecord,
} from "./oneroster.js";

export interface HttpOneRosterOptions {
  /** Base URL of the OneRoster REST root, e.g. https://sis.example/ims/oneroster/rostering/v1p2. */
  baseUrl: string;
  /** Bearer access token (client-credentials / API key); omitted in dev fakes. */
  token?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/** Raw OneRoster JSON shapes (only the fields we read). */
interface RawRef {
  sourcedId?: string | null;
}
interface RawOrg {
  sourcedId: string;
  name: string;
  type?: string;
  status?: string;
  parent?: RawRef | null;
}
interface RawUser {
  sourcedId: string;
  username?: string | null;
  givenName?: string;
  familyName?: string;
  email?: string | null;
  role?: string;
  roles?: { role?: string }[];
  status?: string;
}
interface RawClass {
  sourcedId: string;
  title: string;
  status?: string;
  school?: RawRef | null;
  org?: RawRef | null;
}
interface RawEnrollment {
  sourcedId: string;
  status?: string;
  role?: string;
  class?: RawRef | null;
  user?: RawRef | null;
}

/**
 * OneRoster REST source. Maps the documented JSON envelopes onto the port's
 * record shapes; throws {@link OneRosterError} on any non-2xx so the engine can
 * fail the run. `since` becomes the OneRoster `filter=dateLastModified>'<since>'`.
 */
export function createHttpOneRosterClient(
  opts: HttpOneRosterOptions,
): OneRosterClient {
  const base = opts.baseUrl.replace(/\/$/, "");
  const doFetch = opts.fetchImpl ?? fetch;

  function url(path: string, since?: string): string {
    if (!since) return `${base}${path}`;
    const filter = encodeURIComponent(`dateLastModified>'${since}'`);
    return `${base}${path}?filter=${filter}`;
  }

  async function call<T>(path: string, key: string, since?: string): Promise<T[]> {
    let res: Response;
    try {
      res = await doFetch(url(path, since), {
        headers: {
          accept: "application/json",
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        },
      });
    } catch (err) {
      throw new OneRosterError(
        0,
        `OneRoster ${path} unreachable: ${(err as Error).message}`,
      );
    }
    if (!res.ok) {
      throw new OneRosterError(res.status, `OneRoster ${path} -> ${res.status}`);
    }
    let body: Record<string, unknown>;
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      throw new OneRosterError(res.status, `OneRoster ${path} returned non-JSON`);
    }
    const list = body[key];
    return Array.isArray(list) ? (list as T[]) : [];
  }

  return {
    async listOrgs(o?: OneRosterFetchOptions): Promise<OrgRecord[]> {
      const raw = await call<RawOrg>("/orgs", "orgs", o?.since);
      return raw.map((r) => ({
        sourcedId: r.sourcedId,
        name: r.name,
        type: r.type ?? "school",
        parentSourcedId: r.parent?.sourcedId ?? null,
        ...(r.status ? { status: r.status } : {}),
      }));
    },
    async listUsers(o?: OneRosterFetchOptions): Promise<UserRecord[]> {
      const raw = await call<RawUser>("/users", "users", o?.since);
      return raw.map((r) => ({
        sourcedId: r.sourcedId,
        username: r.username ?? null,
        givenName: r.givenName ?? "",
        familyName: r.familyName ?? "",
        email: r.email ?? null,
        role: r.role ?? r.roles?.[0]?.role ?? "student",
        ...(r.status ? { status: r.status } : {}),
      }));
    },
    async listClasses(o?: OneRosterFetchOptions): Promise<ClassRecord[]> {
      const raw = await call<RawClass>("/classes", "classes", o?.since);
      return raw.map((r) => ({
        sourcedId: r.sourcedId,
        title: r.title,
        orgSourcedId: r.school?.sourcedId ?? r.org?.sourcedId ?? "",
        ...(r.status ? { status: r.status } : {}),
      }));
    },
    async listEnrollments(o?: OneRosterFetchOptions): Promise<EnrollmentRecord[]> {
      const raw = await call<RawEnrollment>(
        "/enrollments",
        "enrollments",
        o?.since,
      );
      return raw.map((r) => ({
        sourcedId: r.sourcedId,
        classSourcedId: r.class?.sourcedId ?? "",
        userSourcedId: r.user?.sourcedId ?? "",
        role: r.role ?? "student",
        ...(r.status ? { status: r.status } : {}),
      }));
    },
  };
}
