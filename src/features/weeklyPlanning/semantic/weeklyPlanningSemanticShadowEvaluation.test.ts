import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION,
  type WeeklyPlanningSemanticDocument,
} from './weeklyPlanningSemanticDocument';
import type {
  WeeklyPlanningSemanticNormalizer,
  WeeklyPlanningSemanticNormalizerResult,
} from './weeklyPlanningSemanticNormalizer';
import { evaluateWeeklyPlanningSemanticShadow } from './weeklyPlanningSemanticShadowEvaluation';

function acceptedResult(): WeeklyPlanningSemanticNormalizerResult {
  const document: WeeklyPlanningSemanticDocument = {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION,
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [
      {
        localId: 'task-study',
        category: 'study',
        title: 'TOEIC',
        study: {
          purpose: 'exam',
          contextLabel: 'TOEIC',
          components: [
            {
              localId: 'component-listening',
              parentLocalId: null,
              role: 'skill',
              label: 'リスニング',
              workloads: [
                {
                  localId: 'workload-problems',
                  quantityRole: 'target',
                  amount: 20,
                  unitCode: 'problem',
                  unitLabel: '問',
                  rangeStart: null,
                  rangeEnd: null,
                  perOccurrence: false,
                  periodExpression: null,
                  sourceText: 'リスニング問題を20問',
                },
              ],
              sourceText: 'リスニング問題',
            },
          ],
        },
        workloads: [],
        effortEstimates: [],
        temporalConstraints: [],
        recurrence: [],
        sourceText: 'TOEICのリスニング問題を20問解きたい',
      },
      {
        localId: 'task-work',
        category: 'non_study',
        title: '仕事の資料',
        study: null,
        workloads: [],
        effortEstimates: [],
        temporalConstraints: [],
        recurrence: [],
        sourceText: '仕事の資料を仕上げる',
      },
    ],
    relations: [
      {
        localId: 'relation-work-before-toeic',
        kind: 'before',
        fromLocalId: 'task-work',
        toLocalId: 'task-study',
        sourceText: '仕事の資料を仕上げた後',
      },
    ],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
  return {
    status: 'accepted',
    document,
    diagnostics: {
      schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION,
      attemptCount: 1,
      repairAttempted: false,
      requestBytes: [1024],
      responseLengths: [2048],
      latencyMs: 321,
      validationErrors: [],
      providerError: null,
    },
  };
}

function createNormalizer(result: WeeklyPlanningSemanticNormalizerResult): WeeklyPlanningSemanticNormalizer {
  return {
    async normalize() {
      return result;
    },
  };
}

describe('weekly planning semantic shadow evaluation', () => {
  it('returns aggregate metrics without exposing semantic content', async () => {
    const report = await evaluateWeeklyPlanningSemanticShadow({
      normalizer: createNormalizer(acceptedResult()),
      input: {
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        userText: '仕事の資料を仕上げた後、TOEICを進めたい',
      },
    });

    expect(report).toMatchObject({
      outcome: 'accepted',
      attemptCount: 1,
      requestBytes: [1024],
      responseLengths: [2048],
      semanticCounts: {
        taskCount: 2,
        studyTaskCount: 1,
        nonStudyTaskCount: 1,
        componentCount: 1,
        workloadCount: 1,
        relationCount: 1,
      },
    });
    expect(JSON.stringify(report)).not.toContain('TOEIC');
    expect(JSON.stringify(report)).not.toContain('仕事の資料');
  });

  it('does not receive or mutate production state', async () => {
    const productionState = Object.freeze({ revision: 7, acceptedFacts: ['existing'] });
    const before = JSON.stringify(productionState);

    await evaluateWeeklyPlanningSemanticShadow({
      normalizer: createNormalizer(acceptedResult()),
      input: {
        conversationId: 'conversation-1',
        turnId: 'turn-2',
        userText: 'TOEICを進めたい',
        publicStateSummary: { revision: productionState.revision },
      },
    });

    expect(JSON.stringify(productionState)).toBe(before);
  });

  it('reports provider failure with zero semantic counts', async () => {
    const result: WeeklyPlanningSemanticNormalizerResult = {
      status: 'provider_failure',
      document: null,
      diagnostics: {
        schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION,
        attemptCount: 1,
        repairAttempted: false,
        requestBytes: [800],
        responseLengths: [],
        latencyMs: 100,
        validationErrors: [],
        providerError: 'provider unavailable',
      },
    };

    const report = await evaluateWeeklyPlanningSemanticShadow({
      normalizer: createNormalizer(result),
      input: {
        conversationId: 'conversation-2',
        turnId: 'turn-1',
        userText: '来週の予定を立てたい',
      },
    });

    expect(report.outcome).toBe('provider_failure');
    expect(report.providerError).toBe('provider unavailable');
    expect(Object.values(report.semanticCounts).every((value) => value === 0)).toBe(true);
  });
});
