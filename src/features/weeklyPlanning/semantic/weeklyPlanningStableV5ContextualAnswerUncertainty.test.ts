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
  const source = {
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    semanticLocalId: 'task-1',
    sourceText: '数学の問題を40問進めたいです',
    origin: 'user' as const,
  };
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    appliedTurnKeys: ['conversation-1:turn-1'],
    tasks: [{
      id: 'task-math',
      category: 'study',
      title: '数学の問題を進める',
      source,
      createdRevision: 1,
    }],
    workloads: [{
      id: 'workload-math',
      taskId: 'task-math',
      componentId: null,
      quantityRole: 'declared',
      amount: 40,
      unitCode: 'problem',
      unitLabel: '問',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      source,
      createdRevision: 1,
    }],
    factLifecycles: [
      {
        factId: 'task-math',
        status: 'active',
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      },
      {
        factId: 'workload-math',
        status: 'active',
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      },
    ],
  };
}

function document(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'unknown',
    planningWindow: null,
    tasks: [{
      localId: 'task-repeated',
      category: 'study',
      title: '数学の問題を進める',
      study: null,
      workloads: [{
        localId: 'workload-repeated',
        quantityRole: 'target',
        amount: 40,
        unitCode: 'problem',
        unitLabel: '問',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText: '今回進めたい量です',
      }],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '数学40問',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [{
      localId: 'uncertainty-repeated',
      targetLocalId: 'workload-repeated',
      field: 'quantityRole',
      reason: 'The model remained uncertain despite the explicit current answer.',
      sourceText: '今回進めたい量です',
    }],
    corrections: [],
    decisions: [],
  };
}

describe('Stable V5 contextual answer uncertainty precedence', () => {
  it('uses a uniquely grounded current answer instead of duplicating model uncertainty facts', () => {
    const initial = graph();
    const result = applyWeeklyPlanningStableV5ContextualAnswer({
      graph: initial,
      document: document(),
      pendingQuestion: {
        actionId: 'question-1',
        questionCode: 'quantity_role_unresolved',
        targetFactId: 'workload-math',
        graphRevision: 1,
      },
      conversationId: 'conversation-1',
      turnId: 'turn-2',
      expectedRevision: 1,
      userText: '今回進めたい量です',
    });

    expect(result?.status).toBe('applied');
    expect(result?.graph.tasks).toEqual(initial.tasks);
    expect(result?.graph.uncertainties).toEqual([]);
    expect(result?.graph.workloads).toHaveLength(2);
    expect(result?.graph.workloads[1]).toMatchObject({
      taskId: 'task-math',
      quantityRole: 'target',
      amount: 40,
      unitCode: 'problem',
    });
    expect(result?.diff?.superseded).toEqual([
      { kind: 'workload', id: 'workload-math' },
    ]);
  });
});
