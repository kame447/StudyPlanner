import { describe, expect, it } from 'vitest';
import { createGroundedContextualAnswerDocumentV5 } from './weeklyPlanningContextualAnswerDocumentV5';
import { createGroundedCreationAuthorizationDocumentV5 } from './weeklyPlanningCreationAuthorizationV5';
import {
  directWorkCoverageErrorsV5,
  extractDirectWorkExpectationsV5,
} from './weeklyPlanningDirectWorkCoverageV5';
import { normalizeTaskBoundariesV5 } from './weeklyPlanningTaskBoundaryContractV5';
import {
  normalizePlanningWindowCanonicalV5,
  relativeWindowSourceExpectationV5,
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
  it('does not synthesize creation authorization from user wording', () => {
    expect(createGroundedCreationAuthorizationDocumentV5('この条件で予定を作って'))
      .toBeNull();
  });

  it('does not synthesize a contextual answer document from a short reply', () => {
    expect(createGroundedContextualAnswerDocumentV5({
      userText: '3時間です',
      publicStateSummary: {
        graphRevision: 4,
        pendingQuestion: {
          questionCode: 'missing_effort_estimate',
          targetFactId: 'workload:40-problems',
          graphRevision: 4,
        },
      },
    })).toBeNull();
  });

  it('does not re-extract work meaning from user text', () => {
    expect(extractDirectWorkExpectationsV5('英語を40問、数学を20問進める')).toEqual([]);
    expect(directWorkCoverageErrorsV5({
      userText: '英語を40問、数学を20問進める',
      document: emptyDocument(),
    })).toEqual([]);
  });

  it('does not rename or split AI-selected task boundaries', () => {
    const document = emptyDocument();
    document.tasks.push({
      localId: 'task-1',
      category: 'study',
      title: '英語',
      study: {
        purpose: 'practice',
        contextLabel: null,
        components: [
          {
            localId: 'component-1',
            parentLocalId: null,
            role: 'material',
            label: '英語',
            workloads: [],
            sourceText: '英語',
          },
          {
            localId: 'component-2',
            parentLocalId: null,
            role: 'material',
            label: '数学',
            workloads: [],
            sourceText: '数学',
          },
        ],
      },
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '英語と数学',
    });

    const normalized = normalizeTaskBoundariesV5(document);
    expect(normalized.document).toBe(document);
    expect(normalized.repairs).toEqual([]);
  });

  it('does not reinterpret relative dates from sourceText', () => {
    const window = {
      localId: 'window-1',
      kind: 'relative_day' as const,
      value: 'today',
      start: null,
      end: null,
      sourceText: '明日',
    };
    expect(relativeWindowSourceExpectationV5(window.sourceText)).toBeNull();
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
