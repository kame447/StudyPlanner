import { createProductTelemetryPort } from './productTelemetry';
import { createPlanningOutcomeTelemetryPort } from './planningOutcomeTelemetry';
import { createObservedPlannerRepository } from '../../repositories/observedPlannerRepository';
import type { PlannerRepository } from '../../repositories/repositoryContracts';
import type { Plan } from '../../types/domain';
import { describe, expect, it, vi } from 'vitest';
import { PRODUCT_OBSERVABILITY_SCHEMA_VERSION } from '../../../shared/productObservabilityContract';
import {
  buildProductObservabilityEventsEndpoint,
  createRemoteProductTelemetrySink,
} from './productTelemetryRemoteSink';

describe('product telemetry remote sink', () => {
  it('builds the observability endpoint from the AI proxy URL', () => {
    expect(buildProductObservabilityEventsEndpoint('https://proxy.example/chat/completions'))
      .toBe('https://proxy.example/observability/events');
    expect(buildProductObservabilityEventsEndpoint('https://proxy.example/'))
      .toBe('https://proxy.example/observability/events');
  });

  it('sends only the typed event with the current Firebase token', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ accepted: true }), { status: 202 }));
    const sink = createRemoteProductTelemetrySink({
      endpoint: 'https://proxy.example/observability/events',
      getIdToken: async () => 'firebase-token',
      fetcher: fetcher as typeof fetch,
    });
    const event = {
      schemaVersion: PRODUCT_OBSERVABILITY_SCHEMA_VERSION,
      eventId: 'activity-12345678',
      eventType: 'product_activity' as const,
      occurredAt: '2026-08-28T00:00:00.000Z',
      appVersion: '1.2.3',
      source: 'web_app' as const,
      payload: { action: 'app_active' as const },
    };

    await sink.write(event);

    const [, init] = fetcher.mock.calls[0] ?? [];
    expect(fetcher).toHaveBeenCalledWith(
      'https://proxy.example/observability/events',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer firebase-token');
    expect(JSON.parse(String(init?.body))).toEqual(event);
  });

  it('rejects so the best-effort port can isolate endpoint failures', async () => {
    const sink = createRemoteProductTelemetrySink({
      endpoint: 'https://proxy.example/observability/events',
      getIdToken: async () => 'firebase-token',
      fetcher: async () => new Response(null, { status: 503 }),
    });

    await expect(sink.write({
      schemaVersion: PRODUCT_OBSERVABILITY_SCHEMA_VERSION,
      eventId: 'activity-12345678',
      eventType: 'product_activity',
      occurredAt: '2026-08-28T00:00:00.000Z',
      appVersion: '1.2.3',
      source: 'web_app',
      payload: { action: 'app_active' },
    })).rejects.toThrow('Product telemetry request failed: 503');
  });
});

it('isolates HTTP 429 from real plan creation/update and planning save telemetry', async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 429 }));
  const sink = createRemoteProductTelemetrySink({ endpoint: 'https://proxy.example/observability/events',
    getIdToken: async () => 'firebase-token', fetcher });
  const failures: unknown[] = [];
  const onError = (error: unknown) => failures.push(error);
  const port = createProductTelemetryPort({ appVersion: 'test', sink, onError });
  const saved = { id: 'plan-1', createdAt: '2026-08-28T00:00:00.000Z', updatedAt: '2026-08-28T00:00:00.000Z' } as Plan;
  const upsertPlan = vi.fn(async (plan: Plan) => plan);
  const repository = createObservedPlannerRepository({ upsertPlan } as unknown as PlannerRepository, port);
  await expect(repository.upsertPlan(saved)).resolves.toBe(saved);
  const updated = { ...saved, updatedAt: '2026-08-28T00:01:00.000Z' };
  await expect(repository.upsertPlan(updated)).resolves.toBe(updated);
  const planningPort = createPlanningOutcomeTelemetryPort({ appVersion: 'test', sink, onError });
  expect(() => planningPort.recordOutcome({ outcomeType: 'save_completed', featureSessionId: 'session-1', dedupeKey: 'save-1' })).not.toThrow();
  await vi.waitFor(() => expect(failures).toHaveLength(3));
  expect(failures.every((error) => error instanceof Error && error.message.endsWith('429'))).toBe(true);
  expect(upsertPlan).toHaveBeenCalledTimes(2);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
