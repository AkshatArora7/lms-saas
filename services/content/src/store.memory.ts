import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

import type {
  ContentStore,
  CreateTopicResult,
  ModuleDetail,
  ModuleRecord,
  NewModuleInput,
  NewReleaseConditionInput,
  NewTopicInput,
  ReleaseConditionRecord,
  TopicRecord,
  UpdateModuleInput,
  UpdateTopicInput,
} from "./store.js";

export const DEMO_TENANT_ID = "11111111-1111-1111-1111-111111111111";

/**
 * In-memory ContentStore. Rows are filtered by tenant id to emulate the RLS
 * isolation Postgres enforces. Used by the test suite and `CONTENT_STORE=memory`.
 */
export class MemoryContentStore implements ContentStore {
  private modules: ModuleRecord[] = [];
  private topics: TopicRecord[] = [];
  private releases: ReleaseConditionRecord[] = [];

  constructor(
    private readonly generateId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createModule(
    ctx: TenantContext,
    courseId: string,
    input: NewModuleInput,
  ): Promise<ModuleRecord> {
    const module: ModuleRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      courseId,
      parentId: input.parentId ?? null,
      title: input.title,
      position: input.position ?? 0,
      createdAt: this.now().toISOString(),
    };
    this.modules.push(module);
    return module;
  }

  async listModules(
    ctx: TenantContext,
    courseId: string,
  ): Promise<ModuleRecord[]> {
    return this.modules
      .filter((m) => m.tenantId === ctx.tenantId && m.courseId === courseId)
      .sort((a, b) => a.position - b.position);
  }

  async getModule(
    ctx: TenantContext,
    id: string,
  ): Promise<ModuleDetail | null> {
    const module = this.modules.find(
      (m) => m.id === id && m.tenantId === ctx.tenantId,
    );
    if (!module) return null;
    const topics = this.topics
      .filter((t) => t.tenantId === ctx.tenantId && t.moduleId === id)
      .sort((a, b) => a.position - b.position);
    return { ...module, topics };
  }

  async updateModule(
    ctx: TenantContext,
    id: string,
    input: UpdateModuleInput,
  ): Promise<ModuleRecord | null> {
    const module = this.modules.find(
      (m) => m.id === id && m.tenantId === ctx.tenantId,
    );
    if (!module) return null;
    if (input.title !== undefined) module.title = input.title;
    if (input.position !== undefined) module.position = input.position;
    return module;
  }

  async deleteModule(ctx: TenantContext, id: string): Promise<boolean> {
    const before = this.modules.length;
    this.modules = this.modules.filter(
      (m) => !(m.id === id && m.tenantId === ctx.tenantId),
    );
    return this.modules.length < before;
  }

  async createTopic(
    ctx: TenantContext,
    moduleId: string,
    input: NewTopicInput,
  ): Promise<CreateTopicResult> {
    const module = this.modules.find(
      (m) => m.id === moduleId && m.tenantId === ctx.tenantId,
    );
    if (!module) return { ok: false, reason: "module_not_found" };
    const topic: TopicRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      moduleId,
      title: input.title,
      kind: input.kind ?? "html",
      body: input.body ?? null,
      blobUrl: input.blobUrl ?? null,
      position: input.position ?? 0,
      isRequired: input.isRequired ?? false,
      createdAt: this.now().toISOString(),
    };
    this.topics.push(topic);
    return { ok: true, topic };
  }

  async listTopics(
    ctx: TenantContext,
    moduleId: string,
  ): Promise<TopicRecord[]> {
    return this.topics
      .filter((t) => t.tenantId === ctx.tenantId && t.moduleId === moduleId)
      .sort((a, b) => a.position - b.position);
  }

  async updateTopic(
    ctx: TenantContext,
    id: string,
    input: UpdateTopicInput,
  ): Promise<TopicRecord | null> {
    const topic = this.topics.find(
      (t) => t.id === id && t.tenantId === ctx.tenantId,
    );
    if (!topic) return null;
    if (input.title !== undefined) topic.title = input.title;
    if (input.body !== undefined) topic.body = input.body;
    if (input.blobUrl !== undefined) topic.blobUrl = input.blobUrl;
    if (input.position !== undefined) topic.position = input.position;
    if (input.isRequired !== undefined) topic.isRequired = input.isRequired;
    return topic;
  }

  async deleteTopic(ctx: TenantContext, id: string): Promise<boolean> {
    const before = this.topics.length;
    this.topics = this.topics.filter(
      (t) => !(t.id === id && t.tenantId === ctx.tenantId),
    );
    return this.topics.length < before;
  }

  async createReleaseCondition(
    ctx: TenantContext,
    courseId: string,
    input: NewReleaseConditionInput,
  ): Promise<ReleaseConditionRecord> {
    const rc: ReleaseConditionRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      courseId,
      targetType: input.targetType,
      targetId: input.targetId,
      expression: input.expression,
      createdAt: this.now().toISOString(),
    };
    this.releases.push(rc);
    return rc;
  }

  async listReleaseConditions(
    ctx: TenantContext,
    courseId: string,
  ): Promise<ReleaseConditionRecord[]> {
    return this.releases.filter(
      (r) => r.tenantId === ctx.tenantId && r.courseId === courseId,
    );
  }

  async deleteReleaseCondition(
    ctx: TenantContext,
    id: string,
  ): Promise<boolean> {
    const before = this.releases.length;
    this.releases = this.releases.filter(
      (r) => !(r.id === id && r.tenantId === ctx.tenantId),
    );
    return this.releases.length < before;
  }
}
