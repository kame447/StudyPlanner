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
  applyWeeklyPlanningStableV5ContextualAnswer,
  inferWeeklyPlanningStableV5ContextualQuestionCode,
} from './weeklyPlanningStableV5ContextualAnswer';

const factSource = {
  conversationId: 'conversation-1',
  turnId: 'turn-1',
  semanticLocalId: 'source-1',
  sourceText: '問題集を10ページ進める',
  origin: 'user' as const,
};

function graph(quantityRole: 'target' | 'declared'): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    appliedTurnKeys: ['conversation-1:turn-1'],
    tasks: [{
      id: 'task-1',
      category: 'study',
      title: '問題集',
      source: factSource,
      createdRevision: 1,
    }],
    workloads: [{
      id: 'workload-1',
      taskId: 'task-1',
      componentId: null,
      quantityRole,
      amount: 10,
      unitCode: 'page',
      unitLabel: 'ページ',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      source: factSource,
      createdRevision: 1,
    }],
    factLifecycles: [
      {
        factId: 'task-1',
        status: 'active',
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      },
      {
        factId: 'workload-1',
        status: 'active',
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      },
    ],
  };
}

function answerDocument(params: {
  minutes?: number;
  quantityRole?: 'target';
}): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [{
      localId: 'answer-task',
      category: 'study',
      title: '直前の質問対象',
      study: null,
      workloads: params.quantityRole
        ? [{
            localId: 'answer-workload',
            quantityRole: params.quantityRole,
            amount: 10,
            unitCode: 'page',
            unitLabel: 'ページ',
            rangeStart: null,
            rangeEnd: null,
            perOccurrence: false,
            periodExpression: null,
            sourceText: '今回進めたい量です',
          }]
        : [],
      effortEstimates: params.minutes
        ? [{
            localId: 'answer-effort',
            targetLocalId: 'answer-task',
            kind: 'total_duration',
            minutes: params.minutes,
            unitCode: null,
            precision: 'exact',
            sourceText: '3時間です',
          }]
        : [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: params.minutes ? '3時間です' : '今回進めたい量です',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

describe('Stable V5 contextual answers', () => {
  it('binds a short duration to the single unresolved workload', () => {
    const result = applyWeeklyPlanningStableV5ContextualAnswer({
      graph: graph('target'),
      document: answerDocument({ minutes: 180 }),
      questionCode: 'missing_effort_estimate',
      conversationId: 'conversation-1',
      turnId: 'turn-2',
      userText: '3時間です',
    });

    expect(result?.graph.effortEstimates).toEqual([
      expect.objectContaining({
        taskId: 'task-1',
        targetFactId: 'task-1',
        minutes: 180,
      }),
    ]);
  });

  it('supersedes the unresolved workload for a quantity-role answer', () => {
    const result = applyWeeklyPlanningStableV5ContextualAnswer({
      graph: graph('declared'),
      document: answerDocument({ quantityRole: 'target' }),
      questionCode: 'quantity_role_unresolved',
      conversationId: 'conversation-1',
      turnId: 'turn-2',
      userText: '今回進めたい量です',
    });

    expect(result?.graph.workloads.at(-1)).toMatchObject({
      taskId: 'task-1',
      quantityRole: 'target',
      amount: 10,
    });
    expect(result?.graph.factLifecycles).toEqual(expect.arrayContaining([
      expect.objectContaining({ factId: 'workload-1', status: 'superseded' }),
    ]));
  });

  it('infers only supported previous questions', () => {
    expect(inferWeeklyPlanningStableV5ContextualQuestionCode({
      lastAssistantMessage: '合計でどれくらい時間がかかりますか？',
    })).toBe('missing_effort_estimate');
    expect(inferWeeklyPlanningStableV5ContextualQuestionCode({
      lastAssistantMessage: '今回進めたい量ですか？',
    })).toBe('quantity_role_unresolved');
    expect(inferWeeklyPlanningStableV5ContextualQuestionCode({
      lastAssistantMessage: 'いつから始めますか？',
    })).toBeNull();
  });
});
