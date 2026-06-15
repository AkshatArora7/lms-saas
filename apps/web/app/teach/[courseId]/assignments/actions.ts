"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getSession } from "../../../lib/auth";
import { canTeach } from "../../../lib/teaching";
import {
  createAssignment,
  deleteAssignment,
  updateAssignment,
  type SubmissionType,
} from "../../../lib/assignments-api";

/**
 * Assignment mutations for the teacher surface, exposed as Next server actions.
 *
 * Every action re-checks the session and teaching role server-side (never trust
 * the client), forwards the authenticated tenant to the assignment service, then
 * revalidates the affected routes. On success they redirect back to the course's
 * assignment list; on failure they redirect to the form with an `?error=`
 * message the page surfaces in an Alert.
 */

async function requireTeacherTenant(courseId: string): Promise<string> {
  const session = await getSession();
  if (!session || !canTeach(session.roles)) {
    redirect("/teach");
  }
  if (!courseId) {
    redirect("/teach");
  }
  return session.tenantId;
}

function field(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  return typeof value === "string" ? value : undefined;
}

function trimmedOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

const SUBMISSION_TYPES: SubmissionType[] = ["file", "text", "url", "none"];

function submissionType(value: string | undefined): SubmissionType | undefined {
  return value && SUBMISSION_TYPES.includes(value as SubmissionType)
    ? (value as SubmissionType)
    : undefined;
}

function points(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export async function createAssignmentAction(form: FormData): Promise<void> {
  const courseId = field(form, "courseId") ?? "";
  const tenantId = await requireTeacherTenant(courseId);

  const base = `/teach/${courseId}/assignments`;
  const title = field(form, "title")?.trim() ?? "";
  if (!title) {
    redirect(`${base}/new?error=Title%20is%20required.`);
  }

  const result = await createAssignment(
    {
      courseId,
      title,
      instructions: trimmedOrNull(field(form, "instructions")),
      dueAt: trimmedOrNull(field(form, "dueAt")),
      points: points(field(form, "points")),
      submissionType: submissionType(field(form, "submissionType")),
      allowLate: form.get("allowLate") === "on",
    },
    tenantId,
  );

  if (!result.ok) {
    redirect(`${base}/new?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath(base);
  redirect(base);
}

export async function updateAssignmentAction(form: FormData): Promise<void> {
  const courseId = field(form, "courseId") ?? "";
  const tenantId = await requireTeacherTenant(courseId);
  const id = field(form, "id");
  const base = `/teach/${courseId}/assignments`;
  if (!id) redirect(base);

  const title = field(form, "title")?.trim() ?? "";
  if (!title) {
    redirect(`${base}/${id}/edit?error=Title%20is%20required.`);
  }

  const result = await updateAssignment(
    id,
    {
      title,
      instructions: trimmedOrNull(field(form, "instructions")),
      dueAt: trimmedOrNull(field(form, "dueAt")),
      points: points(field(form, "points")),
      submissionType: submissionType(field(form, "submissionType")),
      allowLate: form.get("allowLate") === "on",
    },
    tenantId,
  );

  if (!result.ok) {
    redirect(`${base}/${id}/edit?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath(base);
  revalidatePath(`${base}/${id}/edit`);
  redirect(base);
}

export async function deleteAssignmentAction(form: FormData): Promise<void> {
  const courseId = field(form, "courseId") ?? "";
  const tenantId = await requireTeacherTenant(courseId);
  const id = field(form, "id");
  const base = `/teach/${courseId}/assignments`;
  if (!id) redirect(base);

  const result = await deleteAssignment(id, tenantId);
  revalidatePath(base);
  if (!result.ok) {
    redirect(`${base}?error=${encodeURIComponent(result.error)}`);
  }
  redirect(base);
}
