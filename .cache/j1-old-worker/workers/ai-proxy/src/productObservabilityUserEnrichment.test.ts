import { describe, expect, it } from 'vitest';
import { classifyObservabilityEventError } from './productObservabilityUserEnrichment';

describe('classifyObservabilityEventError', () => {
  it('uses only existing typed AI and planning error semantics', () => {
    expect(classifyObservabilityEventError({
      eventType: 'ai_request_metric',
      occurredAt: '2026-09-25T00:00:00.000Z',
      payload: { status: 'provider_error', errorCategory: 'provider_error' },
    })).toEqual({
      occurredAt: '2026-09-25T00:00:00.000Z',
      category: 'provider_error',
    });
    expect(classifyObservabilityEventError({
      eventType: 'planning_outcome',
      occurredAt: '2026-09-25T00:00:01.000Z',
      payload: { outcomeType: 'approval_failure_observed' },
    })).toEqual({
      occurredAt: '2026-09-25T00:00:01.000Z',
      category: 'planning_approval_failure',
    });
    expect(classifyObservabilityEventError({
      eventType: 'product_activity',
      occurredAt: '2026-09-25T00:00:02.000Z',
      payload: { error: 'raw text is not semantic authority' },
    })).toBeNull();
  });
});
