import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  createWeeklyPlanningSemanticPipelineV5,
} from './weeklyPlanningSemanticPipelineV5';
import type {
  WeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';

const emptyCollections = {
  relations: [],
  availabilityDeclarations: [],
  constraintSourceRequests: [],
  uncertainties: [],
  corrections: [],
  decisions: [],
} as const;

function taskDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'discuss',
    planningWindow: {
      localId: 'window-1',
      kind: 'absolute',
      value: '2026-07-27/2026-08-02',
      start: '2026-07-27',
      end: '2026-08-02',
      sourceText: '来週',
    },
    tasks: [{
      localId: 'task-1',
      category: 'study',
      title: '問題集',
      study: {
        purpose: 'self_study',
        contextLabel: null,
        components: [],
      },
      workloads: [{
        localId: 'workload-1',
        quantityRole: 'target',
        amount: 10,
        unitCode: 'page',
        unitLabel: 'ページ',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText: '問題集を10ページ進めたい',
      }],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '問題集を10ページ進めたい',
    }],
    ...emptyCollections,
  };
}

function durationAnswer(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [{
      localId: 'answer-task',
      category: 'study',
      title: '直前の質問対象',
      study: null,
      workloads: [],
      effortEstimates: [{
        localId: 'answer-effort',
        targetLocalId: 'answer-task',
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
    ...emptyCollections,
  };
}

function authorizationDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [],
    ...emptyCollections,
  };
}

function normalizer(sequence: WeeklyPlanningSemanticDocumentV5[]): WeeklyPlanningSemanticNormalizerV5 {
  let index = 0;
  return {
    async normalize() {
      const document = sequence[index++];
      if (!document) throw new Error('normalizer sequence exhausted');
      return {
        status: 'accepted',
        document,
        diagnostics: {
          schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
          jsonSchemaName: 'weekly_planning_semantic_document_v5',
          normalizerVersion: 'weekly-planning-semantic-normalizer-v5',
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

const schedulerContext = {
  ownerId: 'owner-1',
  currentDate: '2026-07-27',
  planningStartDate: '2026-07-27',
  planningEndDate: '2026-08-02',
  timeZone: 'Asia/Tokyo',
};

describe('Stable V5 multi-turn pipeline', () => {
  it('keeps one task through task, short duration, and creation authorization turns', async () => {
    const pipeline = createWeeklyPlanningSemanticPipelineV5(normalizer([
      taskDocument(),
      durationAnswer(),
      authorizationDocument(),
    ]));
    const first = await pipeline.run({
      graph: createEmptyWeeklyPlanningFactGraphV5(),
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      expectedRevision: 0,
      userText: '来週、問題集を10ページ進めたい',
      schedulerContext,
    });
    expect(first.status).toBe('scheduler_needs_resolution');
    expect(first.graph.tasks).toHaveLength(1);

    const second = await pipeline.run({
      graph: first.graph,
      conversationId: 'conversation-1',
      turnId: 'turn-2',
      expectedRevision: 1,
      userText: '3時間です',
      publicStateSummary: {
        lastAssistantMessage: '問題集をこの量だけ進めるのに、合計でどれくらい時間がかかりますか？',
      },
      schedulerContext,
    });
    expect(second.status).toBe('scheduler_ready');
    expect(second.graph.tasks).toHaveLength(1);
    expect(second.graph.workloads).toHaveLength(1);
    expect(second.graph.effortEstimates).toHaveLength(1);

    const third = await pipeline.run({
      graph: second.graph,
      conversationId: 'conversation-1',
      turnId: 'turn-3',
      expectedRevision: 2,
      userText: 'この条件で予定を作って',
      schedulerContext,
    });
    expect(third.status).toBe('scheduler_ready');
    expect(third.graph.revision).toBe(3);
    expect(third.graph.tasks).toHaveLength(1);
    expect(third.graph.workloads).toHaveLength(1);
    expect(third.graph.effortEstimates).toHaveLength(1);
  });
});
