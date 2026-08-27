import { describe, expect, it } from 'vitest';
import {
  PRODUCT_OBSERVABILITY_SCHEMA_VERSION,
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
