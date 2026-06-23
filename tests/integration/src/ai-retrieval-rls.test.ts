import { randomUUID } from "node:crypto";

import { HashingEmbedder } from "@lms/service-ai/dist/embedder.js";
import { createPrismaStore } from "@lms/service-ai/dist/store.prisma.js";
import type { TenantContext } from "@lms/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adminPool,
  appPoolUrl,
  createTenant,
  dbAvailable,
  ensureSchemaAndRole,
  type PgPool,
} from "./helpers/db.js";

/**
 * What one tenant gets seeded: a real `course` (its `ai_embedding.course_id` FK)
 * plus the chunk texts to embed. Distinct chunk SETS per tenant make a
 * cross-tenant leak show up as a WRONG chunk/sourceId, not just a wrong id.
 */
interface SeededCourse {
  courseId: string;
  sourceIds: string[];
  chunks: string[];
}

/**
 * Seed one tenant's retrieval fixture as the admin (superuser, so the org_unit +
 * course rows bypass RLS and set `tenant_id` directly), then write the
 * `ai_embedding` rows through the REAL ai Prisma store under that tenant's
 * non-superuser context so the INSERT is itself RLS-checked.
 *
 * `ai_embedding.course_id` is a FK to `course`, so a real `course` (under an
 * `org_unit`) must exist first — mirrors `reports-rollup`'s org_unit+course
 * inserts. #267 uuid=text discipline: cast ONLY uuid columns, never blanket-cast.
 */
async function seedTenantCourseEmbeddings(
  admin: PgPool,
  tenantId: string,
  opts: { schoolName: string; schoolCode: string; courseTitle: string; chunks: string[] },
): Promise<SeededCourse> {
  // Real org_unit (organization) + course so the ai_embedding FK is satisfiable.
  const school = await admin.query<{ id: string }>(
    `INSERT INTO org_unit (tenant_id, type, name, code, path)
     VALUES ($1, 'organization', $2, $3, '{}'::uuid[])
     RETURNING id`,
    [tenantId, opts.schoolName, opts.schoolCode],
  );
  const schoolId = school.rows[0]!.id;
  const course = await admin.query<{ id: string }>(
    `INSERT INTO course (tenant_id, org_unit_id, title, is_published)
     VALUES ($1, $2, $3, true) RETURNING id`,
    [tenantId, schoolId, opts.courseTitle],
  );
  const courseId = course.rows[0]!.id;

  // Deterministic, offline 1024-dim L2-normalized embeddings for each chunk.
  const vectors = await new HashingEmbedder().embed(opts.chunks);
  const sourceIds = opts.chunks.map(() => randomUUID());
  const rows = opts.chunks.map((chunk, i) => ({
    sourceType: "content_topic",
    sourceId: sourceIds[i]!,
    chunk,
    embedding: vectors[i]!,
  }));

  // Write via the REAL store under the tenant's context so withTenant sets the
  // `app.tenant_id` GUC and the INSERT runs RLS-scoped (process.env.DATABASE_URL
  // already points @lms/db's pool at the non-superuser app role).
  const store = createPrismaStore();
  const ctx: TenantContext = { tenantId, tier: "pool", databaseUrl: appPoolUrl() };
  await store.replaceEmbeddings(ctx, courseId, "content_topic", rows);

  return { courseId, sourceIds, chunks: opts.chunks };
}

/**
 * Issue #310 — prove the ai `/chat` retrieval is isolated by live Postgres RLS,
 * not by the course_id filter. The store's retrieval SQL has NO tenant_id
 * predicate (services/ai/src/store.prisma.ts:137-158) — scoping is purely FORCE
 * RLS + the `app.tenant_id` GUC set by withTenant.
 *
 * Two tenants A and B are seeded with REAL, DISTINCT course chunks via the real
 * ai store under the non-superuser `lms_rls_app` role (appPoolUrl). The key proof:
 * tenant B querying tenant A's OWN courseId must still get nothing back — the only
 * thing hiding A's matching rows is RLS. A superuser cross-check (BYPASS RLS)
 * confirms both tenants' rows physically coexist, so the isolation is RLS, not a
 * seed failure. Skipped when DATABASE_URL is unset.
 */
