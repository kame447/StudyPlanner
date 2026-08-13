import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import { applyWeeklyPlanningStableV5ContextualAnswer } from './weeklyPlanningStableV5ContextualAnswer';

function graphFor(unitCode: 'page' | 'problem' | 'word', amount: number): WeeklyPlanningFactGraphV5 {
  const task = {
    id: 'task-1',
    category: 'study' as const,
    title: unitCode === 'word' ? '英単語' : '数学',
    source: {
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      semanticLocalId: 'task-1',
      sourceText: 'work',
      origin: 'user' as const,
    },
    createdRevision: 1,
  };
  const workload = {
    id: 'workload-1',
    taskId: task.id,
    componentId: null,
    quantityRole: 'target' as const,
    amount,
    unitCode,
    unitLabel: unitCode === 'page' ? 'ページ' : unitCode === 'problem' ? '問' : '語',
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

function answer(unitCode: 'page' | 'problem' | 'word', amount: number, minutes: number) {
  return applyWeeklyPlanningStableV5ContextualAnswer({
    graph: graphFor(unitCode, amount),
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

  it('stores up-to-100 vocabulary answers as the whole-batch duration', () => {
    expect(answer('word', 80, 35)?.graph.effortEstimates[0]).toMatchObject({
      kind: 'total_duration',
      minutes: 35,
      unitCode: null,
    });
  });

  it('stores large-vocabulary answers as one learning-session duration', () => {
    expect(answer('word', 150, 30)?.graph.effortEstimates[0]).toMatchObject({
      kind: 'session_duration',
      minutes: 30,
      unitCode: 'word',
    });
  });
});