import { describe, expect, it, vi } from 'vitest';
import {
  validatePlanningOutcomeTelemetryDraft,
  type PlanningOutcomeTelemetryDraft,
} from '../../../shared/productObservabilityContract';
import {
  createPlanningOutcomeEventId,
  createPlanningOutcomeTelemetryPort,
} from './planningOutcomeTelemetry';
import type { ProductTelemetrySink } from './productTelemetry';

describe('planning outcome telemetry', () => {
  it('builds a bounded typed event without raw identity or free-form text', async () => {
    const writtenEvents: PlanningOutcomeTelemetryDraft[] = [];
    const sink: ProductTelemetrySink = {
      async write(event) {
        if (event.eventType === 'planning_outcome') writtenEvents.push(event);
      },
    };
    const port = createPlanningOutcomeTelemetryPort({
      appVersion: '1.2.3',
      sink,
      now: () => new Date('2026-08-28T00:00:00.000Z'),
    });

    port.recordOutcome({
      outcomeType: 'preview_generated',
      featureSessionId: 'weekly-conversation-1',
      dedupeKey: 'weekly-request-1',
      requestId: 'weekly-request-1',
      stateRevision: 4,
      turnIndex: 2,
      previewCount: 5,
      unscheduledCount: 0,
      repairUsed: false,
      schedulerVersion: 'weekly-planning-stable-v5-preview-scheduler-v1',
    });
    await Promise.resolve();

    expect(writtenEvents).toEqual([{
      schemaVersion: 1,
      eventId: 'planning-preview_generated-weekly-request-1',
      eventType: 'planning_outcome',
      occurredAt: '2026-08-28T00:00:00.000Z',
      appVersion: '1.2.3',
      source: 'weekly_planning',
      correlation: {
        featureSessionId: 'weekly-conversation-1',
        requestId: 'weekly-request-1',
        stateRevision: 4,
      },
      payload: {
        outcomeType: 'preview_generated',
        turnIndex: 2,
        stateRevision: 4,
        previewCount: 5,
        unscheduledCount: 0,
        fallbackUsed: null,
        repairUsed: false,
        staleObserved: null,
        approvalFailureObserved: null,
        schedulerVersion: 'weekly-planning-stable-v5-preview-scheduler-v1',
        promptVersion: null,
        model: null,
      },
    }]);
    expect(validatePlanningOutcomeTelemetryDraft(writtenEvents[0]).ok).toBe(true);
    const serialized = JSON.stringify(writtenEvents[0]);
    expect(serialized).not.toContain('userId');
    expect(serialized).not.toContain('email');
    expect(serialized).not.toContain('userText');
  });

  it('keeps unknown metrics null instead of fabricating zero or false', async () => {
    const writtenEvents: PlanningOutcomeTelemetryDraft[] = [];
    const port = createPlanningOutcomeTelemetryPort({
      appVersion: '1.2.3',
      sink: {
        async write(event) {
          if (event.eventType === 'planning_outcome') writtenEvents.push(event);
        },
      },
    });

    port.recordOutcome({
      outcomeType: 'session_started',
      featureSessionId: 'weekly-conversation-1',
      dedupeKey: 'weekly-conversation-1',
    });
    await Promise.resolve();

    expect(writtenEvents).toHaveLength(1);
    expect(writtenEvents[0].payload).toMatchObject({
      previewCount: null,
      unscheduledCount: null,
      fallbackUsed: null,
      repairUsed: null,
      staleObserved: null,
      approvalFailureObserved: null,
    });
  });

  it('reports sink failure without throwing into product behavior', async () => {
    const onError = vi.fn();
    const port = createPlanningOutcomeTelemetryPort({
      appVersion: '1.2.3',
      sink: {
        async write() {
          throw new Error('telemetry unavailable');
        },
      },
      onError,
    });

    expect(() => port.recordOutcome({
      outcomeType: 'failed',
      featureSessionId: 'weekly-conversation-1',
      dedupeKey: 'weekly-request-1',
    })).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('sanitizes stable event ids and rejects an empty dedupe key', () => {
    expect(createPlanningOutcomeEventId('failed', 'request / 1'))
      .toBe('planning-failed-request-1');
    expect(() => createPlanningOutcomeEventId('failed', '   '))
      .toThrow('Planning outcome dedupeKey is required.');
  });
});
