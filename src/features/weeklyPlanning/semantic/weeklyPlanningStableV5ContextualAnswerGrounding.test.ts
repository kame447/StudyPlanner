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

function graph(): WeeklyPlanningFactGraphV5 {
  const task = {
    id: 'task-english',
    category: 'study' as const,
    title: '英語',
    source: {
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      semanticLocalId: 'task-1',
      sourceText: '英語を2時間やりたいです',
      origin: 'user' as const,
    },
    createdRevision: 1,
  };
  const workload = {
    id: 'workload-english',
    taskId: task.id,
    componentId: null,
    quantityRole: 'declared' as const,
    amount: 2,
    unitCode: 'hour',
    unitLabel: '時間',
    rangeStart: null,
    rangeEnd: null,
    perOccurrence: false,
    periodExpression: null,
    source: task.source,
    createdRevision: 1,
  };
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    appliedTurnKeys: ['conversation-1:turn-1'],
    tasks: [task],
    workloads: [workload],
    factLifecycles: [task, workload].map((fact) => ({
      factId: fact.id,
      status: 'active' as const,
      createdRevision: 1,
      terminalRevision: null,
      supersededByFactId: null,
    })),
  };
}

function document(params: {
  sourceText: string;
  quantityRole?: 'target';
  effortMinutes?: number;
}): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [{
      localId: 'reply-task',
      category: 'study',
      title: '英語',
      study: null,
      workloads: params.quantityRole
        ? [{
            localId: 'reply-workload',
            quantityRole: params.quantityRole,
            amount: 2,
            unitCode: 'hour',
            unitLabel: '時間',
            rangeStart: null,
            rangeEnd: null,
            perOccurrence: false,
            periodExpression: null,
            sourceText: params.sourceText,
          }]
        : [],
      effortEstimates: params.effortMinutes
        ? [{
            localId: 'reply-effort',
            targetLocalId: 'reply-task',
            kind: 'total_duration',
            minutes: params.effortMinutes,
            unitCode: null,
            precision: 'exact',
            sourceText: params.sourceText,
          }]
        : [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: params.sourceText,
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function pendingQuestion(
  questionCode: 'quantity_role_unresolved' | 'missing_effort_estimate',
) {
  return {
    actionId: 'question-1',
    questionCode,
    targetFactId: 'workload-english',
    graphRevision: 1,
  };
}

describe('Stable V5 contextual answer source grounding', () => {
  it('binds a grounded quantity role even when model sourceText copied the prior turn', () => {
    const initial = graph();
    const result = applyWeeklyPlanningStableV5ContextualAnswer({
      graph: initial,
      document: document({
        sourceText: '英語を2時間やりたいです',
        quantityRole: 'target',
      }),
      pendingQuestion: pendingQuestion('quantity_role_unresolved'),
      conversationId: 'conversation-1',
      turnId: 'turn-2',
      expectedRevision: 1,
      userText: '今回進めたい量です',
    });

    expect(result?.status).toBe('applied');
    expect(result?.graph.tasks).toEqual(initial.tasks);
    expect(result?.diff?.superseded).toEqual([
      { kind: 'workload', id: 'workload-english' },
    ]);
    const workloads = result?.graph.workloads ?? [];
    expect(workloads[workloads.length - 1]).toMatchObject({
      taskId: 'task-english',
      quantityRole: 'target',
      amount: 2,
      unitCode: 'hour',
    });
  });

  it('does not trust a hallucinated duration for a non-time user unit', () => {
    const initial = graph();
    const result = applyWeeklyPlanningStableV5ContextualAnswer({
      graph: initial,
      document: document({ sourceText: '3ページです', effortMinutes: 180 }),
      pendingQuestion: pendingQuestion('missing_effort_estimate'),
      conversationId: 'conversation-1',
      turnId: 'turn-2',
      expectedRevision: 1,
      userText: '3ページです',
    });

    expect(result?.status).toBe('applied');
    expect(result?.graph.revision).toBe(2);
    expect(result?.graph.effortEstimates).toEqual([]);
    expect(result?.graph.tasks).toEqual(initial.tasks);
    expect(result?.graph.workloads).toEqual(initial.workloads);
  });

  it('does not apply a model duration that differs from the explicit user duration', () => {
    const result = applyWeeklyPlanningStableV5ContextualAnswer({
      graph: graph(),
      document: document({ sourceText: '2時間です', effortMinutes: 180 }),
      pendingQuestion: pendingQuestion('missing_effort_estimate'),
      conversationId: 'conversation-1',
      turnId: 'turn-2',
      expectedRevision: 1,
      userText: '2時間です',
    });

    expect(result?.graph.effortEstimates).toEqual([]);
  });

  it('applies one model duration only when it matches the explicit user duration', () => {
    const result = applyWeeklyPlanningStableV5ContextualAnswer({
      graph: graph(),
      document: document({ sourceText: '2時間です', effortMinutes: 120 }),
      pendingQuestion: pendingQuestion('missing_effort_estimate'),
      conversationId: 'conversation-1',
      turnId: 'turn-2',
      expectedRevision: 1,
      userText: '2時間です',
    });

    expect(result?.graph.effortEstimates).toEqual([
      expect.objectContaining({
        taskId: 'task-english',
        minutes: 120,
        kind: 'total_duration',
      }),
    ]);
  });
});
