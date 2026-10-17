import { describe, expect, it } from 'vitest';
import {
  PRODUCT_OBSERVABILITY_SCHEMA_VERSION,
  OBSERVABILITY_COUNTER_LIMITS,
  observabilityCountersInDomain,
  validatePlanningOutcomeTelemetryDraft,
  validateProductActivityTelemetryDraft,
} from './productObservabilityContract';

function validDraft() {
  return {
    schemaVersion: PRODUCT_OBSERVABILITY_SCHEMA_VERSION,
    eventId: 'activity-12345678',
    eventType: 'product_activity' as const,
    occurredAt: '2026-08-28T00:00:00.000Z',
    appVersion: '1.2.3',
    source: 'web_app' as const,
    correlation: {
      featureSessionId: 'weekly-session-1',
      stateRevision: 3,
    },
    payload: {
      action: 'weekly_planning_opened' as const,
    },
  };
}

describe('product observability contract', () => {
  it('accepts a valid product activity draft', () => {
    expect(validateProductActivityTelemetryDraft(validDraft())).toEqual({
      ok: true,
      value: validDraft(),
    });
  });

  it('rejects unknown top-level fields so raw user data cannot hitchhike in metadata', () => {
    expect(validateProductActivityTelemetryDraft({
      ...validDraft(),
      metadata: { email: 'user@example.com' },
    })).toEqual({
      ok: false,
      error: 'Telemetry payload contains unknown fields.',
    });
  });

  it('rejects unknown payload fields and free-form content', () => {
    expect(validateProductActivityTelemetryDraft({
      ...validDraft(),
      payload: {
        action: 'plan_created',
        text: 'sensitive user text',
      },
    })).toEqual({
      ok: false,
      error: 'Telemetry activity payload is invalid.',
    });
  });

  it('rejects raw identity fields in correlation', () => {
    expect(validateProductActivityTelemetryDraft({
      ...validDraft(),
      correlation: {
        featureSessionId: 'weekly-session-1',
        userId: 'raw-firebase-uid',
      },
    })).toEqual({
      ok: false,
      error: 'Telemetry correlation is invalid.',
    });
  });

  it('rejects unsupported activity actions', () => {
    expect(validateProductActivityTelemetryDraft({
      ...validDraft(),
      payload: { action: 'arbitrary_event' },
    })).toEqual({
      ok: false,
      error: 'Telemetry activity payload is invalid.',
    });
  });
});

function planningDraft() {
  return { ...validDraft(), eventType: 'planning_outcome', source: 'weekly_planning',
    payload: { outcomeType: 'preview_generated', turnIndex: 2, stateRevision: 3,
      previewCount: 500, unscheduledCount: 512, fallbackUsed: false, repairUsed: false,
      staleObserved: false, approvalFailureObserved: false, schedulerVersion: null, promptVersion: null, model: null } };
}

describe('telemetry counter domains', () => {
  it('accepts typical planning counters and preserves unknown measurements', () => {
    expect(validatePlanningOutcomeTelemetryDraft(planningDraft()).ok).toBe(true);
    const draft = planningDraft();
    expect(validatePlanningOutcomeTelemetryDraft({ ...draft, payload: { ...draft.payload,
      turnIndex: null, stateRevision: null, previewCount: null, unscheduledCount: null } }).ok).toBe(true);
  });
  it.each(['turnIndex', 'stateRevision', 'previewCount', 'unscheduledCount'] as const)(
    'accepts %s at its domain maximum and rejects maximum + 1', (key) => {
      const draft = planningDraft();
      const withCounter = (value: number) => ({ ...draft, payload: { ...draft.payload, [key]: value } });
      expect(validatePlanningOutcomeTelemetryDraft(withCounter(OBSERVABILITY_COUNTER_LIMITS[key])).ok).toBe(true);
      for (const value of [OBSERVABILITY_COUNTER_LIMITS[key] + 1, Number.MAX_SAFE_INTEGER, -1, 0.5]) {
        expect(validatePlanningOutcomeTelemetryDraft(withCounter(value))).toEqual({ ok: false,
          error: 'Telemetry planning outcome payload is invalid.' });
      }
    });
  it('bounds revision in every client correlation kind', () => {
    for (const draft of [validDraft(), planningDraft()]) {
      const withRevision = (value: number) => ({ ...draft, correlation: { ...draft.correlation, stateRevision: value } });
      const validate = draft.eventType === 'product_activity' ? validateProductActivityTelemetryDraft : validatePlanningOutcomeTelemetryDraft;
      expect(validate(withRevision(OBSERVABILITY_COUNTER_LIMITS.stateRevision)).ok).toBe(true);
      expect(validate(withRevision(OBSERVABILITY_COUNTER_LIMITS.stateRevision + 1)).ok).toBe(false);
    }
  });
  const aiPayload = { promptTokens: null, completionTokens: null, totalTokens: null, cachedTokens: null,
    responseBytes: null, estimatedCostMicros: null, durationMs: 100, requestBytes: 100 };
  it.each([
    ['promptTokens', OBSERVABILITY_COUNTER_LIMITS.tokens],
    ['completionTokens', OBSERVABILITY_COUNTER_LIMITS.tokens],
    ['totalTokens', OBSERVABILITY_COUNTER_LIMITS.tokens],
    ['cachedTokens', OBSERVABILITY_COUNTER_LIMITS.tokens],
    ['cacheWriteTokens', OBSERVABILITY_COUNTER_LIMITS.tokens],
    ['reasoningTokens', OBSERVABILITY_COUNTER_LIMITS.tokens],
    ['requestBytes', OBSERVABILITY_COUNTER_LIMITS.bytes],
    ['responseBytes', OBSERVABILITY_COUNTER_LIMITS.bytes],
    ['durationMs', OBSERVABILITY_COUNTER_LIMITS.durationMs],
    ['estimatedCostMicros', OBSERVABILITY_COUNTER_LIMITS.estimatedCostMicros],
  ])('bounds server AI metric %s consistently', (key, max) => {
    const check = (value: number) => observabilityCountersInDomain({ eventType: 'ai_request_metric', payload: { ...aiPayload, [key]: value } });
    expect(check(max)).toBe(true);
    expect(check(max + 1)).toBe(false);
  });
  it('bounds decision revision and completion token metadata', () => {
    const payload = { ...aiPayload, decision: { inputRevision: OBSERVABILITY_COUNTER_LIMITS.stateRevision, reportedCostUsd: 1 },
      providerCompletion: { requestedMaxCompletionTokens: null, effectiveMaxCompletionTokens: 4096, reasoningTokens: null, textTokens: null } };
    const check = () => observabilityCountersInDomain({ eventType: 'ai_request_metric', payload });
    expect(check()).toBe(true);
    payload.decision.inputRevision += 1;
    expect(check()).toBe(false);
    payload.decision.inputRevision = 0;
    payload.providerCompletion.effectiveMaxCompletionTokens = OBSERVABILITY_COUNTER_LIMITS.tokens + 1;
    expect(check()).toBe(false);
  });
});
