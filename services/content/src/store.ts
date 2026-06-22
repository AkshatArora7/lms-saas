import type { TenantContext } from "@lms/types";

export type TopicKind = "html" | "file" | "link" | "scorm" | "lti" | "video";

export const TOPIC_KINDS: readonly TopicKind[] = [
  "html",
  "file",
  "link",
  "scorm",
  "lti",
  "video",
];

export interface ModuleRecord {
  id: string;
  tenantId: string;
  courseId: string;
  parentId: string | null;
  title: string;
  position: number;
  createdAt: string;
}

export interface TopicRecord {
  id: string;
  tenantId: string;
  moduleId: string;
  title: string;
  kind: TopicKind;
  body: string | null;
  blobUrl: string | null;
  position: number;
  isRequired: boolean;
  createdAt: string;
}

export interface ModuleDetail extends ModuleRecord {
  topics: TopicRecord[];
}

export interface NewModuleInput {
  title: string;
  parentId?: string | null;
  position?: number;
}

export interface UpdateModuleInput {
  title?: string;
  position?: number;
}

export interface NewTopicInput {
  title: string;
  kind?: TopicKind;
  body?: string | null;
  blobUrl?: string | null;
  position?: number;
  isRequired?: boolean;
}

export interface UpdateTopicInput {
  title?: string;
  body?: string | null;
  blobUrl?: string | null;
  position?: number;
  isRequired?: boolean;
}

export type CreateTopicResult =
  | { ok: true; topic: TopicRecord }
  | { ok: false; reason: "module_not_found" };

// --- Rich pages (#32) ------------------------------------------------------

export type PageStatus = "draft" | "published";
export type PageVersionState = "draft" | "published";

export interface PageRecord {
  id: string;
  tenantId: string;
  courseId: string;
  title: string;
  slug: string;
  status: PageStatus;
  publishedVersionId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PageVersionRecord {
  id: string;
  tenantId: string;
  pageId: string;
  versionNumber: number;
  body: string;
  state: PageVersionState;
  createdBy: string | null;
  createdAt: string;
}

/** A page plus its currently-relevant version (latest draft, else published). */
export interface PageDetail extends PageRecord {
  currentVersion: PageVersionRecord | null;
}

export interface NewPageInput {
  title: string;
  slug?: string;
  body?: string;
}

export interface UpdatePageInput {
  title?: string;
  slug?: string;
  body?: string;
}

/**
 * Derive a url-safe slug from arbitrary text: lowercase, non-alphanumerics →
 * hyphens, collapsed and trimmed. Pure helper (unit-testable without a store).
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A release/availability rule targeting a topic/module/quiz (boolean tree). */
export interface ReleaseConditionRecord {
  id: string;
  tenantId: string;
  courseId: string;
  targetType: string;
  targetId: string;
  expression: Record<string, unknown>;
  createdAt: string;
}

export interface NewReleaseConditionInput {
  targetType: string;
  targetId: string;
  expression: Record<string, unknown>;
}

/**
 * Persistence boundary for the content service (modules, topics, release
 * conditions). Routes depend only on this interface; production uses an
 * RLS-scoped Postgres implementation, tests an in-memory one.
 */
export interface ContentStore {
  createModule(
    ctx: TenantContext,
    courseId: string,
    input: NewModuleInput,
  ): Promise<ModuleRecord>;

  listModules(ctx: TenantContext, courseId: string): Promise<ModuleRecord[]>;

  getModule(ctx: TenantContext, id: string): Promise<ModuleDetail | null>;

  updateModule(
    ctx: TenantContext,
    id: string,
    input: UpdateModuleInput,
  ): Promise<ModuleRecord | null>;

  deleteModule(ctx: TenantContext, id: string): Promise<boolean>;

  createTopic(
    ctx: TenantContext,
    moduleId: string,
    input: NewTopicInput,
  ): Promise<CreateTopicResult>;

  listTopics(ctx: TenantContext, moduleId: string): Promise<TopicRecord[]>;

  updateTopic(
    ctx: TenantContext,
    id: string,
    input: UpdateTopicInput,
  ): Promise<TopicRecord | null>;

  deleteTopic(ctx: TenantContext, id: string): Promise<boolean>;

  createReleaseCondition(
    ctx: TenantContext,
    courseId: string,
    input: NewReleaseConditionInput,
  ): Promise<ReleaseConditionRecord>;

  listReleaseConditions(
    ctx: TenantContext,
    courseId: string,
  ): Promise<ReleaseConditionRecord[]>;

  deleteReleaseCondition(ctx: TenantContext, id: string): Promise<boolean>;

  createPage(
    ctx: TenantContext,
    courseId: string,
    input: NewPageInput,
  ): Promise<PageRecord>;

  listPages(ctx: TenantContext, courseId: string): Promise<PageRecord[]>;

  getPage(ctx: TenantContext, id: string): Promise<PageDetail | null>;

  updatePage(
    ctx: TenantContext,
    id: string,
    input: UpdatePageInput,
  ): Promise<PageRecord | null>;

  publishPage(
    ctx: TenantContext,
    id: string,
    versionId?: string,
  ): Promise<PageRecord | null>;

  listPageVersions(
    ctx: TenantContext,
    pageId: string,
  ): Promise<PageVersionRecord[]>;

  getPageVersion(
    ctx: TenantContext,
    pageId: string,
    versionId: string,
  ): Promise<PageVersionRecord | null>;
}
