import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
  type WeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';
import {
  createWeeklyPlanningSemanticDialoguePipelineV5,
} from './weeklyPlanningSemanticDialoguePipelineV5';

function normalizer(
  document: WeeklyPlanningSemanticDocumentV5,
): WeeklyPlanningSemanticNormalizerV5 {
  return {
    async normalize() {
      return {
        status: 'accepted',
        document,
        diagnostics: {
          schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
          jsonSchemaName: 'weekly_planning_semantic_document_v5',
          normalizerVersion: WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
          attemptCount: 1,
          repairAttempted: false,
          requestBytes: [100],
          responseLengths: [200],
          latencyMs: 1,
          validationErrors: [],
          providerError: null,
        },
      };
    },
  };
}

function documentWithWorkload(params: {
  amount: number;
  unitCode: 'minute' | 'problem';
}): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: {
      localId: 'window-1',
      kind: 'absolute',
      value: '2026-07-24',
      start: '2026-07-24',
      end: '2026-07-24',
      sourceText: '24日の計画',
    },
    tasks: [
      {
        localId: 'task-1',
        category: 'study',
        title: '英単語',
        study: {
          purpose: 'self_study',
          contextLabel: null,
          components: [],
        },
        workloads: [
          {
            localId: 'workload-1',
            quantityRole: 'target',
            amount: params.amount,
            unitCode: params.unitCode,
            unitLabel: params.unitCode === 'minute' ? '分' : '問',
            rangeStart: null,
            rangeEnd: null,
            perOccurrence: false,
            periodExpression: null,
            sourceText: '英単語を進める',
          },
        ],
        effortEstimates: [],
        temporalConstraints: [],
        recurrence: [],
        sourceText: '英単語を進める',
      },
    ],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

const schedulerContext = {
  ownerId: 'owner-1',
  currentDate: '2026-07-22',
  planningStartDate: '2026-07-24',
  planningEndDate: '2026-07-24',
  timeZone: 'Asia/Tokyo',
};

describe('Stable V5 semantic dialogue pipeline', () => {
  it('returns ready_for_preview only after the scheduler input is ready', async () => {
    const result = await createWeeklyPlanningSemanticDialoguePipelineV5(
      normalizer(documentWithWorkload({ amount: 30, unitCode: 'minute' })),
    ).run({
      conversationId: 'conversation-1',
      turnId: 'turn-ready',
      expectedRevision: 0,
      userText: '英単語を30分進めたい',
      schedulerContext,
    });

    expect(result.pipelineVersion).toBe(
      'weekly-planning-semantic-dialogue-pipeline-v5',
    );
    expect(result.semantic.status).toBe('scheduler_ready');
    expect(result.dialogue).toMatchObject({
      status: 'ready_for_preview',
      question: null,
      previewEligible: true,
    });
  });

  it('returns one deterministic question for unresolved effort', async () => {
    const result = await createWeeklyPlanningSemanticDialoguePipelineV5(
      normalizer(documentWithWorkload({ amount: 20, unitCode: 'problem' })),
    ).run({
      conversationId: 'conversation-1',
      turnId: 'turn-question',
      expectedRevision: 0,
      userText: '英単語を20問進めたい',
      schedulerContext,
    });

    expect(result.semantic.status).toBe('scheduler_needs_resolution');
    expect(result.dialogue).toEqual({
      policyVersion: 'weekly-planning-stable-dialogue-policy-v5',
      status: 'ask_question',
      question: {
        domain: 'work_item',
        code: 'missing_effort_estimate',
        factId: result.semantic.canonicalization?.localToFactId['workload-1'],
        details: {},
      },
      previewEligible: false,
    });
  });
});
