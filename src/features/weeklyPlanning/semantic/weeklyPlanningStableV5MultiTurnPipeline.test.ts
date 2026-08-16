import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
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

function emptyCollections(): Pick<
  WeeklyPlanningSemanticDocumentV5,
  | 'relations'
  | 'availabilityDeclarations'
  | 'constraintSourceRequests'
  | 'uncertainties'
  | 'corrections'
  | 'decisions'
> {
  return {
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

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
    ...emptyCollections(),
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
    ...emptyCollections(),
  };
}

function quantityRoleAnswer(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [{
      localId: 'answer-task',
      category: 'study',
      title: '直前の質問対象',
      study: null,
      workloads: [{
        localId: 'answer-workload',
        quantityRole: 'target',
        amount: 80,
        unitCode: 'word',
        unitLabel: '語',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText: '今回進めたい量です',
      }],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '今回進めたい量です',
    }],
    ...emptyCollections(),
  };
}

function authorizationDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [],
    ...emptyCollections(),
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

function declaredWorkloadGraph(): WeeklyPlanningFactGraphV5 {
  const source = {
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    semanticLocalId: 'source-1',
    sourceText: '問題集10ページと英単語80語',
    origin: 'user' as const,
  };
  const specifications = [
    { index: 1, title: '問題集', amount: 10, unitCode: 'page' as const, unitLabel: 'ページ' },
    { index: 2, title: '英単語', amount: 80, unitCode: 'word' as const, unitLabel: '語' },
  ];
  const tasks: WeeklyPlanningFactGraphV5['tasks'] = specifications.map((specification) => ({
    id: `task-${specification.index}`,
    category: 'study',
    title: specification.title,
    source: {
      ...source,
      semanticLocalId: `source-${specification.index}`,
      sourceText: specification.title,
    },
    createdRevision: 1,
  }));
  const workloads: WeeklyPlanningFactGraphV5['workloads'] = specifications.map(
    (specification) => ({
      id: `workload-${specification.index}`,
      taskId: `task-${specification.index}`,
      componentId: null,
      quantityRole: 'declared',
      amount: specification.amount,
      unitCode: specification.unitCode,
      unitLabel: specification.unitLabel,
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      source: {
        ...source,
        semanticLocalId: `source-${specification.index}`,
        sourceText: specification.title,
      },
      createdRevision: 1,
    }),
  );
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    appliedTurnKeys: ['conversation-1:turn-1'],
    tasks,
    workloads,
    factLifecycles: [...tasks, ...workloads].map((fact) => ({
      factId: fact.id,
      status: 'active' as const,
      createdRevision: 1,
      terminalRevision: null,
      supersededByFactId: null,
    })),
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

    const missingEffortIssue = first.scheduler?.issues.find(
      (issue) => issue.blocking && issue.code === 'missing_effort_estimate',
    );
    expect(missingEffortIssue?.factId).toBeTruthy();

    const second = await pipeline.run({
      graph: first.graph,
      conversationId: 'conversation-1',
      turnId: 'turn-2',
      expectedRevision: first.graph.revision,
      userText: '3時間です',
      publicStateSummary: {
        pendingQuestion: {
          actionId: 'stable-v5:turn-1:missing_effort_estimate',
          questionCode: 'missing_effort_estimate',
          targetFactId: missingEffortIssue?.factId ?? null,
          graphRevision: first.graph.revision,
          effortMeasurement: 'duration_per_unit',
        },
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
      expectedRevision: second.graph.revision,
      userText: 'この条件で予定を作って',
      schedulerContext,
    });
    expect(third.status).toBe('scheduler_ready');
    expect(third.graph.revision).toBe(second.graph.revision);
    expect(third.graph.appliedTurnKeys).toContain('conversation-1:turn-3');
    expect(third.graph.tasks).toHaveLength(1);
    expect(third.graph.workloads).toHaveLength(1);
    expect(third.graph.effortEstimates).toHaveLength(1);
  });

  it('does not bind a short reply from rendered text when machine pending state is absent', async () => {
    const initialGraph = declaredWorkloadGraph();
    const pipeline = createWeeklyPlanningSemanticPipelineV5(normalizer([
      quantityRoleAnswer(),
    ]));

    const result = await pipeline.run({
      graph: initialGraph,
      conversationId: 'conversation-1',
      turnId: 'turn-2-no-pending',
      expectedRevision: initialGraph.revision,
      userText: '今回進めたい量です',
      recentConversation: [{
        role: 'assistant',
        content: '今回進めたい量ですか？',
      }],
      publicStateSummary: {
        lastAssistantMessage: '今回進めたい量ですか？',
      },
      schedulerContext,
    });

    expect(result.status).toBe('canonicalization_rejected');
    expect(result.canonicalization).toMatchObject({ status: 'rejected', diff: null });
    expect(result.graph).toEqual(initialGraph);
    expect(result.graph.appliedLifecycleOperationKeys).not.toContain(
      'contextual:conversation-1:turn-2-no-pending',
    );
  });
});
