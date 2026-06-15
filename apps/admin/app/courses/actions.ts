"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getSession, isAdmin } from "../lib/auth";
import {
  createCourse,
  deleteCourse,
  publishCourse,
  updateCourse,
} from "../lib/courses-api";

/**
 * Course mutations for the admin console, exposed as Next server actions.
 *
 * Every action re-checks the session and admin role server-side (never trust
 * the client), forwards the authenticated tenant to the course service, then
 * revalidates the affected routes so the catalogue reflects the change. On
 * success they redirect; on failure they redirect back with an `?error=`
 * message the form surfaces in an Alert.
 */

async function requireAdminTenant(): Promise<string> {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    redirect("/courses");
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

export async function createCourseAction(form: FormData): Promise<void> {
  const tenantId = await requireAdminTenant();
  const title = field(form, "title")?.trim() ?? "";
  if (!title) {
    redirect("/courses/new?error=Title%20is%20required.");
  }

  const result = await createCourse(
    {
      title,
      description: trimmedOrNull(field(form, "description")),
      startDate: trimmedOrNull(field(form, "startDate")),
      endDate: trimmedOrNull(field(form, "endDate")),
    },
    tenantId,
  );

  if (!result.ok) {
    redirect(`/courses/new?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath("/courses");
  redirect("/courses");
}

export async function updateCourseAction(form: FormData): Promise<void> {
  const tenantId = await requireAdminTenant();
  const id = field(form, "id");
  if (!id) redirect("/courses");

  const title = field(form, "title")?.trim() ?? "";
  if (!title) {
    redirect(`/courses/${id}/edit?error=Title%20is%20required.`);
  }

  const result = await updateCourse(
    id,
    {
      title,
      description: trimmedOrNull(field(form, "description")),
      startDate: trimmedOrNull(field(form, "startDate")),
      endDate: trimmedOrNull(field(form, "endDate")),
    },
    tenantId,
  );

  if (!result.ok) {
    redirect(`/courses/${id}/edit?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath("/courses");
  revalidatePath(`/courses/${id}/edit`);
  redirect("/courses");
}

export async function publishCourseAction(form: FormData): Promise<void> {
  const tenantId = await requireAdminTenant();
  const id = field(form, "id");
  if (!id) redirect("/courses");

  const result = await publishCourse(id, tenantId);
  revalidatePath("/courses");
  if (!result.ok) {
    redirect(`/courses?error=${encodeURIComponent(result.error)}`);
  }
  redirect("/courses");
}

export async function deleteCourseAction(form: FormData): Promise<void> {
  const tenantId = await requireAdminTenant();
  const id = field(form, "id");
  if (!id) redirect("/courses");

  const result = await deleteCourse(id, tenantId);
  revalidatePath("/courses");
  if (!result.ok) {
    redirect(`/courses?error=${encodeURIComponent(result.error)}`);
  }
  redirect("/courses");
}
