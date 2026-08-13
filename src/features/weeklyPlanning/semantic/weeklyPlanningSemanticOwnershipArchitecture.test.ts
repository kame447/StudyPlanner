import { describe, expect, it } from 'vitest';
import {
  normalizePlanningWindowCanonicalV5,
} from './weeklyPlanningPlanningWindowCanonicalContractV5';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import { validateWeeklyPlanningSemanticValueV5 } from './weeklyPlanningSemanticValidatorV5';

function emptyDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

describe('Stable V5 semantic ownership architecture', () => {
  it('does not reinterpret relative dates from sourceText', () => {
    const window = {
      localId: 'window-1',
      kind: 'relative_day' as const,
      value: 'today',
      start: null,
      end: null,
      sourceText: '明日',
    };
    expect(normalizePlanningWindowCanonicalV5(window)).toEqual({
      window,
      repairs: [],
    });
  });

  it('accepts an effort estimate that targets the quantified workload', () => {
    const document = emptyDocument();
    document.tasks.push({
      localId: 'task-english',
      category: 'study',
      title: '英語ワーク',
      study: {
        purpose: 'homework',
        contextLabel: null,
        components: [],
      },
      workloads: [
        {
          localId: 'workload-40-problems',
          quantityRole: 'target',
          amount: 40,
          unitCode: 'problem',
          unitLabel: '問',
          rangeStart: null,
          rangeEnd: null,
          perOccurrence: false,
          periodExpression: null,
          sourceText: '40問',
        },
      ],
      effortEstimates: [
        {
          localId: 'effort-3-hours',
          targetLocalId: 'workload-40-problems',
          kind: 'total_duration',
          minutes: 180,
          unitCode: null,
          precision: 'exact',
          sourceText: '40問に3時間',
        },
      ],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '英語ワーク40問に3時間',
    });

    const result = validateWeeklyPlanningSemanticValueV5(document);
    expect(result.errors).not.toContain('document.tasks[0].effortEstimates[0].targetLocalId');
    expect(result.document).toEqual(document);
  });
});
