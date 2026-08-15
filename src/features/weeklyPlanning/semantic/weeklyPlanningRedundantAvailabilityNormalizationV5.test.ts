import { describe, expect, it } from 'vitest';
import {
  normalizeRedundantHardAvailabilityV5,
} from './weeklyPlanningRedundantAvailabilityNormalizationV5';

function responseWithAvailability(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [{
      localId: 'availability-1',
      kind: 'available',
      constraintLevel: 'hard',
      dateExpression: '8月17日から23日',
      namedTimePeriod: null,
      startTime: null,
      endTime: null,
      recurrenceKind: null,
      days: [],
      sourceText: 'source',
      ...overrides,
    }],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  });
}

describe('redundant hard availability normalization', () => {
  it('removes a hard available declaration that cannot narrow scheduler placement', () => {
    const result = normalizeRedundantHardAvailabilityV5(responseWithAvailability());
    expect(JSON.parse(result.rawResponse).availabilityDeclarations).toEqual([]);
    expect(result.repairs).toEqual([
      'redundant-hard-availability-removed:availability-1',
    ]);
  });

  it('does not remove an explicit clock window', () => {
    const rawResponse = responseWithAvailability({ startTime: '17:00', endTime: '20:00' });
    expect(normalizeRedundantHardAvailabilityV5(rawResponse)).toEqual({
      rawResponse,
      repairs: [],
    });
  });

  it('does not remove a named time period', () => {
    const rawResponse = responseWithAvailability({ namedTimePeriod: 'evening' });
    expect(normalizeRedundantHardAvailabilityV5(rawResponse)).toEqual({
      rawResponse,
      repairs: [],
    });
  });

  it('does not remove unavailable or soft preference declarations', () => {
    for (const overrides of [
      { kind: 'unavailable' },
      { constraintLevel: 'soft' },
      { recurrenceKind: 'weekdays' },
    ]) {
      const rawResponse = responseWithAvailability(overrides);
      expect(normalizeRedundantHardAvailabilityV5(rawResponse)).toEqual({
        rawResponse,
        repairs: [],
      });
    }
  });
});
