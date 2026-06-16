import { z } from "zod";

/**
 * Centralised, validated environment configuration.
 * Fails fast at boot if required variables are missing.
 */
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  // Tenancy
  TENANT_MODE: z.enum(["pool", "silo", "hybrid"]).default("hybrid"),
  DEFAULT_TENANT_TIER: z.enum(["pool", "silo"]).default("pool"),

  // Database
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),
  CONTROL_PLANE_DATABASE_URL: z.string().url().optional(),

  // Silo provisioning (Neon)
  NEON_API_KEY: z.string().optional(),
  NEON_PROJECT_ID: z.string().optional(),

  // Auth
  JWT_SECRET: z.string().min(16),
  JWT_ISSUER: z.string().url().optional(),
  JWT_AUDIENCE: z.string().default("lms-api"),
  ACCESS_TOKEN_TTL: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL: z.coerce.number().default(2_592_000),

  // Infra
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),

  // Rate limiting (gateway). Default per-tenant budget per fixed window; the
  // gateway resolves the effective limit per tenant (extensible by plan). Backed
  // by Upstash Redis when its creds are set, else an in-process limiter.
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
