import * as fs from "node:fs";
import * as path from "node:path";

import type { Span } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { FastifyInstrumentation } from "@opentelemetry/instrumentation-fastify";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { Resource } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";

/**
 * `@lms/observability` — distributed tracing for the LMS service mesh.
 *
 * Wired process-wide via the `@lms/observability/register` preload
 * (`node --require @lms/observability/register`, injected by docker-compose's
 * `x-common-env`). The OTel SDK auto-instruments `http` + `undici` (the gateway's
 * global `fetch`) for W3C `traceparent` propagation, and `fastify` for server
 * spans tagged with the opaque tenant id (never user PII). See ADR-OTEL.
 *
 * No-op by default: nothing is exported unless `OTEL_ENABLED=true` AND
 * `OTEL_EXPORTER_OTLP_ENDPOINT` is set AND we are not under Vitest.
 */

/** Span attribute key for the opaque (non-PII) tenant identifier. */
export const TENANT_ID_ATTRIBUTE = "tenant.id";

/** Minimal structural view of the request the Fastify requestHook receives. */
export interface TenantHookRequest {
  headers?: Record<string, string | string[] | undefined>;
}

/** Minimal structural view of the Fastify instrumentation requestHook info bag. */
export interface TenantHookInfo {
  request?: TenantHookRequest;
}

/**
 * Build the Fastify `requestHook` that tags the server span with the tenant id.
 *
 * Reads ONLY the opaque `x-tenant-id` header (a tenant UUID stamped by the
 * gateway authGuard — not PII). It MUST NOT read or tag `x-user-id`,
 * `x-user-roles`, email, or name; no user PII ever lands on a span (ADR-OTEL,
 * Decision 3). Exported so the tagging + PII-exclusion logic is unit-testable
 * without a live SDK or network.
 */
export function buildTenantRequestHook(): (span: Span, info: TenantHookInfo) => void {
  return (span, info) => {
    const raw = info?.request?.headers?.["x-tenant-id"];
    const tenantId = Array.isArray(raw) ? raw[0] : raw;
    if (typeof tenantId === "string" && tenantId.length > 0) {
      span.setAttribute(TENANT_ID_ATTRIBUTE, tenantId);
    }
  };
}

/**
 * Whether telemetry export should start. Reads RAW `process.env` because the
 * preload runs before `@lms/config` loads. No-op (returns `false`) unless OTel
 * is explicitly enabled, an OTLP endpoint is configured, and we are not under
 * Vitest — so local/dev/CI without a backend is completely silent.
 */
export function isTelemetryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.VITEST) return false;
  if (env.OTEL_ENABLED !== "true") return false;
  if (!env.OTEL_EXPORTER_OTLP_ENDPOINT) return false;
  return true;
}

/**
 * Best-effort `service.name` fallback: the nearest `package.json` "name" walking
 * up from `process.cwd()` (Docker WORKDIR is `/app/services/<svc>`), so a service
 * is never anonymous even if its compose block forgets `OTEL_SERVICE_NAME`.
 */
function readNearestPackageName(): string | undefined {
  try {
    let dir = process.cwd();
    for (let depth = 0; depth < 6; depth += 1) {
      const candidate = path.join(dir, "package.json");
      if (fs.existsSync(candidate)) {
        const pkg = JSON.parse(fs.readFileSync(candidate, "utf8")) as { name?: string };
        if (pkg.name) return pkg.name;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // best-effort only — never block startup on a name lookup
  }
  return undefined;
}

let started = false;
let activeSdk: NodeSDK | undefined;

/**
 * Initialise OpenTelemetry tracing for this process. Idempotent (safe to call
 * twice — returns early if already started). No-op unless `isTelemetryEnabled()`.
 *
 * @param serviceName overrides `OTEL_SERVICE_NAME` / nearest package.json name.
 */
export function startTelemetry(serviceName?: string): void {
  if (started) return;
  if (!isTelemetryEnabled()) return;
  started = true;

  const resolvedName =
    serviceName ??
    process.env.OTEL_SERVICE_NAME ??
    readNearestPackageName() ??
    "lms-service";

  const tenantHook = buildTenantRequestHook();

  activeSdk = new NodeSDK({
    resource: new Resource({ "service.name": resolvedName }),
    // Reads OTEL_EXPORTER_OTLP_ENDPOINT / _HEADERS / _PROTOCOL from the environment.
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      new HttpInstrumentation(),
      new UndiciInstrumentation(),
      new FastifyInstrumentation({
        requestHook: (span, info) => tenantHook(span, info as unknown as TenantHookInfo),
      }),
    ],
  });

  activeSdk.start();

  const shutdown = (): void => {
    void activeSdk?.shutdown().catch(() => undefined);
  };
  process.once("SIGTERM", shutdown);
  process.once("beforeExit", shutdown);
}
