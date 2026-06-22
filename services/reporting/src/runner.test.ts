import { describe, expect, it } from "vitest";

import {
  rollupCourseCompletion,
  type CompletionCourse,
  type CompletionEnrollment,
  type CompletionOrgUnit,
} from "./runner.js";

/**
 * Regression guard for #323: the course-completion rollup must aggregate
 * enrollments across a course offering's descendant SECTIONS, not equality-match
 * on the offering's own org_unit id (which previously matched zero rows → silent
 * enrolled=0/completed=0). These tests exercise the pure helper that mirrors the
 * DbReportRunner SQL's subtree semantics, so they run offline (no Postgres).
 */
describe("rollupCourseCompletion (#323 subtree join)", () => {
  // A course_offering node (the course's own org_unit) and a child SECTION whose
  // materialised path is [offeringId] — root-first and EXCLUDES self.
  const OFFERING_ID = "offering-1";
  const SECTION_ID = "section-a";

  const courses: CompletionCourse[] = [
    { id: "course-1", title: "Intro", orgUnitId: OFFERING_ID },
  ];
  const orgUnits: CompletionOrgUnit[] = [
    { id: OFFERING_ID, path: [] }, // offering is the subtree root here
    { id: SECTION_ID, path: [OFFERING_ID] }, // section's ancestor = the offering
  ];
  // Two enrollments on the child section; one completed.
  const enrollments: CompletionEnrollment[] = [
    { orgUnitId: SECTION_ID, status: "active" },
    { orgUnitId: SECTION_ID, status: "completed" },
  ];

  it("counts section-level enrollments toward the offering's course (NON-zero)", () => {
    const rows = rollupCourseCompletion(courses, orgUnits, enrollments);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      courseId: "course-1",
      title: "Intro",
      enrolled: 2,
      completed: 1,
    });
  });

  it("negative control: the OLD equality-only logic would have returned 0", () => {
    // Reproduce the defective join: enrollment.org_unit_id === course.org_unit_id.
    const oldEnrolled = enrollments.filter(
      (e) => e.orgUnitId === courses[0]!.orgUnitId,
    ).length;
    const oldCompleted = enrollments.filter(
      (e) => e.orgUnitId === courses[0]!.orgUnitId && e.status === "completed",
    ).length;
    expect(oldEnrolled).toBe(0);
    expect(oldCompleted).toBe(0);

    // The corrected helper, on the same data, reports the true counts.
    const rows = rollupCourseCompletion(courses, orgUnits, enrollments);
    expect(rows[0]!.enrolled).toBe(2);
    expect(rows[0]!.completed).toBe(1);
  });

  it("also counts an enrollment created directly on the offering node", () => {
    // `path` excludes self, so the offering must be matched by id separately.
    const direct: CompletionEnrollment[] = [
      { orgUnitId: OFFERING_ID, status: "completed" },
      { orgUnitId: SECTION_ID, status: "active" },
    ];
    const rows = rollupCourseCompletion(courses, orgUnits, direct);
    expect(rows[0]).toMatchObject({ enrolled: 2, completed: 1 });
  });

  it("does not count enrollments from a sibling offering's subtree", () => {
    const SIBLING_OFFERING = "offering-2";
    const SIBLING_SECTION = "section-z";
    const multi: CompletionCourse[] = [
      ...courses,
      { id: "course-2", title: "Advanced", orgUnitId: SIBLING_OFFERING },
    ];
    const multiOrgUnits: CompletionOrgUnit[] = [
      ...orgUnits,
      { id: SIBLING_OFFERING, path: [] },
      { id: SIBLING_SECTION, path: [SIBLING_OFFERING] },
    ];
    const multiEnrollments: CompletionEnrollment[] = [
      { orgUnitId: SECTION_ID, status: "completed" },
      { orgUnitId: SIBLING_SECTION, status: "active" },
    ];
    const rows = rollupCourseCompletion(multi, multiOrgUnits, multiEnrollments);
    // Sorted by title: "Advanced" then "Intro".
    expect(rows.map((r) => r.title)).toEqual(["Advanced", "Intro"]);
    const intro = rows.find((r) => r.title === "Intro")!;
    const advanced = rows.find((r) => r.title === "Advanced")!;
    expect(intro).toMatchObject({ enrolled: 1, completed: 1 });
    expect(advanced).toMatchObject({ enrolled: 1, completed: 0 });
  });
});
