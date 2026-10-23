import { describe, expect, it } from 'vitest';
import {
  buildObservabilitySystemReadModel,
  ProductObservabilitySystemStatusService,
} from './productObservabilitySystemStatusService';

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
    expect(model.aggregation.rejectedEventCount).toBe(0);
    expect(model.aggregation.lastRejectedEvent).toBeNull();
  });

  it('warns about excluded measurements even when the rollup is current', () => {
    const model = buildObservabilitySystemReadModel({ environment: 'production', generatedAt,
      telemetryProbe: { ok: true, value: { observedAt: generatedAt } }, traceProbe: { ok: true, value: { retained: false, lastActivityAt: null } },
      aggregationProbe: { ok: true, value: { processedEventCount: 1, rejectedEventCount: 1, dirtySourceCount: 0,
        lastRunStartedAt: generatedAt, lastSuccessfulRunAt: generatedAt, lastFailureAt: null, lastFailureCategory: null } } });
    expect(model.components.find((item) => item.key === 'aggregation_read_model')).toMatchObject({ status: 'warning',
      summary: expect.stringContaining('measurements are incomplete'), detail: expect.stringContaining('Excluded events') });
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

  it('uses a bounded index-safe telemetry probe and scopes dirty sources to the selected environment', async () => {
    const queryCalls: Array<{
      collection: string;
      filters?: Array<{ field: string; value: string }>;
      limit?: number;
    }> = [];
    const firestore = {
      async getDocument(collection: string) {
        if (collection !== 'observability_rollup_state') return null;
        return {
          processedEventCount: 300,
          rejectedEventCount: 2,
          lastRejectedEvent: { documentName: 'observability_events/poison', observedAt: generatedAt,
            environment: 'production', reason: 'counter_out_of_domain' },
          activeUserDirtySources: [
            { environment: 'production', localDate: '2026-08-30', revision: 1 },
            { environment: 'preview', localDate: '2026-08-30', revision: 1 },
          ],
          lastRunStartedAt: '2026-08-30T11:59:00.000Z',
          lastSuccessfulRunAt: '2026-08-30T11:59:30.000Z',
          lastFailureAt: null,
          lastFailureCategory: null,
        };
      },
      async queryDocumentsAfter(params: {
        collection: string;
        orderByField: string;
        filters?: Array<{ field: string; value: string }>;
        limit?: number;
        direction?: 'ASCENDING' | 'DESCENDING';
      }) {
        queryCalls.push({
          collection: params.collection,
          filters: params.filters,
          limit: params.limit,
        });
        if (params.collection === 'observability_events') {
          return [
            {
              id: 'event-production',
              documentName: 'projects/test/databases/(default)/documents/observability_events/event-production',
              environment: 'production',
              observedAt: '2026-08-30T11:59:50.000Z',
            },
            {
              id: 'event-preview',
              documentName: 'projects/test/databases/(default)/documents/observability_events/event-preview',
              environment: 'preview',
              observedAt: '2026-08-30T11:59:40.000Z',
            },
          ];
        }
        return [];
      },
    };
    const service = new ProductObservabilitySystemStatusService({} as never, firestore);

    const model = await service.getSystemStatus('preview');

    expect(model.environment).toBe('preview');
    expect(model.components.find((item) => item.key === 'telemetry_ingestion')?.lastObservedAt)
      .toBe('2026-08-30T11:59:40.000Z');
    expect(model.aggregation.dirtySourceCount).toBe(1);
    expect(model.aggregation.rejectedEventCount).toBe(2);
    expect(model.aggregation.lastRejectedEvent?.reason).toBe('counter_out_of_domain');
    expect(model.components.find((item) => item.key === 'aggregation_read_model')).toMatchObject({
      status: 'warning', detail: expect.stringContaining('Excluded events (all environments): 2'),
    });
    expect(queryCalls.find((call) => call.collection === 'observability_events')).toEqual({
      collection: 'observability_events',
      filters: undefined,
      limit: 50,
    });
  });
});
