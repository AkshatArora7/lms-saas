import { TENANT_ID } from "./auth";

/**
 * Server-only client for the grading (gradebook) microservice.
 *
 * BFF read boundary for the learner's own grades. The student view endpoint
 * returns only released grades plus a projected final grade; the gradebook
 * endpoint supplies the item/category metadata (names, weights) needed to label
 * the breakdown. Forwards the authenticated tenant as `x-tenant-id`; reads
 * return `null` on failure so the Server Component renders a clean state.
 */

export const GRADING_SERVICE_URL =
  process.env.GRADING_SERVICE_URL ?? "http://localhost:4009";

export interface GradeRecord {
  id: string;
  tenantId: string;
  gradeItemId: string;
  userId: string;
  points: number | null;
  feedback: string | null;
  isReleased: boolean;
  gradedBy: string | null;
  gradedAt: string | null;
  updatedAt: string;
}

export interface FinalGrade {
  userId: string;
  percent: number;
  symbol: string | null;
  gradedItems: number;
}

export interface GradeItem {
  id: string;
  tenantId: string;
  courseId: string;
  categoryId: string | null;
  name: string;
  maxPoints: number;
  weight: number | null;
  position: number;
}

export interface GradeCategory {
  id: string;
  tenantId: string;
  courseId: string;
  name: string;
  weight: number | null;
  position: number;
}

export interface Gradebook {
  courseId: string;
  categories: GradeCategory[];
  items: GradeItem[];
  grades: GradeRecord[];
}

export interface StudentGrades {
  grades: GradeRecord[];
  projected: FinalGrade;
}

function tenantHeader(tenantId: string): HeadersInit {
  return { "x-tenant-id": tenantId };
}

/** The learner's released grades + projected final for one course. */
export async function getStudentGrades(
  courseId: string,
  userId: string,
  tenantId: string = TENANT_ID,
): Promise<StudentGrades | null> {
  try {
    const res = await fetch(
      `${GRADING_SERVICE_URL}/courses/${encodeURIComponent(courseId)}/students/${encodeURIComponent(userId)}/grades`,
      { headers: tenantHeader(tenantId), cache: "no-store" },
    );
    if (!res.ok) return null;
    return (await res.json()) as StudentGrades;
  } catch {
    return null;
  }
}

/** Full gradebook for a course — used for item/category metadata only. */
export async function getGradebook(
  courseId: string,
  tenantId: string = TENANT_ID,
): Promise<Gradebook | null> {
  try {
    const res = await fetch(
      `${GRADING_SERVICE_URL}/courses/${encodeURIComponent(courseId)}/gradebook`,
      { headers: tenantHeader(tenantId), cache: "no-store" },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { gradebook: Gradebook };
    return data.gradebook ?? null;
  } catch {
    return null;
  }
}
