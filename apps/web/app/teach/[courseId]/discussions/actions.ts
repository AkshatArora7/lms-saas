"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getSession } from "../../../lib/auth";
import { canTeach } from "../../../lib/teaching";
import {
  createForum,
  createPost,
  createTopic,
  deletePost,
  setPostPinned,
  updatePost,
} from "../../../lib/discussions-api";

/**
 * Discussion mutations for the teacher surface, exposed as Next server actions.
 *
 * Every action re-checks the session and teaching role server-side (never trust
 * the client), forwards the authenticated tenant to the discussion service, then
 * revalidates the affected routes. On success they redirect back to the relevant
 * discussion screen; on failure they redirect with an `?error=` message the page
 * surfaces in an Alert.
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

async function teacherUserId(): Promise<string> {
  const session = await getSession();
  if (!session || !canTeach(session.roles)) {
    redirect("/teach");
  }
  return session.userId;
}

function field(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  return typeof value === "string" ? value : undefined;
}

export async function createForumAction(form: FormData): Promise<void> {
  const courseId = field(form, "courseId") ?? "";
  const tenantId = await requireTeacherTenant(courseId);
  const base = `/teach/${courseId}/discussions`;

  const title = field(form, "title")?.trim() ?? "";
  if (!title) {
    redirect(`${base}/new?error=Title%20is%20required.`);
  }

  const result = await createForum(courseId, title, tenantId);
  if (!result.ok) {
    redirect(`${base}/new?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath(base);
  redirect(base);
}

export async function createTopicAction(form: FormData): Promise<void> {
  const courseId = field(form, "courseId") ?? "";
  const tenantId = await requireTeacherTenant(courseId);
  const forumId = field(form, "forumId") ?? "";
  const base = `/teach/${courseId}/discussions/${forumId}`;
  if (!forumId) redirect(`/teach/${courseId}/discussions`);

  const title = field(form, "title")?.trim() ?? "";
  const description = field(form, "description")?.trim() ?? "";
  if (!title) {
    redirect(`${base}/new?error=Title%20is%20required.`);
  }

  const result = await createTopic(
    forumId,
    title,
    description ? description : null,
    tenantId,
  );
  if (!result.ok) {
    redirect(`${base}/new?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath(base);
  redirect(base);
}

export async function createPostAction(form: FormData): Promise<void> {
  const courseId = field(form, "courseId") ?? "";
  const tenantId = await requireTeacherTenant(courseId);
  const authorId = await teacherUserId();
  const forumId = field(form, "forumId") ?? "";
  const topicId = field(form, "topicId") ?? "";
  const base = `/teach/${courseId}/discussions/${forumId}/${topicId}`;
  if (!forumId || !topicId) redirect(`/teach/${courseId}/discussions`);

  const body = field(form, "body")?.trim() ?? "";
  const parentId = field(form, "parentId")?.trim() ?? "";
  if (!body) {
    redirect(`${base}?error=Reply%20cannot%20be%20empty.`);
  }

  const result = await createPost(
    topicId,
    authorId,
    body,
    parentId ? parentId : null,
    tenantId,
  );
  revalidatePath(base);
  if (!result.ok) {
    redirect(`${base}?error=${encodeURIComponent(result.error)}`);
  }
  redirect(base);
}

export async function updatePostAction(form: FormData): Promise<void> {
  const courseId = field(form, "courseId") ?? "";
  const tenantId = await requireTeacherTenant(courseId);
  const forumId = field(form, "forumId") ?? "";
  const topicId = field(form, "topicId") ?? "";
  const id = field(form, "id") ?? "";
  const base = `/teach/${courseId}/discussions/${forumId}/${topicId}`;
  if (!forumId || !topicId || !id) redirect(`/teach/${courseId}/discussions`);

  const body = field(form, "body")?.trim() ?? "";
  if (!body) {
    redirect(`${base}/${id}/edit?error=Body%20is%20required.`);
  }

  const result = await updatePost(id, body, tenantId);
  if (!result.ok) {
    redirect(`${base}/${id}/edit?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath(base);
  redirect(base);
}

export async function pinPostAction(form: FormData): Promise<void> {
  const courseId = field(form, "courseId") ?? "";
  const tenantId = await requireTeacherTenant(courseId);
  const forumId = field(form, "forumId") ?? "";
  const topicId = field(form, "topicId") ?? "";
  const id = field(form, "id") ?? "";
  const base = `/teach/${courseId}/discussions/${forumId}/${topicId}`;
  if (!forumId || !topicId || !id) redirect(`/teach/${courseId}/discussions`);

  const pinned = field(form, "pinned") === "true";
  const result = await setPostPinned(id, pinned, tenantId);
  revalidatePath(base);
  if (!result.ok) {
    redirect(`${base}?error=${encodeURIComponent(result.error)}`);
  }
  redirect(base);
}

export async function deletePostAction(form: FormData): Promise<void> {
  const courseId = field(form, "courseId") ?? "";
  const tenantId = await requireTeacherTenant(courseId);
  const forumId = field(form, "forumId") ?? "";
  const topicId = field(form, "topicId") ?? "";
  const id = field(form, "id") ?? "";
  const base = `/teach/${courseId}/discussions/${forumId}/${topicId}`;
  if (!forumId || !topicId || !id) redirect(`/teach/${courseId}/discussions`);

  const result = await deletePost(id, tenantId);
  revalidatePath(base);
  if (!result.ok) {
    redirect(`${base}?error=${encodeURIComponent(result.error)}`);
  }
  redirect(base);
}
