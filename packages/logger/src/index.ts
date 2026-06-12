import pino, { type Logger } from "pino";

export type { Logger };

/**
 * Structured JSON logger. Tenant- and request-scoped child loggers
 * keep tenant_id on every line for multi-tenant traceability.
 */
export function createLogger(service: string): Logger {
  return pino({
    name: service,
    level: process.env.LOG_LEVEL ?? "info",
    redact: ["req.headers.authorization", "*.password", "*.token"],
    base: { service, env: process.env.NODE_ENV ?? "development" },
  });
}

export function withTenant(logger: Logger, tenantId: string): Logger {
  return logger.child({ tenantId });
}
