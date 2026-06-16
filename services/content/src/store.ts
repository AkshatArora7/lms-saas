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
}
