# @lms/observability

Distributed tracing for the LMS service mesh — a thin wrapper over the
OpenTelemetry Node SDK that auto-instruments `http` + `undici` (W3C
`traceparent` propagation across the gateway → service `fetch` calls) and
`fastify` (server spans tagged with the opaque tenant id). See ADR-OTEL.

## No-op by default

Nothing is exported and no instrumentation is installed unless **all** of:

- `OTEL_ENABLED=true`, **and**
- `OTEL_EXPORTER_OTLP_ENDPOINT` is set, **and**
- the process is not running under Vitest (`VITEST` unset).

So local/dev/CI without a backend is completely silent (no spans, no
connection attempts, negligible overhead).

## Wiring

Wired process-wide via a Node preload (no per-service code). docker-compose's
`x-common-env` anchor sets:

```yaml
NODE_OPTIONS: --require @lms/observability/register
```

`register` runs before any service module loads, so HTTP clients are patched
before the gateway's global `fetch` is first used. Each service block sets its
own `OTEL_SERVICE_NAME` (the compose service key) for a distinct `service.name`.

You can also initialise programmatically: `startTelemetry("my-service")`
(idempotent; obeys the same no-op rules).

## Environment contract

| Var | Purpose | Default |
| --- | --- | --- |
| `OTEL_ENABLED` | feature flag; export only when `=true` | `false` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | vendor OTLP/HTTP base URL | unset (→ no-op) |
| `OTEL_EXPORTER_OTLP_HEADERS` | auth header(s), comma-separated `k=v` | unset |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` (or `http/json`) | `http/protobuf` |
| `OTEL_SERVICE_NAME` | per-service `service.name` | per-service block |

### Axiom (verify vendor specifics)

```
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.axiom.co
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer xaat-<token>,X-Axiom-Dataset=<dataset>
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

### Grafana Cloud (verify vendor specifics)

```
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-<zone>.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64(instanceID:apiToken)>
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

## Tenant tagging (no PII)

The Fastify `requestHook` tags each server span with `tenant.id` read **only**
from the `x-tenant-id` header (an opaque tenant UUID). It never tags
`x-user-id`, `x-user-roles`, email, or name — no user PII lands on spans.

## Public API

- `startTelemetry(serviceName?: string): void` — idempotent init (no-op by default).
- `buildTenantRequestHook()` — the tenant-tagging hook (exported for testing).
- `isTelemetryEnabled(env?)` — the no-op gate predicate (exported for testing).
