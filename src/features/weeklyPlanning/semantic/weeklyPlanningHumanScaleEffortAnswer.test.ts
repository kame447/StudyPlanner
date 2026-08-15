import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  applyWeeklyPlanningStableV5ContextualAnswer,
} from './weeklyPlanningStableV5ContextualAnswer';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type SemanticWorkloadUnitCodeV5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

function graphFor(
  unitCode: SemanticWorkloadUnitCodeV5,
  amount: number,
  quantityRole: 'target' | 'completed' = 'target',
): WeeklyPlanningFactGraphV5 {
  const graph = createEmptyWeeklyPlanningFactGraphV5();
  const source = {
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    semanticLocalId: 'workload-1',
    sourceText: 'workload',
    origin: 'user' as const,
  };
  return {
    ...graph,
    revision: 1,
    tasks: [{
      id: 'task-1',
      category: 'study',
      title: '学習',
      source,
      createdRevision: 1,
    }],
    workloads: [{
      id: 'workload-1',
      taskId: 'task-1',
      componentId: null,
      quantityRole,
      amount,
      unitCode,
      unitLabel: unitCode === 'page' ? 'ページ' : unitCode === 'problem' ? '問' : '語',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      source,
      createdRevision: 1,
    }],
    factLifecycles: [{
      factId: 'workload-1',
      status: 'active',
      createdRevision: 1,
      terminalRevision: null,
      supersededByFactId: null,
    }],
  };
}

function durationAnswer(minutes: number): WeeklyPlanningSemanticDocumentV5 {
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
        minutes,
        unitCode: null,
        precision: 'approximate',
        sourceText: `${minutes}分くらい`,
      }],
      temporalConstraints: [],
      recurrence: [],
      sourceText: `${minutes}分くらい`,
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function answer(
  unitCode: SemanticWorkloadUnitCodeV5,
  amount: number,
  minutes: number,
  quantityRole: 'target' | 'completed' = 'target',
) {
  return applyWeeklyPlanningStableV5ContextualAnswer({
    graph: graphFor(unitCode, amount, quantityRole),
    document: durationAnswer(minutes),
    pendingQuestion: {
      actionId: 'question-1',
      questionCode: 'missing_effort_estimate',
      targetFactId: 'workload-1',
      graphRevision: 1,
    },
    conversationId: 'conversation-1',
    turnId: 'turn-2',
    expectedRevision: 1,
    userText: `${minutes}分くらい`,
  });
}

describe('Stable V5 human-scale contextual effort answers', () => {
  it('stores page and problem answers as duration per unit', () => {
    expect(answer('page', 30, 5)?.graph.effortEstimates[0]).toMatchObject({
      kind: 'duration_per_unit',
      minutes: 5,
      unitCode: 'page',
    });
    expect(answer('problem', 80, 8)?.graph.effortEstimates[0]).toMatchObject({
      kind: 'duration_per_unit',
      minutes: 8,
      unitCode: 'problem',
    });
  });

  it('stores a completed page answer as the total observed duration', () => {
    expect(answer('page', 30, 90, 'completed')?.graph.effortEstimates[0]).toMatchObject({
      targetFactId: 'workload-1',
      kind: 'total_duration',
      minutes: 90,
      unitCode: null,
    });
  });

  it('stores vocabulary duration as one-session evidence without treating it as total scope time', () => {
    expect(answer('word', 80, 35)?.graph.effortEstimates[0]).toMatchObject({
      kind: 'session_duration',
      minutes: 35,
      unitCode: 'word',
    });
    expect(answer('word', 220, 20)?.graph.effortEstimates[0]).toMatchObject({
      kind: 'session_duration',
      minutes: 20,
      unitCode: 'word',
    });
  });
});
