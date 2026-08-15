import { describe, expect, it } from 'vitest';
import {
  validateWeeklyPlanningSemanticResponseV5,
} from './weeklyPlanningSemanticResponseValidationV5';

function baseResponse() {
  return {
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    corrections: [],
    decisions: [],
    planningIntent: 'create_plan',
    planningWindow: {
      end: '2026-08-23',
      kind: 'absolute',
      localId: 'planning-window-1',
      sourceText: '来週',
      start: '2026-08-17',
      value: '2026-08-17/2026-08-23',
    },
    relations: [],
    schemaVersion: 'weekly-planning-semantic-v5',
    tasks: [{
      category: 'study',
      decompositionStatus: 'atomic',
      durableContextSignals: [],
      effortEstimates: [],
      existingPublicId: null,
      localId: 'task-1',
      recurrence: [],
      sourceText: '英単語220語を覚えたい',
      study: {
        activityKind: 'memorization_retrieval',
        components: [],
        contextLabel: null,
        purpose: 'self_study',
      },
      temporalConstraints: [],
      title: '英単語を覚える',
      workloads: [{
        amount: 220,
        localId: 'workload-1',
        perOccurrence: false,
        periodExpression: null,
        quantityRole: 'target',
        rangeEnd: null,
        rangeStart: null,
        sourceText: '英単語220語',
        unitCode: 'word',
        unitLabel: '語',
      }],
    }],
    uncertainties: [],
    userContextFacts: [],
  };
}

describe('Stable V5 absence versus positive availability validation', () => {
  it('preserves no-additional-constraint meaning instead of rewriting it as availability', () => {
    const response = baseResponse();
    response.availabilityDeclarations = [{
      constraintLevel: 'hard',
      dateExpression: null,
      days: [],
      endTime: null,
      kind: 'no_additional_constraint',
      localId: 'availability-absence-1',
      namedTimePeriod: null,
      recurrenceKind: null,
      sourceText: '今週は特に予定ない',
      startTime: null,
    }];

    const result = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(response), {});
    expect(result.errors).toEqual([]);
    expect(result.document?.availabilityDeclarations).toEqual([
      expect.objectContaining({
        kind: 'no_additional_constraint',
        sourceText: '今週は特に予定ない',
      }),
    ]);
    expect(result.algorithmicRepairs).not.toEqual(
      expect.arrayContaining([expect.stringContaining('availability-removed')]),
    );
    expect(result.document?.tasks[0]?.study?.activityKind).toBe('memorization_retrieval');
  });

  it('preserves a concrete positive availability window as positive availability', () => {
    const response = baseResponse();
    response.availabilityDeclarations = [{
      constraintLevel: 'hard',
      dateExpression: 'weekday:monday',
      days: [],
      endTime: '20:00',
      kind: 'available',
      localId: 'availability-positive-1',
      namedTimePeriod: null,
      recurrenceKind: null,
      sourceText: '月曜は18時から20時なら空いてる',
      startTime: '18:00',
    }];

    const result = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(response), {});
    expect(result.errors).toEqual([]);
    expect(result.document?.availabilityDeclarations).toEqual([
      expect.objectContaining({
        kind: 'available',
        startTime: '18:00',
        endTime: '20:00',
      }),
    ]);
  });
});
