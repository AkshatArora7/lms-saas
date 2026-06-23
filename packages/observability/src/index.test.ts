import type { Span } from "@opentelemetry/api";
import { Resource } from "@opentelemetry/resources";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { describe, expect, it } from "vitest";

import {
  buildTenantRequestHook,
  isTelemetryEnabled,
  startTelemetry,
  TENANT_ID_ATTRIBUTE,
  type TenantHookInfo,
} from "./index.js";

const TENANT = "11111111-1111-1111-1111-111111111111";

/** Offline tracer provider feeding an InMemorySpanExporter — no network. */
function tracerProviderForTest(exporter: SpanExporter): BasicTracerProvider {
  const provider = new BasicTracerProvider({
    resource: new Resource({ "service.name": "test-service" }),
  });
  provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
  return provider;
}

/** Minimal fake span that records setAttribute calls, to isolate the hook logic. */
function fakeSpan(): { attributes: Record<string, unknown>; span: Span } {
  const attributes: Record<string, unknown> = {};
  const span = {
    setAttribute(key: string, value: unknown) {
      attributes[key] = value;
      return span;
    },
  } as unknown as Span;
  return { attributes, span };
}

describe("@lms/observability tracing", () => {
  it("U1: records a span via NodeTracerProvider + InMemorySpanExporter", () => {
    const exporter = new InMemorySpanExporter();
    const provider = tracerProviderForTest(exporter);

    const span = provider.getTracer("test").startSpan("GET /x");
    span.end();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.resource.attributes["service.name"]).toBe("test-service");
  });

  it("U2: tenant requestHook sets tenant.id from the x-tenant-id header", () => {
    const exporter = new InMemorySpanExporter();
    const provider = tracerProviderForTest(exporter);

    const span = provider.getTracer("test").startSpan("GET /x");
    const info: TenantHookInfo = { request: { headers: { "x-tenant-id": TENANT } } };
    buildTenantRequestHook()(span, info);
    span.end();

    const [recorded] = exporter.getFinishedSpans();
    expect(recorded?.attributes[TENANT_ID_ATTRIBUTE]).toBe(TENANT);
  });

  it("U3: PII guard — never tags user id / roles / email / name", () => {
    const { attributes, span } = fakeSpan();
    const info: TenantHookInfo = {
      request: {
        headers: {
          "x-tenant-id": TENANT,
          "x-user-id": "user-abc",
          "x-user-roles": "admin,teacher",
          "x-user-email": "alice@example.com",
          "x-user-name": "Alice",
        },
      },
    };

    buildTenantRequestHook()(span, info);

    expect(attributes[TENANT_ID_ATTRIBUTE]).toBe(TENANT);
    // Only tenant.id is ever set — nothing derived from the user headers.
    expect(Object.keys(attributes)).toEqual([TENANT_ID_ATTRIBUTE]);
    const serialized = JSON.stringify(attributes);
    expect(serialized).not.toContain("user-abc");
    expect(serialized).not.toContain("admin,teacher");
    expect(serialized).not.toContain("alice@example.com");
    expect(serialized).not.toContain("Alice");
  });

  it("U3b: tenant requestHook sets nothing when x-tenant-id is absent or empty", () => {
    const { attributes, span } = fakeSpan();
    buildTenantRequestHook()(span, { request: { headers: { "x-user-id": "user-abc" } } });
    expect(Object.keys(attributes)).toHaveLength(0);

    const empty = fakeSpan();
    buildTenantRequestHook()(empty.span, { request: { headers: { "x-tenant-id": "" } } });
    expect(Object.keys(empty.attributes)).toHaveLength(0);
  });

  it("U4: isTelemetryEnabled is false unless enabled + endpoint set + not under Vitest", () => {
    expect(isTelemetryEnabled({})).toBe(false);
    expect(isTelemetryEnabled({ OTEL_ENABLED: "true" })).toBe(false); // no endpoint
    expect(
      isTelemetryEnabled({
        OTEL_ENABLED: "true",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
        VITEST: "true",
      }),
    ).toBe(false);
    expect(
      isTelemetryEnabled({
        OTEL_ENABLED: "true",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
      }),
    ).toBe(true);
  });

  it("U4b: startTelemetry is a no-op under Vitest and does not throw", () => {
    expect(() => startTelemetry()).not.toThrow();
    expect(startTelemetry()).toBeUndefined();
  });
});
