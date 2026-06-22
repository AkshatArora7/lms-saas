import { randomUUID } from "node:crypto";

import type { TenantContext } from "@lms/types";

import {
  slugify,
  type ContentStore,
  type CreateTopicResult,
  type ModuleDetail,
  type ModuleRecord,
  type NewModuleInput,
  type NewPageInput,
  type NewReleaseConditionInput,
  type NewTopicInput,
  type PageDetail,
  type PageRecord,
  type PageVersionRecord,
  type ReleaseConditionRecord,
  type TopicRecord,
  type UpdateModuleInput,
  type UpdatePageInput,
  type UpdateTopicInput,
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
  private pages: PageRecord[] = [];
  private pageVersions: PageVersionRecord[] = [];

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

  // --- Rich pages (#32) ----------------------------------------------------

  /** Versions for a page, newest version_number first. */
  private versionsOf(tenantId: string, pageId: string): PageVersionRecord[] {
    return this.pageVersions
      .filter((v) => v.tenantId === tenantId && v.pageId === pageId)
      .sort((a, b) => b.versionNumber - a.versionNumber);
  }

  /** Current version = latest draft if any, else the published version. */
  private currentVersionOf(page: PageRecord): PageVersionRecord | null {
    const versions = this.versionsOf(page.tenantId, page.id);
    const latestDraft = versions.find((v) => v.state === "draft");
    if (latestDraft) return latestDraft;
    if (page.publishedVersionId) {
      return versions.find((v) => v.id === page.publishedVersionId) ?? null;
    }
    return null;
  }

  async createPage(
    ctx: TenantContext,
    courseId: string,
    input: NewPageInput,
  ): Promise<PageRecord> {
    const ts = this.now().toISOString();
    const page: PageRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      courseId,
      title: input.title,
      slug: input.slug ? slugify(input.slug) : slugify(input.title),
      status: "draft",
      publishedVersionId: null,
      createdBy: null,
      createdAt: ts,
      updatedAt: ts,
    };
    this.pages.push(page);
    const version: PageVersionRecord = {
      id: this.generateId(),
      tenantId: ctx.tenantId,
      pageId: page.id,
      versionNumber: 1,
      body: input.body ?? "",
      state: "draft",
      createdBy: null,
      createdAt: ts,
    };
    this.pageVersions.push(version);
    return page;
  }

  async listPages(
    ctx: TenantContext,
    courseId: string,
  ): Promise<PageRecord[]> {
    return this.pages
      .filter((p) => p.tenantId === ctx.tenantId && p.courseId === courseId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getPage(ctx: TenantContext, id: string): Promise<PageDetail | null> {
    const page = this.pages.find(
      (p) => p.id === id && p.tenantId === ctx.tenantId,
    );
    if (!page) return null;
    return { ...page, currentVersion: this.currentVersionOf(page) };
  }

  async updatePage(
    ctx: TenantContext,
    id: string,
    input: UpdatePageInput,
  ): Promise<PageRecord | null> {
    const page = this.pages.find(
      (p) => p.id === id && p.tenantId === ctx.tenantId,
    );
    if (!page) return null;
    if (input.title !== undefined) page.title = input.title;
    if (input.slug !== undefined) page.slug = slugify(input.slug);
    if (input.body !== undefined) {
      // Never mutate an existing version — append a new draft version.
      const maxNumber = this.versionsOf(page.tenantId, page.id).reduce(
        (max, v) => Math.max(max, v.versionNumber),
        0,
      );
      this.pageVersions.push({
        id: this.generateId(),
        tenantId: ctx.tenantId,
        pageId: page.id,
        versionNumber: maxNumber + 1,
        body: input.body,
        state: "draft",
        createdBy: null,
        createdAt: this.now().toISOString(),
      });
    }
    page.updatedAt = this.now().toISOString();
    return page;
  }

  async publishPage(
    ctx: TenantContext,
    id: string,
    versionId?: string,
  ): Promise<PageRecord | null> {
    const page = this.pages.find(
      (p) => p.id === id && p.tenantId === ctx.tenantId,
    );
    if (!page) return null;
    const versions = this.versionsOf(page.tenantId, page.id);
    const target = versionId
      ? versions.find((v) => v.id === versionId)
      : versions.find((v) => v.state === "draft");
    if (!target) return null;
    target.state = "published";
    page.status = "published";
    page.publishedVersionId = target.id;
    page.updatedAt = this.now().toISOString();
    return page;
  }

  async listPageVersions(
    ctx: TenantContext,
    pageId: string,
  ): Promise<PageVersionRecord[]> {
    return this.versionsOf(ctx.tenantId, pageId);
  }

  async getPageVersion(
    ctx: TenantContext,
    pageId: string,
    versionId: string,
  ): Promise<PageVersionRecord | null> {
    return (
      this.pageVersions.find(
        (v) =>
          v.id === versionId &&
          v.pageId === pageId &&
          v.tenantId === ctx.tenantId,
      ) ?? null
    );
  }
}
