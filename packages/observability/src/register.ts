// CJS preload entry: `node --require @lms/observability/register`.
// Runs before any service module loads so http/undici/fastify are patched
// before the first HTTP client (the gateway's global fetch) is created.
// No-op unless OTEL_ENABLED=true and an OTLP endpoint is configured (see index.ts).
import { startTelemetry } from "./index.js";

startTelemetry();
