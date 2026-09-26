import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import {
  WEEKLY_PLANNING_MAX_SAFE_NUMERIC_VALUE_V5,
  isWeeklyPlanningSafePositiveNumberV5,
  validateWeeklyPlanningSemanticNumericSafetyV5,
} from '../semantic/weeklyPlanningNumericSafetyV5';

describe('Issue #152 numeric mutation boundary', () => {
  it('accepts the maximum safe positive value but rejects zero, negatives, and the next integer', () => {
    expect(isWeeklyPlanningSafePositiveNumberV5(1)).toBe(true);
    expect(isWeeklyPlanningSafePositiveNumberV5(WEEKLY_PLANNING_MAX_SAFE_NUMERIC_VALUE_V5))
      .toBe(true);
    expect(isWeeklyPlanningSafePositiveNumberV5(0)).toBe(false);
    expect(isWeeklyPlanningSafePositiveNumberV5(-1)).toBe(false);
    expect(isWeeklyPlanningSafePositiveNumberV5(
      WEEKLY_PLANNING_MAX_SAFE_NUMERIC_VALUE_V5 + 1,
    )).toBe(false);
  });

  it('checks component workloads at the same numeric boundary as task workloads', () => {
    const document: WeeklyPlanningSemanticDocumentV5 = {
      schemaVersion: 'weekly-planning-semantic-v5',
      planningIntent: 'update_plan',
      planningWindow: null,
      tasks: [{
        localId: 'task-1',
        existingPublicId: null,
        decompositionStatus: 'decomposed',
        category: 'study',
        title: '数学',
        study: {
          purpose: 'practice',
          contextLabel: null,
          components: [{
            localId: 'component-1',
            existingPublicId: null,
            parentLocalId: null,
            role: 'material',
            label: '問題集',
            workloads: [{
              localId: 'workload-1',
              quantityRole: 'target',
              amount: 0,
              unitCode: 'problem',
              unitLabel: '問',
              rangeStart: null,
              rangeEnd: null,
              perOccurrence: false,
              periodExpression: null,
              sourceText: '0問',
            }],
            durableContextSignals: [],
            sourceText: '問題集',
          }],
        },
        workloads: [],
        effortEstimates: [],
        temporalConstraints: [],
        recurrence: [],
        durableContextSignals: [],
        sourceText: '数学',
      }],
      relations: [],
      availabilityDeclarations: [],
      constraintSourceRequests: [],
      userContextFacts: [],
      uncertainties: [],
      corrections: [],
      decisions: [],
    };

    expect(validateWeeklyPlanningSemanticNumericSafetyV5(document)).toContain(
      'document.tasks[0].study.components[0].workloads[0].amount',
    );
  });
});
