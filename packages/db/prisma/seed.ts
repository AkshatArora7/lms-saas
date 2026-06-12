import { PrismaClient } from "@prisma/client";

/**
 * Minimal control-plane seed: a demo pool tenant, the standard role set, and
 * a baseline permission catalogue. Domain seed data is added per module.
 */
const prisma = new PrismaClient();

const STANDARD_ROLES = [
  "learner",
  "instructor",
  "teaching_assistant",
  "course_builder",
  "observer",
  "org_admin",
  "super_admin",
];

const PERMISSIONS = [
  "org:manage",
  "users:manage",
  "roles:manage",
  "courses:read",
  "courses:manage",
  "content:read",
  "content:manage",
  "enrollment:orgunit:read",
  "enrollment:orgunit:manage",
  "assessment:manage",
  "grades:read",
  "grades:manage",
  "discussions:posts:read",
  "discussions:posts:manage",
  "analytics:read",
];

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: "demo" },
    update: {},
    create: { slug: "demo", name: "Demo University", tier: "pool", status: "active" },
  });

  const org = await prisma.orgUnit.create({
    data: { tenantId: tenant.id, type: "organization", name: "Demo University" },
  });

  await prisma.permission.createMany({
    data: PERMISSIONS.map((key) => ({ key })),
    skipDuplicates: true,
  });

  for (const name of STANDARD_ROLES) {
    await prisma.role.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name } },
      update: {},
      create: { tenantId: tenant.id, name, isSystem: true },
    });
  }

  // eslint-disable-next-line no-console
  console.log(`Seeded tenant ${tenant.slug} (org ${org.id})`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
