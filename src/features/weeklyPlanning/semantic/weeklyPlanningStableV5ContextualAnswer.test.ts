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
} from './weeklyPlanningStableV5ContextualAnswer';

const factSource = {
  conversationId: 'conversation-1',
  turnId: 'turn-1',
  semanticLocalId: 'source-1',
  sourceText: '問題集を10ページ進める',
  origin: 'user' as const,
};

function graph(params: {
  quantityRole: 'target' | 'declared';
  includeSecond?: boolean;
}): WeeklyPlanningFactGraphV5 {
  const tasks = [{
    id: 'task-1',
    category: 'study' as const,
    title: '問題集',
    source: factSource,
    createdRevision: 1,
  }];
  const workloads = [{
    id: 'workload-1',
    taskId: 'task-1',
    componentId: null,
    quantityRole: params.quantityRole,
    amount: 10,
    unitCode: 'page' as const,
    unitLabel: 'ページ',
    rangeStart: null,
    rangeEnd: null,
    perOccurrence: false,
    periodExpression: null,
    source: factSource,
    createdRevision: 1,
  }];
  if (params.includeSecond) {
    tasks.push({
      id: 'task-2',
      category: 'study',
      title: '英単語',
      source: { ...factSource, semanticLocalId: 'source-2', sourceText: '英単語を80語' },
      createdRevision: 1,
    });
    workloads.push({
      id: 'workload-2',
      taskId: 'task-2',
      componentId: null,
      quantityRole: params.quantityRole,
      amount: 80,
      unitCode: 'word',
      unitLabel: '語',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      source: { ...factSource, semanticLocalId: 'source-2', sourceText: '英単語を80語' },
      createdRevision: 1,
    });
  }
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    appliedTurnKeys: ['conversation-1:turn-1'],
    tasks,
    workloads,
    factLifecycles: [
      ...tasks.map((task) => ({
        factId: task.id,
        status: 'active' as const,
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      })),
      ...workloads.map((workload) => ({
        factId: workload.id,
        status: 'active' as const,
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      })),
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

function pendingQuestion(params: {
  code: 'missing_effort_estimate' | 'quantity_role_unresolved';
  targetFactId?: string | null;
  graphRevision?: number;
}) {
  return {
    actionId: 'stable-v5:question-1',
    questionCode: params.code,
    targetFactId: params.targetFactId === undefined ? 'workload-1' : params.targetFactId,
    graphRevision: params.graphRevision ?? 1,
  };
}

describe('Stable V5 contextual answers', () => {
  it('binds a short duration to the exact workload named by pending question', () => {
    const result = applyWeeklyPlanningStableV5ContextualAnswer({
      graph: graph({ quantityRole: 'target' }),
      document: answerDocument({ minutes: 180 }),
      pendingQuestion: pendingQuestion({ code: 'missing_effort_estimate' }),
      conversationId: 'conversation-1',
      turnId: 'turn-2',
      expectedRevision: 1,
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

  it('supersedes the exact unresolved workload for a quantity-role answer', () => {
    const result = applyWeeklyPlanningStableV5ContextualAnswer({
      graph: graph({ quantityRole: 'declared' }),
      document: answerDocument({ quantityRole: 'target' }),
      pendingQuestion: pendingQuestion({ code: 'quantity_role_unresolved' }),
      conversationId: 'conversation-1',
      turnId: 'turn-2',
      expectedRevision: 1,
      userText: '今回進めたい量です',
    });

    const workloads = result?.graph.workloads ?? [];
    expect(workloads[workloads.length - 1]).toMatchObject({
      taskId: 'task-1',
      quantityRole: 'target',
      amount: 10,
    });
    expect(result?.graph.factLifecycles).toEqual(expect.arrayContaining([
      expect.objectContaining({ factId: 'workload-1', status: 'superseded' }),
    ]));
  });

  it('does not require a singleton unresolved set and never updates a different workload', () => {
    const result = applyWeeklyPlanningStableV5ContextualAnswer({
      graph: graph({ quantityRole: 'declared', includeSecond: true }),
      document: answerDocument({ quantityRole: 'target' }),
      pendingQuestion: pendingQuestion({
        code: 'quantity_role_unresolved',
        targetFactId: 'workload-2',
      }),
      conversationId: 'conversation-1',
      turnId: 'turn-2',
      expectedRevision: 1,
      userText: '今回進めたい量です',
    });

    const last = result?.graph.workloads.at(-1);
    expect(last).toMatchObject({
      taskId: 'task-2',
      amount: 80,
      unitCode: 'word',
      quantityRole: 'target',
    });
    expect(result?.graph.factLifecycles).toEqual(expect.arrayContaining([
      expect.objectContaining({ factId: 'workload-1', status: 'active' }),
      expect.objectContaining({ factId: 'workload-2', status: 'superseded' }),
    ]));
  });

  it('rejects stale, missing, inactive, or non-minimal pending-question answers', () => {
    const base = {
      graph: graph({ quantityRole: 'target' }),
      document: answerDocument({ minutes: 180 }),
      conversationId: 'conversation-1',
      turnId: 'turn-2',
      expectedRevision: 1,
      userText: '3時間です',
    };

    expect(applyWeeklyPlanningStableV5ContextualAnswer({
      ...base,
      pendingQuestion: pendingQuestion({
        code: 'missing_effort_estimate',
        graphRevision: 0,
      }),
    })).toBeNull();
    expect(applyWeeklyPlanningStableV5ContextualAnswer({
      ...base,
      pendingQuestion: pendingQuestion({
        code: 'missing_effort_estimate',
        targetFactId: null,
      }),
    })).toBeNull();
    expect(applyWeeklyPlanningStableV5ContextualAnswer({
      ...base,
      pendingQuestion: pendingQuestion({
        code: 'missing_effort_estimate',
        targetFactId: 'unknown-workload',
      }),
    })).toBeNull();
    expect(applyWeeklyPlanningStableV5ContextualAnswer({
      ...base,
      pendingQuestion: pendingQuestion({ code: 'missing_effort_estimate' }),
      userText: '別件ですが、新しく数学を毎日3時間やる予定も追加してください',
    })).toBeNull();
  });
});
