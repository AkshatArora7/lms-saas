import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

import type {
  CourseRecord,
  CourseStore,
  NewCourseInput,
} from "./store.js";

/**
 * In-memory CourseStore. Mirrors the RLS-backed Prisma store against a plain
 * array so the service can run (and be tested) with no Postgres. Rows are
 * filtered by tenant id to emulate the row-level isolation Postgres RLS
 * enforces in production. Used by the test suite and `COURSE_STORE=memory`.
 */
export class MemoryCourseStore implements CourseStore {
  private courses: CourseRecord[] = [];

  constructor(private readonly generateId: () => string = randomUUID) {}

  seed(course: CourseRecord): void {
    this.courses.push(course);
  }

  async listCourses(ctx: TenantContext): Promise<CourseRecord[]> {
    return this.courses.filter((c) => c.tenantId === ctx.tenantId);
  }

  async getCourse(
    ctx: TenantContext,
    id: string,
  ): Promise<CourseRecord | null> {
    return (
      this.courses.find((c) => c.id === id && c.tenantId === ctx.tenantId) ??
      null
    );
  }

  async createCourse(
    ctx: TenantContext,
    input: NewCourseInput,
  ): Promise<CourseRecord> {
    const course: CourseRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      title: input.title,
      description: input.description ?? null,
      isPublished: false,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
    };
    this.courses.push(course);
    return course;
  }

  async publishCourse(
    ctx: TenantContext,
    id: string,
  ): Promise<CourseRecord | null> {
    const course = this.courses.find(
      (c) => c.id === id && c.tenantId === ctx.tenantId,
    );
    if (!course) return null;
    course.isPublished = true;
    return course;
  }
}

/** The demo tenant the local dev seed and the web BFFs agree on. */
export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

/** Build a MemoryCourseStore pre-seeded with a couple of demo courses. */
export function createSeededMemoryStore(
  generateId: () => string = randomUUID,
): MemoryCourseStore {
  const store = new MemoryCourseStore(generateId);
  store.seed({
    id: "demo-course-anatomy",
    tenantId: DEMO_TENANT_ID,
    title: "Human Anatomy 101",
    description: "Foundations of human anatomy.",
    isPublished: true,
    startDate: null,
    endDate: null,
  });
  store.seed({
    id: "demo-course-algebra",
    tenantId: DEMO_TENANT_ID,
    title: "Algebra I",
    description: "Introductory algebra.",
    isPublished: false,
    startDate: null,
    endDate: null,
  });
  return store;
}
