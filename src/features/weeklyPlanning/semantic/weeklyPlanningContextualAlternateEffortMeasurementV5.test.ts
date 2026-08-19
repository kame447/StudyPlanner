import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import { shouldAttemptWeeklyPlanningContextualAnswerV5 } from './weeklyPlanningContextualAnswerRoutingV5';
import { applyWeeklyPlanningStableV5ContextualAnswer } from './weeklyPlanningStableV5ContextualAnswer';

const taskId = 'wpf_task_slides';
const completedId = 'wpf_workload_completed_12';

function graph() {
  const source = {
    conversationId: 'conversation-slides',
    turnId: 'turn-3',
    semanticLocalId: 'completed-12',
    sourceText: '今は12枚までできています',
    origin: 'user' as const,
  };
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 6,
    appliedTurnKeys: ['conversation-slides:turn-3'],
    tasks: [{
      id: taskId,
      category: 'study' as const,
      title: '夏合宿のスライド',
      source,
      createdRevision: 1,
    }],
    workloads: [{
      id: completedId,
      taskId,
      componentId: null,
      quantityRole: 'completed' as const,
      amount: 12,
      unitCode: 'page' as const,
      unitLabel: '枚',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      source,
      createdRevision: 6,
    }],
    factLifecycles: [
      {
        factId: taskId,
        status: 'active' as const,
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      },
      {
        factId: completedId,
        status: 'active' as const,
        createdRevision: 6,
        terminalRevision: null,
        supersededByFactId: null,
      },
    ],
  };
}

function perUnitDocument(): WeeklyPlanningSemanticDocumentV5 {
  const sourceText = '1枚あたりだいたい8分くらいです';
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'focused_contextual_task',
      existingPublicId: taskId,
      decompositionStatus: 'atomic',
      category: 'study',
      title: '夏合宿のスライド',
      study: null,
      workloads: [{
        localId: completedId,
        quantityRole: 'completed',
        amount: 12,
        unitCode: 'page',
        unitLabel: '枚',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText,
      }],
      effortEstimates: [{
        localId: 'focused_contextual_effort',
        targetLocalId: completedId,
        kind: 'duration_per_unit',
        minutes: 8,
        unitCode: 'page',
        precision: 'approximate',
        sourceText,
      }],
      temporalConstraints: [],
      recurrence: [],
      durableContextSignals: [],
      sourceText,
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

function pendingQuestion() {
  return {
    actionId: null,
    questionCode: 'missing_effort_estimate' as const,
    targetFactId: completedId,
    graphRevision: 6,
    effortMeasurement: 'total_duration' as const,
  };
}

describe('Stable V5 alternate effort measurement contextual binding', () => {
  it('keeps an explicit per-unit answer on the machine-selected completed workload', () => {
    const document = perUnitDocument();
    expect(shouldAttemptWeeklyPlanningContextualAnswerV5({
      document,
      pendingQuestion: pendingQuestion(),
    })).toBe(true);

    const result = applyWeeklyPlanningStableV5ContextualAnswer({
      graph: graph(),
      document,
      pendingQuestion: pendingQuestion(),
      conversationId: 'conversation-slides',
      turnId: 'turn-4',
      expectedRevision: 6,
      userText: '1枚あたりだいたい8分くらいです',
    });

    expect(result?.status).toBe('applied');
    expect(result?.graph.effortEstimates).toEqual([
      expect.objectContaining({
        taskId,
        targetFactId: completedId,
        kind: 'duration_per_unit',
        minutes: 8,
        unitCode: 'page',
        precision: 'approximate',
      }),
    ]);
  });
});
