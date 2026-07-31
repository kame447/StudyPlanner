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
  WEEKLY_PLANNING_SEMANTIC_NORMALIZER_VERSION_V5,
  type WeeklyPlanningSemanticNormalizerV5,
} from './weeklyPlanningSemanticNormalizerV5';
import {
  createWeeklyPlanningSemanticPipelineV5,
} from './weeklyPlanningSemanticPipelineV5';

const source = {
  conversationId: 'conversation-1',
  turnId: 'turn-1',
  semanticLocalId: 'source-1',
  sourceText: '問題集10ページと英単語80語',
  origin: 'user' as const,
};

function existingGraph(): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    appliedTurnKeys: ['conversation-1:turn-1'],
    planningWindows: [{
      id: 'window-1',
      kind: 'absolute',
      value: '2026-07-31',
      start: '2026-07-31',
      end: '2026-07-31',
      source,
      createdRevision: 1,
    }],
    tasks: [
      { id: 'task-1', category: 'study', title: '問題集', source, createdRevision: 1 },
      { id: 'task-2', category: 'study', title: '英単語', source, createdRevision: 1 },
    ],
    workloads: [
      {
        id: 'workload-1',
        taskId: 'task-1',
        componentId: null,
        quantityRole: 'declared',
        amount: 10,
        unitCode: 'page',
        unitLabel: 'ページ',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        source,
        createdRevision: 1,
      },
      {
        id: 'workload-2',
        taskId: 'task-2',
        componentId: null,
        quantityRole: 'declared',
        amount: 80,
        unitCode: 'word',
        unitLabel: '語',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        source,
        createdRevision: 1,
      },
    ],
    factLifecycles: [
      ...['window-1', 'task-1', 'task-2', 'workload-1', 'workload-2'].map((factId) => ({
        factId,
        status: 'active' as const,
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      })),
    ],
  };
}

function answerDocument(): WeeklyPlanningSemanticDocumentV5 {
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
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function normalizer(): WeeklyPlanningSemanticNormalizerV5 {
  return {
    async normalize() {
      return {
        status: 'accepted' as const,
        document: answerDocument(),
        diagnostics: {
          schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
          jsonSchemaName: 'weekly_planning_semantic_document_v5' as const,
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

const schedulerContext = {
  ownerId: 'owner-1',
  currentDate: '2026-07-31',
  planningStartDate: '2026-07-31',
  planningEndDate: '2026-07-31',
  timeZone: 'Asia/Tokyo',
};

describe('Stable V5 machine pending question pipeline', () => {
  it('binds to the exact target even when the previous rendered sentence is freely paraphrased', async () => {
    const result = await createWeeklyPlanningSemanticPipelineV5(normalizer()).run({
      graph: existingGraph(),
      conversationId: 'conversation-1',
      turnId: 'turn-2',
      expectedRevision: 1,
      userText: '今回進めたい量です',
      recentConversation: [{
        role: 'assistant',
        content: 'どちらの扱いにするかだけ確認させてください。',
      }],
      publicStateSummary: {
        lastAssistantMessage: 'この文面はquestion codeを含まない',
        pendingQuestion: {
          actionId: 'stable-v5:turn-1:quantity_role_unresolved',
          questionCode: 'quantity_role_unresolved',
          targetFactId: 'workload-2',
          graphRevision: 1,
        },
      },
      schedulerContext,
    });

    expect(result.canonicalization?.status).toBe('applied');
    expect(result.graph.workloads.at(-1)).toMatchObject({
      taskId: 'task-2',
      amount: 80,
      unitCode: 'word',
      quantityRole: 'target',
    });
    expect(result.graph.factLifecycles).toEqual(expect.arrayContaining([
      expect.objectContaining({ factId: 'workload-1', status: 'active' }),
      expect.objectContaining({ factId: 'workload-2', status: 'superseded' }),
    ]));
  });

  it('does not bind a short reply when no machine pending question exists', async () => {
    const result = await createWeeklyPlanningSemanticPipelineV5(normalizer()).run({
      graph: existingGraph(),
      conversationId: 'conversation-1',
      turnId: 'turn-2-no-pending',
      expectedRevision: 1,
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

    expect(result.canonicalization).toMatchObject({
      status: 'applied',
      diff: {
        superseded: [],
        removed: [],
      },
    });
    expect(result.canonicalization?.localToFactId.answerTask).toBeUndefined();
    expect(result.canonicalization?.localToFactId['answer-task']).toBeTruthy();
    expect(result.canonicalization?.localToFactId['answer-workload']).not.toBe('workload-2');
    expect(result.graph.tasks).toHaveLength(3);
    expect(result.graph.factLifecycles).toEqual(expect.arrayContaining([
      expect.objectContaining({ factId: 'workload-2', status: 'active' }),
    ]));
    expect(result.graph.appliedLifecycleOperationKeys).not.toContain(
      'contextual:conversation-1:turn-2-no-pending',
    );
  });
});