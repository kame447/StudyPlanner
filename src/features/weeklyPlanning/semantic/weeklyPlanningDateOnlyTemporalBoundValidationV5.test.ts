import { describe, expect, it } from 'vitest';
import { WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5 } from './weeklyPlanningSemanticDocumentV5';
import { validateWeeklyPlanningSemanticValueV5 } from './weeklyPlanningSemanticBaseValidatorV5';

function documentWithBound(kind: 'earliest_start' | 'latest_end') {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task-1',
      category: 'non_study',
      title: '予定',
      study: null,
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [{
        localId: `constraint-${kind}`,
        targetLocalId: 'task-1',
        kind,
        constraintLevel: 'hard',
        dateExpression: '2026-09-10',
        namedTimePeriod: null,
        startTime: null,
        endTime: null,
        precision: 'exact',
        sourceText: kind === 'earliest_start' ? '9月10日から' : '9月10日まで',
      }],
      recurrence: [],
      sourceText: '予定',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

describe('Stable V5 date-only temporal bounds', () => {
  it('accepts a date-only earliest_start without inventing a clock time', () => {
    expect(validateWeeklyPlanningSemanticValueV5(documentWithBound('earliest_start')).errors)
      .toEqual([]);
  });

  it('accepts a date-only latest_end without inventing a clock time', () => {
    expect(validateWeeklyPlanningSemanticValueV5(documentWithBound('latest_end')).errors)
      .toEqual([]);
  });
});
