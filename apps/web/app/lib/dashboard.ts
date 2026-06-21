import { TENANT_ID } from "./auth";
import { getEnrolledCourses } from "./enrolled";
import { getCourse } from "./courses-api";
import { listModules, listTopics, type TopicKind } from "./content-api";
import { getRoster } from "./enrollment-api";
import { getUser } from "./user-org-api";

/**
 * Dashboard + course data for the learner home and course screens, sourced live
 * from the enrollment, course, content and user-org microservices via the BFF
 * server-fetch pattern (every call is tenant-scoped with `x-tenant-id`). There
 * is no demo fallback: when a service returns nothing or errors, the caller
 * renders a clean empty/offline state.
 */
export interface DashboardCourse {
  /** The course row id — also the route segment for /courses/[courseId]. */
  id: string;
  /** The backing offering / org unit (for announcement & calendar reads). */
  orgUnitId: string;
  title: string;
  /** Course code — not modelled by the course service yet, hence nullable. */
  code: string | null;
  /** Term label — not modelled on the course row yet, hence nullable. */
  term: string | null;
  /** The learner's role in this course, shown as a chip. */
  role: string;
}

/** The kind of a content item within a module. */
export type ContentItemType = "lesson" | "assignment" | "quiz";

/** The learner's completion state for a content item. */
export type ContentItemStatus = "completed" | "in_progress" | "not_started";

export interface ContentItem {
  id: string;
  title: string;
  type: ContentItemType;
  status: ContentItemStatus;
}

export interface CourseModule {
  id: string;
  title: string;
  items: ContentItem[];
}

export interface CourseDetail extends DashboardCourse {
  description: string | null;
  /** Resolved instructor display name, or null when none is recorded. */
  instructor: string | null;
  modules: CourseModule[];
}

/** Map a content topic kind to the learner-facing item type. */
function topicType(kind: TopicKind): ContentItemType {
  // The content service models delivery kinds (html/file/link/video/scorm/lti);
  // for the learner rail we present them all as lessons until quiz/assignment
  // items are modelled there.
  void kind;
  return "lesson";
}

/**
 * Resolve the courses to show on the learner dashboard, live from enrollment +
 * course. Returns `[]` (driving the empty state) when the learner has no
 * enrollments or a service is unreachable.
 */
export async function getDashboardCourses(
  userId: string,
  tenantId: string = TENANT_ID,
): Promise<DashboardCourse[]> {
  const enrolled = await getEnrolledCourses(userId, tenantId);
  return enrolled.map((course) => ({
    id: course.courseId,
    orgUnitId: course.orgUnitId,
    title: course.title,
    code: null,
    term: null,
    role: course.role,
  }));
}

/** Resolve the instructor display name for a course offering, or null. */
async function resolveInstructor(
  orgUnitId: string,
  tenantId: string,
): Promise<string | null> {
  const roster = await getRoster(orgUnitId, tenantId);
  if (!roster.ok) return null;
  const instructor = roster.roster.find(
    (e) => e.role === "instructor" || e.role === "teacher",
  );
  if (!instructor) return null;
  const user = await getUser(instructor.userId, tenantId);
  return user?.displayName ?? null;
}

/**
 * Resolve a single course's detail live: the course row, its instructor, and
 * its modules + content items. Returns `null` for unknown courses (driving the
 * not-found path). The learner's role is resolved from their enrollment.
 */
export async function getCourseDetail(
  courseId: string,
  userId: string,
  tenantId: string = TENANT_ID,
): Promise<CourseDetail | null> {
  const [course, enrolled] = await Promise.all([
    getCourse(courseId, tenantId),
    getEnrolledCourses(userId, tenantId),
  ]);
  if (!course) return null;

  const enrollment = enrolled.find((e) => e.courseId === courseId);
  const role = enrollment?.role ?? "student";

  const [instructor, modules] = await Promise.all([
    resolveInstructor(course.orgUnitId, tenantId),
    buildModules(courseId, tenantId),
  ]);

  return {
    id: course.id,
    orgUnitId: course.orgUnitId,
    title: course.title,
    code: null,
    term: null,
    role,
    description: course.description,
    instructor,
    modules,
  };
}

/** Build the ordered module → item tree for a course from the content service. */
async function buildModules(
  courseId: string,
  tenantId: string,
): Promise<CourseModule[]> {
  const modules = await listModules(courseId, tenantId);
  if (!modules.length) return [];
  return Promise.all(
    modules
      .sort((a, b) => a.position - b.position)
      .map(async (module) => {
        const topics = await listTopics(module.id, tenantId);
        return {
          id: module.id,
          title: module.title,
          items: topics
            .sort((a, b) => a.position - b.position)
            .map((topic) => ({
              id: topic.id,
              title: topic.title,
              type: topicType(topic.kind),
              status: "not_started" as ContentItemStatus,
            })),
        };
      }),
  );
}

export interface ContentItemView {
  course: Pick<CourseDetail, "id" | "title" | "code">;
  /**
   * The item's module, including its full ordered item list so the content
   * surface can render within-module navigation (position, prev/next siblings,
   * and the "In this module" rail).
   */
  module: Pick<CourseModule, "id" | "title" | "items">;
  item: ContentItem;
}

/**
 * Resolve a single content item along with its course and module context,
 * live from the course + content services. Returns `null` for unknown courses,
 * modules or item ids, driving the not-found path.
 */
export async function getContentItem(
  courseId: string,
  itemId: string,
  userId: string,
  tenantId: string = TENANT_ID,
): Promise<ContentItemView | null> {
  const course = await getCourseDetail(courseId, userId, tenantId);
  if (!course) return null;
  for (const module of course.modules) {
    const item = module.items.find((i) => i.id === itemId);
    if (item) {
      return {
        course: { id: course.id, title: course.title, code: course.code },
        module: { id: module.id, title: module.title, items: module.items },
        item,
      };
    }
  }
  return null;
}
