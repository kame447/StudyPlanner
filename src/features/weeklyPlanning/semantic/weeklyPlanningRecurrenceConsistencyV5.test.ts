import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { validateWeeklyPlanningRecurrenceConsistencyV5 } from './weeklyPlanningRecurrenceConsistencyV5';

function document(params: {
  periodExpression: string | null;
  recurrenceKind?: 'daily' | 'weekly' | 'weekdays' | 'weekends' | 'times_per_week' | 'custom';
}): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [{
      localId: 'task-1',
      existingPublicId: null,
      category: 'study',
      title: '学習',
      study: null,
      workloads: [{
        localId: 'workload-1',
        quantityRole: 'target',
        amount: 1,
        unitCode: 'hour',
        unitLabel: '時間',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: true,
        periodExpression: params.periodExpression,
        sourceText: '学習する',
      }],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: params.recurrenceKind ? [{
        localId: 'recurrence-1',
        targetLocalId: 'task-1',
        kind: params.recurrenceKind,
        count: params.recurrenceKind === 'times_per_week' ? 3 : null,
        days: [],
        sourceText: '繰り返す',
      }] : [],
      durableContextSignals: [],
      sourceText: '学習する',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

describe('Stable V5 recurrence consistency generalization', () => {
  it('requires weekly recurrence when periodExpression is canonical weekly', () => {
    expect(validateWeeklyPlanningRecurrenceConsistencyV5(document({
      periodExpression: 'weekly',
    }))).toEqual([
      'document.tasks[0].workloads[0]:explicit-recurrence-missing:expected=weekly:target=task-1',
    ]);
  });

  it('accepts times_per_week when the matching recurrence exists', () => {
    expect(validateWeeklyPlanningRecurrenceConsistencyV5(document({
      periodExpression: 'times_per_week',
      recurrenceKind: 'times_per_week',
    }))).toEqual([]);
  });

  it('accepts canonical custom recurrence form with custom recurrence', () => {
    expect(validateWeeklyPlanningRecurrenceConsistencyV5(document({
      periodExpression: 'custom:隔日',
      recurrenceKind: 'custom',
    }))).toEqual([]);
  });

  it('does not turn a one-time period expression into recurrence', () => {
    expect(validateWeeklyPlanningRecurrenceConsistencyV5(document({
      periodExpression: 'next_week',
    }))).toEqual([]);
  });
});
