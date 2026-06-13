import type { TenantContext } from "@lms/types";

/** A course as returned by the service. */
export interface CourseRecord {
  id: string;
  tenantId: string;
  title: string;
  description: string | null;
  isPublished: boolean;
  startDate: string | null;
  endDate: string | null;
}

/** Fields accepted when creating a course. */
export interface NewCourseInput {
  title: string;
  description?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

/**
 * Persistence boundary for the course service. Routes depend only on this
 * interface, so production uses an RLS-scoped Postgres implementation while
 * tests inject an in-memory one (no database required) — mirroring the identity
 * service's design.
 */
export interface CourseStore {
  listCourses(ctx: TenantContext): Promise<CourseRecord[]>;

  getCourse(ctx: TenantContext, id: string): Promise<CourseRecord | null>;

  createCourse(
    ctx: TenantContext,
    input: NewCourseInput,
  ): Promise<CourseRecord>;

  /** Publish a course; returns the updated record or null if it doesn't exist. */
  publishCourse(
    ctx: TenantContext,
    id: string,
  ): Promise<CourseRecord | null>;
}
