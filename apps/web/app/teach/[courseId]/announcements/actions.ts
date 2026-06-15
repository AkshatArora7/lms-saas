"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getSession } from "../../../lib/auth";
import { canTeach } from "../../../lib/teaching";
import {
  createAnnouncement,
  deleteAnnouncement,
  publishAnnouncement,
  updateAnnouncement,
} from "../../../lib/announcements-api";

/**
 * Announcement mutations for the teacher surface, exposed as Next server
 * actions.
 *
 * Every action re-checks the session and teaching role server-side (never trust
 * the client), forwards the authenticated tenant to the announcement service,
 * then revalidates the affected routes. On success they redirect back to the
 * course's announcement list; on failure they redirect to the form with an
 * `?error=` message the page surfaces in an Alert.
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

/** Convert an HTML `datetime-local` value to an ISO-8601 string, or null. */
function toIsoOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function createAnnouncementAction(form: FormData): Promise<void> {
  const courseId = field(form, "courseId") ?? "";
  const tenantId = await requireTeacherTenant(courseId);

  const base = `/teach/${courseId}/announcements`;
  const title = field(form, "title")?.trim() ?? "";
  const body = field(form, "body")?.trim() ?? "";
  if (!title) {
    redirect(`${base}/new?error=Title%20is%20required.`);
  }
  if (!body) {
    redirect(`${base}/new?error=Body%20is%20required.`);
  }

  const result = await createAnnouncement(
    {
      orgUnitId: courseId,
      title,
      body,
      publishAt: toIsoOrNull(field(form, "publishAt")),
      expiresAt: toIsoOrNull(field(form, "expiresAt")),
    },
    tenantId,
  );

  if (!result.ok) {
    redirect(`${base}/new?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath(base);
  redirect(base);
}

export async function updateAnnouncementAction(form: FormData): Promise<void> {
  const courseId = field(form, "courseId") ?? "";
  const tenantId = await requireTeacherTenant(courseId);
  const id = field(form, "id");
  const base = `/teach/${courseId}/announcements`;
  if (!id) redirect(base);

  const title = field(form, "title")?.trim() ?? "";
  const body = field(form, "body")?.trim() ?? "";
  if (!title) {
    redirect(`${base}/${id}/edit?error=Title%20is%20required.`);
  }
  if (!body) {
    redirect(`${base}/${id}/edit?error=Body%20is%20required.`);
  }

  const result = await updateAnnouncement(
    id,
    {
      title,
      body,
      publishAt: toIsoOrNull(field(form, "publishAt")) ?? undefined,
      expiresAt: trimmedOrNull(field(form, "expiresAt"))
        ? toIsoOrNull(field(form, "expiresAt"))
        : null,
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

export async function publishAnnouncementAction(form: FormData): Promise<void> {
  const courseId = field(form, "courseId") ?? "";
  const tenantId = await requireTeacherTenant(courseId);
  const id = field(form, "id");
  const base = `/teach/${courseId}/announcements`;
  if (!id) redirect(base);

  const result = await publishAnnouncement(id, tenantId);
  revalidatePath(base);
  if (!result.ok) {
    redirect(`${base}?error=${encodeURIComponent(result.error)}`);
  }
  redirect(base);
}

export async function deleteAnnouncementAction(form: FormData): Promise<void> {
  const courseId = field(form, "courseId") ?? "";
  const tenantId = await requireTeacherTenant(courseId);
  const id = field(form, "id");
  const base = `/teach/${courseId}/announcements`;
  if (!id) redirect(base);

  const result = await deleteAnnouncement(id, tenantId);
  revalidatePath(base);
  if (!result.ok) {
    redirect(`${base}?error=${encodeURIComponent(result.error)}`);
  }
  redirect(base);
}