describe.skipIf(!dbAvailable)(
  "ai retrieval: two-tenant pgvector RLS isolation",
  () => {
    let admin: PgPool;
    let tenantA: string;
    let tenantB: string;
    let seedA: SeededCourse;
    let seedB: SeededCourse;
    let ctxA: TenantContext;
    let ctxB: TenantContext;
    let queryEmb: number[];

    const savedDatabaseUrl = process.env.DATABASE_URL;

    beforeAll(async () => {
      await ensureSchemaAndRole();
      admin = adminPool();

      tenantA = await createTenant(admin, `ai-a-${randomUUID()}`, "AI Tenant A");
      tenantB = await createTenant(admin, `ai-b-${randomUUID()}`, "AI Tenant B");

      // Point @lms/db's pool at the non-superuser app role BEFORE seeding through
      // the store, so the seed INSERTs are themselves RLS-subject. Running as
      // superuser would BYPASS RLS and make the isolation assertions vacuous.
      process.env.DATABASE_URL = appPoolUrl();

      seedA = await seedTenantCourseEmbeddings(admin, tenantA, {
        schoolName: "AI Tenant A High",
        schoolCode: "AI-TA",
        courseTitle: "Biology I",
        chunks: [
          "Photosynthesis converts light to chemical energy.",
          "Mitochondria are the powerhouse of the cell.",
        ],
      });
      seedB = await seedTenantCourseEmbeddings(admin, tenantB, {
        schoolName: "AI Tenant B High",
        schoolCode: "AI-TB",
        courseTitle: "Physics I",
        chunks: ["Newton's law of universal gravitation."],
      });

      ctxA = { tenantId: tenantA, tier: "pool", databaseUrl: appPoolUrl() };
      ctxB = { tenantId: tenantB, tier: "pool", databaseUrl: appPoolUrl() };

      // One shared query embedding for all retrieval calls (1024-dim normalized).
      queryEmb = (await new HashingEmbedder().embed(["cell energy"]))[0]!;
    });

    afterAll(async () => {
      if (admin) {
        // Cascades ai_embedding (and org_unit/course) for both tenants.
        await admin.query("DELETE FROM tenant WHERE id = ANY($1::uuid[])", [
          [tenantA, tenantB],
        ]);
        await admin.end();
      }
      if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = savedDatabaseUrl;
    });

    it("tenant A retrieves its own course chunks", async () => {
      const store = createPrismaStore();
      const cites = await store.retrieve(ctxA, seedA.courseId, queryEmb, 5);

      expect(cites).toHaveLength(2);
      for (const cite of cites) {
        expect(seedA.sourceIds).toContain(cite.sourceId);
        expect(seedA.chunks).toContain(cite.chunk);
      }
    });

    it("RLS hides tenant A's chunks from tenant B even when B queries A's courseId", async () => {
      const store = createPrismaStore();
      // THE KEY PROOF: the retrieval SQL has NO tenant_id predicate, and courseA
      // matches A's rows exactly. If RLS were not enforcing isolation, B would see
      // A's rows here. The only thing hiding them is FORCE RLS + the app.tenant_id
      // GUC (= tenant B) set by withTenant. A non-empty result would mean RLS failed.
      const cites = await store.retrieve(ctxB, seedA.courseId, queryEmb, 5);
      expect(cites).toEqual([]);
    });

    it("tenant B retrieves only its own chunk, none of A's", async () => {
      const store = createPrismaStore();
      const cites = await store.retrieve(ctxB, seedB.courseId, queryEmb, 5);

      expect(cites).toHaveLength(1);
      expect(seedB.sourceIds).toContain(cites[0]!.sourceId);
      expect(cites[0]!.chunk).toBe(seedB.chunks[0]);
      // No A sourceId may appear in B's result.
      const ids = cites.map((c) => c.sourceId);
      for (const aId of seedA.sourceIds) expect(ids).not.toContain(aId);
    });

    it("superuser (BYPASS RLS) sees both tenants' ai_embedding rows coexisting", async () => {
      // The admin pool is a superuser, so RLS does not apply. This proves both
      // tenants' rows physically coexist in one table — i.e. the isolation above
      // is RLS, not a silent seed failure or an empty tenant.
      const res = await admin.query<{ tenant_id: string }>(
        "SELECT tenant_id FROM ai_embedding WHERE tenant_id = ANY($1::uuid[])",
        [[tenantA, tenantB]],
      );
      const tids = new Set(res.rows.map((r) => r.tenant_id));
      expect(tids.has(tenantA)).toBe(true);
      expect(tids.has(tenantB)).toBe(true);
      expect(res.rowCount).toBe(3); // 2 (A) + 1 (B)
    });
  },
);
