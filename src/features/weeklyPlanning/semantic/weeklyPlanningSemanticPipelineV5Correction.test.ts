import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
  type WeeklyPlanningSemanticNormalizerInputV5,
  type WeeklyPlanningSemanticNormalizerResultV5,
  type WeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';
import {
  createWeeklyPlanningSemanticPipelineV5,
} from './weeklyPlanningSemanticPipelineV5';

function acceptedNormalizer(
  document: WeeklyPlanningSemanticDocumentV5,
  capture?: { input: WeeklyPlanningSemanticNormalizerInputV5 | null },
): WeeklyPlanningSemanticNormalizerV5 {
  return {
    async normalize(
      input: WeeklyPlanningSemanticNormalizerInputV5,
    ): Promise<WeeklyPlanningSemanticNormalizerResultV5> {
      if (capture) capture.input = structuredClone(input);
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

function initialDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: {
      localId: 'window-1',
      kind: 'absolute',
      value: '2026-07-24',
      start: '2026-07-24',
      end: '2026-07-24',
      sourceText: '7月24日',
    },
    tasks: [{
      localId: 'task-old',
      category: 'study',
      title: '数学',
      study: {
        purpose: 'self_study',
        contextLabel: null,
        components: [],
      },
      workloads: [{
        localId: 'workload-old',
        quantityRole: 'target',
        amount: 3,
        unitCode: 'hour',
        unitLabel: '時間',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText: '数学を3時間',
      }],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '数学を3時間',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function correctionDocument(
  targetPublicId: string,
): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task-new',
      category: 'study',
      title: '数学',
      study: {
        purpose: 'self_study',
        contextLabel: null,
        components: [],
      },
      workloads: [{
        localId: 'workload-new',
        quantityRole: 'target',
        amount: 1,
        unitCode: 'hour',
        unitLabel: '時間',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText: '数学を1時間',
      }],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '数学を1時間',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [{
      localId: 'correction-1',
      target: {
        kind: 'workload',
        publicId: targetPublicId,
        localId: null,
        mention: '数学3時間',
      },
      operation: 'replace',
      replacementLocalId: 'workload-new',
      sourceText: '数学は3時間ではなく1時間',
    }],
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

function activeIds(graph: {
  factLifecycles: Array<{ factId: string; status: string }>;
}): Set<string> {
  return new Set(
    graph.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId),
  );
}

describe('Stable V5 semantic pipeline correction application', () => {
  it('omits prompt-only correction instructions while the graph has no active correction target', async () => {
    const capture: { input: WeeklyPlanningSemanticNormalizerInputV5 | null } = {
      input: null,
    };
    await createWeeklyPlanningSemanticPipelineV5(
      acceptedNormalizer(initialDocument(), capture),
    ).run({
      conversationId: 'conversation-contract',
      turnId: 'turn-1',
      expectedRevision: 0,
      userText: '数学の時間を訂正したい',
      publicStateSummary: {
        tasks: [{ publicId: 'stale-task-id', title: '古い表示' }],
        correctionContract: { stale: true },
      },
      schedulerContext,
    });

    expect(capture.input?.publicStateSummary).toMatchObject({
      graphRevision: 0,
      tasks: [],
      effortEstimates: [],
      temporalConstraints: [],
      recurrences: [],
    });
    expect(capture.input?.publicStateSummary).not.toHaveProperty('correctionContract');
    expect(capture.input?.publicStateSummary).not.toEqual(
      expect.objectContaining({
        tasks: [{ publicId: 'stale-task-id', title: '古い表示' }],
      }),
    );
  });

  it('exposes exact active facts without attaching a natural-language correction contract', async () => {
    const first = await createWeeklyPlanningSemanticPipelineV5(
      acceptedNormalizer(initialDocument()),
    ).run({
      conversationId: 'conversation-correction',
      turnId: 'turn-1',
      expectedRevision: 0,
      userText: '7月24日に数学を3時間やりたい',
      schedulerContext,
    });
    expect(first.canonicalization?.status).toBe('applied');
    const oldWorkloadId = first.canonicalization?.localToFactId['workload-old'];
    if (!oldWorkloadId) throw new Error('old workload id missing');

    const correctionCapture: {
      input: WeeklyPlanningSemanticNormalizerInputV5 | null;
    } = { input: null };
    const second = await createWeeklyPlanningSemanticPipelineV5(
      acceptedNormalizer(correctionDocument(oldWorkloadId), correctionCapture),
    ).run({
      graph: first.graph,
      conversationId: 'conversation-correction',
      turnId: 'turn-2',
      expectedRevision: first.graph.revision,
      userText: '訂正です。数学は3時間ではなく1時間にしてください',
      schedulerContext,
    });

    expect(correctionCapture.input?.publicStateSummary).toMatchObject({
      graphRevision: first.graph.revision,
      workloads: [
        expect.objectContaining({
          publicId: oldWorkloadId,
          amount: 3,
          unitCode: 'hour',
        }),
      ],
    });
    expect(correctionCapture.input?.publicStateSummary).not.toHaveProperty('correctionContract');
    expect(second.status).toBe('scheduler_ready');
    expect(second.canonicalization?.status).toBe('applied');
    const active = activeIds(second.graph);
    const activeTasks = second.graph.tasks.filter((fact) => active.has(fact.id));
    const activeWorkloads = second.graph.workloads.filter((fact) => active.has(fact.id));
    expect(activeTasks).toHaveLength(1);
    expect(activeWorkloads).toEqual([
      expect.objectContaining({ amount: 1, unitCode: 'hour' }),
    ]);
    expect(second.scheduler?.input?.movableWorkItems).toEqual([
      expect.objectContaining({ estimatedMinutes: 60 }),
    ]);
    expect(second.canonicalization?.diff?.superseded).toContainEqual({
      kind: 'workload',
      id: oldWorkloadId,
    });
  });

  it('rolls an unresolved correction turn back before scheduler compilation', async () => {
    const first = await createWeeklyPlanningSemanticPipelineV5(
      acceptedNormalizer(initialDocument()),
    ).run({
      conversationId: 'conversation-reject',
      turnId: 'turn-1',
      expectedRevision: 0,
      userText: '7月24日に数学を3時間やりたい',
      schedulerContext,
    });

    const rejected = await createWeeklyPlanningSemanticPipelineV5(
      acceptedNormalizer(correctionDocument('unknown-workload-id')),
    ).run({
      graph: first.graph,
      conversationId: 'conversation-reject',
      turnId: 'turn-2',
      expectedRevision: first.graph.revision,
      userText: '訂正です。数学は1時間です',
      schedulerContext,
    });

    expect(rejected.status).toBe('canonicalization_rejected');
    expect(rejected.graph).toBe(first.graph);
    expect(rejected.scheduler).toBeNull();
    expect(rejected.canonicalization?.errors).toEqual([
      expect.stringContaining('correction-application:correction-target-kind-mismatch'),
    ]);
    expect(first.graph.tasks).toHaveLength(1);
  });
});
