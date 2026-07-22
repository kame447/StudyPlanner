import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
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
  WEEKLY_PLANNING_SEMANTIC_PIPELINE_VERSION_V5,
  createWeeklyPlanningSemanticPipelineV5,
} from './weeklyPlanningSemanticPipelineV5';

function document(): WeeklyPlanningSemanticDocumentV5 {
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
            amount: 30,
            unitCode: 'minute',
            unitLabel: '分',
            rangeStart: null,
            rangeEnd: null,
            perOccurrence: false,
            periodExpression: null,
            sourceText: '英単語を30分進める',
          },
        ],
        effortEstimates: [],
        temporalConstraints: [],
        recurrence: [],
        sourceText: '英単語を30分進める',
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

function acceptedNormalizer(
  acceptedDocument: WeeklyPlanningSemanticDocumentV5 = document(),
): WeeklyPlanningSemanticNormalizerV5 {
  return {
    async normalize(): Promise<WeeklyPlanningSemanticNormalizerResultV5> {
      return {
        status: 'accepted',
        document: acceptedDocument,
        diagnostics: {
          schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
          jsonSchemaName: 'weekly_planning_semantic_document_v5',
          normalizerVersion: WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
          attemptCount: 1,
          repairAttempted: false,
          requestBytes: [512],
          responseLengths: [1024],
          latencyMs: 10,
          validationErrors: [],
          providerError: null,
        },
      };
    },
  };
}

function providerFailureNormalizer(): WeeklyPlanningSemanticNormalizerV5 {
  return {
    async normalize(): Promise<WeeklyPlanningSemanticNormalizerResultV5> {
      return {
        status: 'provider_failure',
        document: null,
        diagnostics: {
          schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
          jsonSchemaName: 'weekly_planning_semantic_document_v5',
          normalizerVersion: WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
          attemptCount: 1,
          repairAttempted: false,
          requestBytes: [512],
          responseLengths: [],
          latencyMs: 10,
          validationErrors: [],
          providerError: 'provider unavailable',
        },
      };
    },
  };
}

const schedulerContext = {
  ownerId: 'owner-1',
  currentDate: '2026-07-22',
  planningStartDate: '2026-07-24',
  planningEndDate: '2026-07-24',
  timeZone: 'Asia/Tokyo',
};

describe('Stable V5 semantic pipeline', () => {
  it('runs normalization, direct canonicalization, and scheduler compilation', async () => {
    const originalGraph = createEmptyWeeklyPlanningFactGraphV5();
    const result = await createWeeklyPlanningSemanticPipelineV5(
      acceptedNormalizer(),
    ).run({
      graph: originalGraph,
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      expectedRevision: 0,
      userText: '24日に英単語を30分進めたい',
      schedulerContext,
    });

    expect(result).toMatchObject({
      pipelineVersion: WEEKLY_PLANNING_SEMANTIC_PIPELINE_VERSION_V5,
      status: 'scheduler_ready',
      canonicalization: { status: 'applied' },
      scheduler: { status: 'ready' },
    });
    expect(result.graph.revision).toBe(1);
    expect(result.scheduler?.input?.movableWorkItems).toEqual([
      expect.objectContaining({
        workloadFactId: result.canonicalization?.localToFactId['workload-1'],
        estimatedMinutes: 30,
      }),
    ]);
    expect(originalGraph.revision).toBe(0);
    expect(originalGraph.tasks).toEqual([]);
  });

  it('returns the original graph without canonicalization on provider failure', async () => {
    const graph = createEmptyWeeklyPlanningFactGraphV5();
    const result = await createWeeklyPlanningSemanticPipelineV5(
      providerFailureNormalizer(),
    ).run({
      graph,
      conversationId: 'conversation-1',
      turnId: 'turn-provider-failure',
      expectedRevision: 0,
      userText: '予定を立てたい',
      schedulerContext,
    });

    expect(result.status).toBe('provider_failure');
    expect(result.graph).toBe(graph);
    expect(result.canonicalization).toBeNull();
    expect(result.scheduler).toBeNull();
  });

  it('keeps duplicate turns idempotent while compiling the existing graph', async () => {
    const pipeline = createWeeklyPlanningSemanticPipelineV5(acceptedNormalizer());
    const first = await pipeline.run({
      conversationId: 'conversation-1',
      turnId: 'turn-duplicate',
      expectedRevision: 0,
      userText: '24日に英単語を30分進めたい',
      schedulerContext,
    });
    const second = await pipeline.run({
      graph: first.graph,
      conversationId: 'conversation-1',
      turnId: 'turn-duplicate',
      expectedRevision: 1,
      userText: '24日に英単語を30分進めたい',
      schedulerContext,
    });

    expect(first.status).toBe('scheduler_ready');
    expect(second.status).toBe('duplicate_turn');
    expect(second.canonicalization?.status).toBe('duplicate');
    expect(second.graph).toBe(first.graph);
    expect(second.scheduler?.status).toBe('ready');
  });
});
