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

function source(semanticLocalId: string) {
  return {
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    semanticLocalId,
    sourceText: '問題集を10ページ進める',
    origin: 'user' as const,
  };
}

function graph(quantityRole: 'target' | 'declared'): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    appliedTurnKeys: ['conversation-1:turn-1'],
    tasks: [{
      id: 'task-1',
      category: 'study',
      title: '問題集',
      source: source('task-local-1'),
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
      source: source('workload-local-1'),
      createdRevision: 1,
    }],
    factLifecycles: [
      {
        factId: 'task-1',
        kind: 'task',
        status: 'active',
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      },
      {
        factId: 'workload-1',
        kind: 'workload',
        status: 'active',
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      },
    ],
  };
}

function effortAnswer(): WeeklyPlanningSemanticDocumentV5 {
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
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function roleAnswer(): WeeklyPlanningSemanticDocumentV5 {
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
        amount: 10,
        unitCode: 'page',
        unitLabel: 'ページ',
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

describe('Stable V5 contextual answers', () => {
  it('binds a short total-duration answer to the single unresolved workload', () => {
    const result = applyWeeklyPlanningStableV5ContextualAnswer({
      graph: graph('target'),
      document: effortAnswer(),
      questionCode: 'missing_effort_estimate',
      conversationId: 'conversation-1',
      turnId: 'turn-2',
      userText: '3時間です',
    });

    expect(result?.status).toBe('applied');
    expect(result?.graph.revision).toBe(2);
    expect(result?.graph.effortEstimates).toEqual([
      expect.objectContaining({
        taskId: 'task-1',
        targetFactId: 'task-1',
        kind: 'total_duration',
        minutes: 180,
      }),
    ]);
  });

  it('supersedes an unresolved workload when the short answer declares its role', () => {
    const result = applyWeeklyPlanningStableV5ContextualAnswer({
      graph: graph('declared'),
      document: roleAnswer(),
      questionCode: 'quantity_role_unresolved',
      conversationId: 'conversation-1',
      turnId: 'turn-2',
      userText: '今回進めたい量です',
    });

    expect(result?.status).toBe('applied');
    expect(result?.graph.workloads).toHaveLength(2);
    expect(result?.graph.workloads[1]).toMatchObject({
      taskId: 'task-1',
      quantityRole: 'target',
      amount: 10,
      unitCode: 'page',
    });
    expect(result?.graph.factLifecycles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        factId: 'workload-1',
        status: 'superseded',
        terminalRevision: 2,
      }),
    ]));
  });

  it('infers only the supported deterministic follow-up question codes', () => {
    expect(inferWeeklyPlanningStableV5ContextualQuestionCode({
      lastAssistantMessage: '指定した量だけ進めるのに、合計でどれくらい時間がかかりますか？',
    })).toBe('missing_effort_estimate');
    expect(inferWeeklyPlanningStableV5ContextualQuestionCode({
      lastAssistantMessage: 'この量は今回進めたい量ですか？',
    })).toBe('quantity_role_unresolved');
    expect(inferWeeklyPlanningStableV5ContextualQuestionCode({
      lastAssistantMessage: 'いつから始めますか？',
    })).toBeNull();
  });
});
