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
  MIGRATION_DATABASE_URL: z.string().url().optional(), // privileged owner/migrator — migrate/seed tooling ONLY; never read by runtime services

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

  // Video transcoder selection (#315). "stub" (default) is the deterministic,
  // offline, no-FFmpeg/no-network worker so the service boots and CI passes with
  // nothing configured; "ffmpeg" selects the real bundled-FFmpeg worker that
  // probes/transcodes the source and uploads an HLS ladder to blob storage
  // (requires BLOB_READ_WRITE_TOKEN at run time). Optional + additive so other
  // services keep typechecking unchanged.
  VIDEO_TRANSCODER: z.enum(["stub", "ffmpeg"]).default("stub"),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default("llama-3.3-70b-versatile"),
  GROQ_MAX_TOKENS: z.coerce.number().int().positive().default(1024),

  // Observability / distributed tracing (#83). Optional + tolerant: the OTel
  // preload (@lms/observability/register) reads RAW process.env before config
  // loads, so these exist here only for documentation + typed access by app
  // code. Empty-string is tolerated (docker-compose passes empty defaults for
  // the optional endpoint/headers) and the endpoint is NOT validated as a URL
  // (vendors vary on scheme/path), so this never breaks boot.
  OTEL_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().optional(),

  // Rate limiting (gateway). Default per-tenant budget per fixed window; the
  // gateway resolves the effective limit per tenant (extensible by plan). Backed
  // by Upstash Redis when its creds are set, else an in-process limiter.
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),

  // AI chat rate limiting + cost ceiling (#309). The ai `POST
  // /courses/:courseId/chat` endpoint enforces a per-tenant AND per-user request
  // rate limit (same limiter core as the gateway, Upstash-optional), plus a
  // durable per-tenant per-UTC-day usage ceiling that bounds Groq spend.
  AI_CHAT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  AI_CHAT_USER_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  AI_CHAT_RATE_LIMIT_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60),
  AI_CHAT_DAILY_TENANT_REQUEST_CEILING: z.coerce
    .number()
    .int()
    .positive()
    .default(2000),
  // 0 = token ceiling disabled (request ceiling still applies).
  AI_CHAT_DAILY_TENANT_TOKEN_CEILING: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(0),
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
