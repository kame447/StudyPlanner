import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import type {
  WeeklyPlanningSemanticNormalizerResultV5,
  WeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';
import {
  WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
} from './weeklyPlanningSemanticNormalizerV5';
import {
  evaluateWeeklyPlanningSemanticShadowV5,
} from './weeklyPlanningSemanticShadowEvaluationV5';

function document(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
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
        temporalConstraints: [
          {
            localId: 'date-rule-1',
            targetLocalId: 'task-study',
            kind: 'allowed_date',
            constraintLevel: 'hard',
            dateExpression: '2026-07-24',
            namedTimePeriod: null,
            startTime: null,
            endTime: null,
            precision: 'exact',
            sourceText: '24日に行う',
          },
        ],
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
    availabilityDeclarations: [
      {
        localId: 'availability-1',
        kind: 'unavailable',
        dateExpression: '2026-07-23',
        namedTimePeriod: null,
        startTime: null,
        endTime: null,
        recurrenceKind: null,
        days: [],
        constraintLevel: 'hard',
        sourceText: '23日は休む',
      },
    ],
    constraintSourceRequests: [
      {
        localId: 'source-1',
        kind: 'calendar',
        selector: 'active',
        requestedAction: 'use',
        sourceText: 'カレンダーを使う',
      },
    ],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function acceptedResult(
  acceptedDocument: WeeklyPlanningSemanticDocumentV5 = document(),
): WeeklyPlanningSemanticNormalizerResultV5 {
  return {
    status: 'accepted',
    document: acceptedDocument,
    diagnostics: {
      schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
      jsonSchemaName: 'weekly_planning_semantic_document_v5',
      normalizerVersion: WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
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

function createNormalizer(
  result: WeeklyPlanningSemanticNormalizerResultV5,
): WeeklyPlanningSemanticNormalizerV5 {
  return {
    async normalize() {
      return result;
    },
  };
}

describe('Stable V5 semantic shadow evaluation', () => {
  it('reports versioned semantic and direct canonicalization counts without content', async () => {
    const report = await evaluateWeeklyPlanningSemanticShadowV5({
      normalizer: createNormalizer(acceptedResult()),
      input: {
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        userText: '仕事の資料を仕上げた後、TOEICを進めたい',
      },
    });

    expect(report).toMatchObject({
      reportVersion: 'weekly-planning-semantic-shadow-report-v5',
      outcome: 'accepted',
      canonicalizationOutcome: 'applied',
      semanticSchemaVersion: 'weekly-planning-semantic-v5',
      jsonSchemaName: 'weekly_planning_semantic_document_v5',
      factGraphVersion: 'weekly-planning-fact-graph-v5',
      normalizerVersion: 'weekly-planning-semantic-normalizer-v5',
      validatorVersion: 'weekly-planning-semantic-validator-v5',
      canonicalizerVersion: 'weekly-planning-semantic-canonicalizer-v5',
      semanticCounts: {
        taskCount: 2,
        studyTaskCount: 1,
        nonStudyTaskCount: 1,
        componentCount: 1,
        workloadCount: 1,
        taskDateRuleCount: 1,
        relationCount: 1,
        availabilityDeclarationCount: 1,
        constraintSourceRequestCount: 1,
      },
      factCounts: {
        taskCount: 2,
        studyContextCount: 1,
        componentCount: 1,
        workloadCount: 1,
        taskDateRuleCount: 1,
        relationCount: 1,
        availabilityDeclarationCount: 1,
        constraintSourceRequestCount: 1,
      },
    });
    expect(JSON.stringify(report)).not.toContain('TOEIC');
    expect(JSON.stringify(report)).not.toContain('仕事の資料');
    expect(JSON.stringify(report)).not.toContain('カレンダーを使う');
  });

  it('does not receive or mutate production state', async () => {
    const productionState = Object.freeze({ revision: 7, acceptedFacts: ['existing'] });
    const before = JSON.stringify(productionState);

    await evaluateWeeklyPlanningSemanticShadowV5({
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

  it('reports provider failure without canonicalization or semantic facts', async () => {
    const result: WeeklyPlanningSemanticNormalizerResultV5 = {
      status: 'provider_failure',
      document: null,
      diagnostics: {
        schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
        jsonSchemaName: 'weekly_planning_semantic_document_v5',
        normalizerVersion: WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
        attemptCount: 1,
        repairAttempted: false,
        requestBytes: [800],
        responseLengths: [],
        latencyMs: 100,
        validationErrors: [],
        providerError: 'provider unavailable',
      },
    };

    const report = await evaluateWeeklyPlanningSemanticShadowV5({
      normalizer: createNormalizer(result),
      input: {
        conversationId: 'conversation-2',
        turnId: 'turn-1',
        userText: '来週の予定を立てたい',
      },
    });

    expect(report.outcome).toBe('provider_failure');
    expect(report.canonicalizationOutcome).toBe('not_run');
    expect(report.providerError).toBe('provider unavailable');
    expect(Object.values(report.semanticCounts).every((value) => value === 0)).toBe(true);
    expect(Object.values(report.factCounts).every((value) => value === 0)).toBe(true);
  });

  it('reports direct canonicalization rejection without mutating external state', async () => {
    const invalid = document();
    invalid.tasks[0].temporalConstraints[0] = {
      ...invalid.tasks[0].temporalConstraints[0],
      dateExpression: '2026-02-30',
    };

    const report = await evaluateWeeklyPlanningSemanticShadowV5({
      normalizer: createNormalizer(acceptedResult(invalid)),
      input: {
        conversationId: 'conversation-3',
        turnId: 'turn-1',
        userText: '不正な日付の例',
      },
    });

    expect(report.outcome).toBe('accepted');
    expect(report.canonicalizationOutcome).toBe('rejected');
    expect(report.canonicalizationErrors).toContain(
      'document.tasks[0].temporalConstraints[0].dateExpression:canonical-expression',
    );
    expect(Object.values(report.factCounts).every((value) => value === 0)).toBe(true);
  });
});
