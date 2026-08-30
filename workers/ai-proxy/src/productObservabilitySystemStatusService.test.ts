import { describe, expect, it } from 'vitest';
import { buildObservabilitySystemReadModel } from './productObservabilitySystemStatusService';

describe('Phase 8 system observability projection', () => {
  const generatedAt = '2026-08-30T12:00:00.000Z';

  it('reports healthy reachable components without treating quiet telemetry as failure', () => {
    const model = buildObservabilitySystemReadModel({
      environment: 'production',
      generatedAt,
      telemetryProbe: { ok: true, value: { observedAt: null } },
      aggregationProbe: {
        ok: true,
        value: {
          processedEventCount: 120,
          dirtySourceCount: 0,
          lastRunStartedAt: '2026-08-30T11:55:00.000Z',
          lastSuccessfulRunAt: '2026-08-30T11:56:00.000Z',
          lastFailureAt: null,
          lastFailureCategory: null,
        },
      },
      traceProbe: { ok: true, value: { retained: false, lastActivityAt: null } },
    });

    expect(model.components.find((item) => item.key === 'telemetry_ingestion')?.status).toBe('unknown');
    expect(model.components.find((item) => item.key === 'trace_availability')?.status).toBe('healthy');
    expect(model.components.find((item) => item.key === 'aggregation_read_model')?.status).toBe('healthy');
    expect(model.overallStatus).toBe('unknown');
  });

  it('warns when a five-minute rollup has not succeeded within the freshness window', () => {
    const model = buildObservabilitySystemReadModel({
      environment: 'production',
      generatedAt,
      telemetryProbe: { ok: true, value: { observedAt: '2026-08-30T11:59:30.000Z' } },
      aggregationProbe: {
        ok: true,
        value: {
          processedEventCount: 120,
          dirtySourceCount: 0,
          lastRunStartedAt: '2026-08-30T11:30:00.000Z',
          lastSuccessfulRunAt: '2026-08-30T11:30:30.000Z',
          lastFailureAt: null,
          lastFailureCategory: null,
        },
      },
      traceProbe: { ok: true, value: { retained: true, lastActivityAt: '2026-08-30T11:40:00.000Z' } },
    });

    const aggregation = model.components.find((item) => item.key === 'aggregation_read_model');
    expect(aggregation?.status).toBe('warning');
    expect(aggregation?.ageSeconds).toBe(1770);
    expect(model.overallStatus).toBe('warning');
  });

  it('keeps component failures isolated instead of failing the whole read model', () => {
    const model = buildObservabilitySystemReadModel({
      environment: 'production',
      generatedAt,
      telemetryProbe: { ok: false, value: null },
      aggregationProbe: { ok: false, value: null },
      traceProbe: { ok: false, value: null },
    });

    expect(model.components.find((item) => item.key === 'ai_proxy')?.status).toBe('healthy');
    expect(model.components.find((item) => item.key === 'authentication')?.status).toBe('healthy');
    expect(model.overallStatus).toBe('unavailable');
    expect(model.trace.retainedSessionObserved).toBeNull();
  });
});
