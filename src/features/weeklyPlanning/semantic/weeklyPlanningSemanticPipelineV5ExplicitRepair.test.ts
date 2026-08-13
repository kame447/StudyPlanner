import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
  type WeeklyPlanningSemanticNormalizerResultV5,
  type WeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';
import {
  createWeeklyPlanningSemanticPipelineV5,
} from './weeklyPlanningSemanticPipelineV5';

function acceptedNormalizer(
  document: WeeklyPlanningSemanticDocumentV5,
): WeeklyPlanningSemanticNormalizerV5 {
  return {
    async normalize(): Promise<WeeklyPlanningSemanticNormalizerResultV5> {
      return {
        status: 'accepted',
        document,
        diagnostics: {
          schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
          jsonSchemaName: 'weekly_planning_semantic_document_v5',
          normalizerVersion: WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
          attemptCount: 1,
          repairAttempted: false,
          requestBytes: [1],
          responseLengths: [1],
          latencyMs: 1,
          validationErrors: [],
          providerError: null,
        },
      };
    },
  };
}

function baseDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: {
      localId: 'window-1',
      kind: 'absolute',
      value: '2026-08-10',
      start: '2026-08-10',
      end: '2026-08-16',
      sourceText: '来週',
    },
    tasks: [{
      localId: 'task-math',
      category: 'study',
      title: '数学',
      study: {
        purpose: 'self_study',
        contextLabel: null,
        components: [],
      },
      workloads: [{
        localId: 'workload-problems',
        quantityRole: 'target',
        amount: 40,
        unitCode: 'problem',
        unitLabel: '問',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText: '数学の問題を40問',
      }],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '数学の問題を40問進めたい',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function incompatiblePageReplyDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'reply-task-page',
      category: 'study',
      title: '数学',
      study: {
        purpose: 'self_study',
        contextLabel: null,
        components: [],
      },
      workloads: [{
        localId: 'reply-workload-page',
        quantityRole: 'unknown',
        amount: 3,
        unitCode: 'page',
        unitLabel: 'ページ',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText: '3ページです',
      }],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '3ページです',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function durationReplyDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'reply-task-duration',
      category: 'study',
      title: '数学',
      study: {
        purpose: 'self_study',
        contextLabel: null,
        components: [],
      },
      workloads: [{
        localId: 'reply-workload-problems',
        quantityRole: 'target',
        amount: 40,
        unitCode: 'problem',
        unitLabel: '問',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText: '数学の問題40問',
      }],
      effortEstimates: [{
        localId: 'reply-effort-duration',
        targetLocalId: 'reply-workload-problems',
        kind: 'total_duration',
        minutes: 180,
        unitCode: null,
        precision: 'exact',
        sourceText: '3時間です',
      }],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '3時間です',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

const schedulerContext = {
  ownerId: 'owner-explicit-repair',
  currentDate: '2026-08-03',
  planningStartDate: '2026-08-10',
  planningEndDate: '2026-08-16',
  timeZone: 'Asia/Tokyo',
};

function pendingQuestion(params: {
  targetFactId: string;
  graphRevision: number;
}) {
  return {
    pendingQuestion: {
      actionId: 'ask-effort',
      questionCode: 'missing_effort_estimate',
      targetFactId: params.targetFactId,
      graphRevision: params.graphRevision,
    },
  };
}

async function initialMathPipelineResult() {
  return createWeeklyPlanningSemanticPipelineV5(
    acceptedNormalizer(baseDocument()),
  ).run({
    conversationId: 'conversation-explicit-repair',
    turnId: 'turn-1',
    expectedRevision: 0,
    userText: '来週、数学の問題を40問進めたいです',
    schedulerContext,
  });
}

describe('Stable V5 semantic pipeline explicit repair', () => {
  it('keeps the target after an incompatible answer and applies the next AI-owned duration fact', async () => {
    const first = await initialMathPipelineResult();
    expect(first.status).toBe('scheduler_needs_resolution');
    const workloadId = first.canonicalization?.localToFactId['workload-problems'];
    if (!workloadId) throw new Error('workload id was not created');

    const wrong = await createWeeklyPlanningSemanticPipelineV5(
      acceptedNormalizer(incompatiblePageReplyDocument()),
    ).run({
      graph: first.graph,
      conversationId: 'conversation-explicit-repair',
      turnId: 'turn-2',
      expectedRevision: first.graph.revision,
      userText: '3ページです',
      publicStateSummary: pendingQuestion({
        targetFactId: workloadId,
        graphRevision: first.graph.revision,
      }),
      schedulerContext,
    });

    expect(wrong.status).toBe('scheduler_needs_resolution');
    expect(wrong.graph.revision).toBe(first.graph.revision);
    expect(wrong.graph.appliedTurnKeys).toContain(
      'conversation-explicit-repair:turn-2',
    );
    expect(wrong.graph.tasks).toEqual(first.graph.tasks);
    expect(wrong.graph.workloads).toEqual(first.graph.workloads);
    expect(wrong.graph.effortEstimates).toEqual([]);
    expect(wrong.graph.tasks.some((task) => task.title.includes('ページ'))).toBe(false);

    const repaired = await createWeeklyPlanningSemanticPipelineV5(
      acceptedNormalizer(durationReplyDocument()),
    ).run({
      graph: wrong.graph,
      conversationId: 'conversation-explicit-repair',
      turnId: 'turn-3',
      expectedRevision: wrong.graph.revision,
      userText: '3時間です',
      publicStateSummary: pendingQuestion({
        targetFactId: workloadId,
        graphRevision: wrong.graph.revision,
      }),
      schedulerContext,
    });

    expect(repaired.status).toBe('scheduler_ready');
    expect(repaired.graph.tasks).toEqual(first.graph.tasks);
    expect(repaired.graph.workloads).toEqual(first.graph.workloads);
    expect(repaired.graph.effortEstimates).toEqual([
      expect.objectContaining({
        taskId: first.graph.tasks[0]?.id,
        targetFactId: workloadId,
        minutes: 180,
        kind: 'duration_per_unit',
        unitCode: 'problem',
      }),
    ]);

    const workItems = repaired.scheduler?.input?.movableWorkItems ?? [];
    expect(workItems).toHaveLength(6);
    expect(workItems.reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0)).toBe(7200);
    expect(workItems.reduce((sum, item) => sum + item.quantity.amount, 0)).toBe(40);
    expect(workItems.map((item) => item.quantity.amount)).toEqual([7, 7, 7, 7, 6, 6]);
    expect(workItems.every((item) => item.estimatedMinutes === 1200)).toBe(true);
  });

  it('rejects a short reply atomically when the pending target disappeared', async () => {
    const first = await initialMathPipelineResult();
    expect(first.status).toBe('scheduler_needs_resolution');

    const rejected = await createWeeklyPlanningSemanticPipelineV5(
      acceptedNormalizer(durationReplyDocument()),
    ).run({
      graph: first.graph,
      conversationId: 'conversation-explicit-repair',
      turnId: 'turn-stale-target',
      expectedRevision: first.graph.revision,
      userText: '3時間です',
      publicStateSummary: pendingQuestion({
        targetFactId: 'missing-workload',
        graphRevision: first.graph.revision,
      }),
      schedulerContext,
    });

    expect(rejected.status).toBe('canonicalization_rejected');
    expect(rejected.graph).toEqual(first.graph);
    expect(rejected.graph.revision).toBe(first.graph.revision);
    expect(rejected.graph.appliedTurnKeys).not.toContain(
      'conversation-explicit-repair:turn-stale-target',
    );
    expect(rejected.graph.tasks).toEqual(first.graph.tasks);
    expect(rejected.graph.workloads).toEqual(first.graph.workloads);
    expect(rejected.graph.effortEstimates).toEqual([]);
    expect(rejected.canonicalization?.errors).toEqual([
      'contextual-answer-target-unavailable:missing_effort_estimate:missing-workload',
    ]);
  });
});
