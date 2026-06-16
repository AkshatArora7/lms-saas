"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getSession } from "../../../lib/auth";
import { canTeach } from "../../../lib/teaching";
import {
  completeEnrollment,
  dropEnrollment,
  enrollUser,
  updateEnrollmentRole,
} from "../../../lib/enrollment-api";

/**
 * Roster mutations for the teacher surface, exposed as Next server actions.
 *
 * Every action re-checks the session and teaching role server-side (never trust
 * the client), forwards the authenticated tenant to the enrollment service, then
 * revalidates the affected routes. On success they redirect back to the course's
 * roster; on failure they redirect to the form with an `?error=` message the
 * page surfaces in an Alert.
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

export async function enrollUserAction(form: FormData): Promise<void> {
  const courseId = field(form, "courseId") ?? "";
  const tenantId = await requireTeacherTenant(courseId);

  const base = `/teach/${courseId}/roster`;
  const userId = field(form, "userId")?.trim() ?? "";
  const role = field(form, "role")?.trim() ?? "";
  if (!userId) {
    redirect(`${base}/new?error=A%20user%20id%20is%20required.`);
  }
  if (!role) {
    redirect(`${base}/new?error=A%20role%20is%20required.`);
  }

  const result = await enrollUser(
    { userId, orgUnitId: courseId, role },
    tenantId,
  );

  if (!result.ok) {
    redirect(`${base}/new?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath(base);
  redirect(base);
}

export async function updateRoleAction(form: FormData): Promise<void> {
  const courseId = field(form, "courseId") ?? "";
  const tenantId = await requireTeacherTenant(courseId);
  const id = field(form, "id");
  const base = `/teach/${courseId}/roster`;
  if (!id) redirect(base);

  const role = field(form, "role")?.trim() ?? "";
  if (!role) {
    redirect(`${base}/${id}/edit?error=A%20role%20is%20required.`);
  }

  const result = await updateEnrollmentRole(id, role, tenantId);
  if (!result.ok) {
    redirect(`${base}/${id}/edit?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath(base);
  revalidatePath(`${base}/${id}/edit`);
  redirect(base);
}

export async function completeEnrollmentAction(form: FormData): Promise<void> {
  const courseId = field(form, "courseId") ?? "";
  const tenantId = await requireTeacherTenant(courseId);
  const id = field(form, "id");
  const base = `/teach/${courseId}/roster`;
  if (!id) redirect(base);

  const result = await completeEnrollment(id, tenantId);
  revalidatePath(base);
  if (!result.ok) {
    redirect(`${base}?error=${encodeURIComponent(result.error)}`);
  }
  redirect(base);
}

export async function dropEnrollmentAction(form: FormData): Promise<void> {
  const courseId = field(form, "courseId") ?? "";
  const tenantId = await requireTeacherTenant(courseId);
  const id = field(form, "id");
  const base = `/teach/${courseId}/roster`;
  if (!id) redirect(base);

  const result = await dropEnrollment(id, tenantId);
  revalidatePath(base);
  if (!result.ok) {
    redirect(`${base}?error=${encodeURIComponent(result.error)}`);
  }
  redirect(base);
}
