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

const source = {
  conversationId: 'conversation-measurement',
  turnId: 'turn-1',
  semanticLocalId: 'source',
  sourceText: '英単語180語を進める',
  origin: 'user' as const,
};

function graphWithExistingEffort(
  existingKind: 'duration_per_unit' | 'session_duration',
): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 2,
    appliedTurnKeys: ['conversation-measurement:turn-1'],
    tasks: [{
      id: 'task-english',
      category: 'study',
      title: '英単語',
      source,
      createdRevision: 1,
    }],
    workloads: [{
      id: 'workload-english',
      taskId: 'task-english',
      componentId: null,
      quantityRole: 'target',
      amount: 180,
      unitCode: 'word',
      unitLabel: '語',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      source,
      createdRevision: 1,
    }],
    effortEstimates: [{
      id: 'effort-existing',
      taskId: 'task-english',
      targetFactId: 'workload-english',
      kind: existingKind,
      minutes: existingKind === 'duration_per_unit' ? 5 : 20,
      unitCode: 'word',
      precision: 'approximate',
      source,
      createdRevision: 2,
    }],
    factLifecycles: [
      'task-english',
      'workload-english',
      'effort-existing',
    ].map((factId) => ({
      factId,
      status: 'active' as const,
      createdRevision: factId === 'effort-existing' ? 2 : 1,
      terminalRevision: null,
      supersededByFactId: null,
    })),
  };
}

function durationAnswerDocument(minutes: number): WeeklyPlanningSemanticDocumentV5 {
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
        kind: 'session_duration',
        minutes,
        unitCode: 'word',
        precision: 'approximate',
        sourceText: '1回25分くらいです',
      }],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '1回25分くらいです',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function sessionDurationQuestion() {
  return {
    actionId: 'stable-v5:question-session-duration',
    questionCode: 'missing_effort_estimate' as const,
    targetFactId: 'workload-english',
    graphRevision: 2,
    effortMeasurement: 'session_duration' as const,
  };
}

describe('Stable V5 contextual effort measurement binding', () => {
  it('accepts a requested session duration when a different per-unit effort already exists', () => {
    const initialGraph = graphWithExistingEffort('duration_per_unit');
    const result = applyWeeklyPlanningStableV5ContextualAnswer({
      graph: initialGraph,
      document: durationAnswerDocument(25),
      pendingQuestion: sessionDurationQuestion(),
      conversationId: 'conversation-measurement',
      turnId: 'turn-3',
      expectedRevision: 2,
      userText: '1回25分くらいです',
    });

    expect(result?.status).toBe('applied');
    expect(result?.graph.effortEstimates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'effort-existing',
        kind: 'duration_per_unit',
        minutes: 5,
        targetFactId: 'workload-english',
      }),
      expect.objectContaining({
        kind: 'session_duration',
        minutes: 25,
        targetFactId: 'workload-english',
      }),
    ]));
  });

  it('still rejects the pending target when the same requested measurement is already active', () => {
    const initialGraph = graphWithExistingEffort('session_duration');
    const result = applyWeeklyPlanningStableV5ContextualAnswer({
      graph: initialGraph,
      document: durationAnswerDocument(25),
      pendingQuestion: sessionDurationQuestion(),
      conversationId: 'conversation-measurement',
      turnId: 'turn-3',
      expectedRevision: 2,
      userText: '1回25分くらいです',
    });

    expect(result).toEqual({
      status: 'rejected',
      graph: initialGraph,
      diff: null,
      errors: [
        'contextual-answer-target-unavailable:missing_effort_estimate:workload-english',
      ],
      localToFactId: {},
    });
  });
});
