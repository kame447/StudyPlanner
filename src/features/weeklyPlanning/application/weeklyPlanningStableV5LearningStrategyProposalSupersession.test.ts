import { describe, expect, it } from 'vitest';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import type { GenericSchedulerInputCompilationResult } from '../semantic/weeklyPlanningGenericSchedulerInput';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from '../semantic/weeklyPlanningSemanticDocumentV5';
import { evaluateWeeklyPlanningLearningStrategyProposalsV5 } from './weeklyPlanningStableV5LearningStrategyProposal';

function previousState(): PlanningIntakeState {
  return {
    status: 'draft_ready',
    intent: 'weekly_study_planning',
    tasks: [],
    progress: [],
    unitRates: [],
    constraints: [],
    priorityPolicy: { kind: 'unknown' },
    missing: [],
    assumptions: [],
    uncertainties: [],
    questions: [],
    shouldCreateDraft: true,
    shouldSavePlan: false,
    learningStrategyProposalRecords: [
      {
        id: 'spacing-old',
        kind: 'spaced_memory_practice',
        taskId: 'task-1',
        workloadFactId: 'workload-220',
        scope: 'week',
        status: 'accepted',
        suggestedSessionMinutes: { min: 15, max: 30 },
        selectedSessionMinutes: null,
        createdRevision: 1,
        proposedAtTurnId: 'turn-1',
        decidedAtTurnId: 'turn-2',
      },
      {
        id: 'calibration-old',
        kind: 'calibrate_memory_pace',
        taskId: 'task-1',
        workloadFactId: 'workload-220',
        scope: 'week',
        status: 'accepted',
        suggestedSessionMinutes: { min: 20, max: 20 },
        selectedSessionMinutes: 20,
        createdRevision: 2,
        proposedAtTurnId: 'turn-3',
        decidedAtTurnId: 'turn-4',
      },
    ],
    sourceTurns: [],
  };
}

function correctionDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task-replacement-container',
      existingPublicId: 'task-1',
      category: 'study',
      title: '英単語',
      study: {
        purpose: 'self_study',
        activityKind: 'memorization_retrieval',
        contextLabel: null,
        components: [],
      },
      workloads: [{
        localId: 'workload-replacement',
        quantityRole: 'target',
        amount: 180,
        unitCode: 'word',
        unitLabel: '語',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText: '180語',
      }],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '220語じゃなくて180語だった',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function compilation(): GenericSchedulerInputCompilationResult {
  return {
    status: 'ready',
    input: {
      graphRevision: 5,
      planningStartDate: '2026-08-17',
      planningEndDate: '2026-08-23',
      timeZone: 'Asia/Tokyo',
      movableWorkItems: [],
      availabilityWindows: [],
      fixedTaskReservations: [],
      sourceSelections: [],
    },
    issues: [],
  } as unknown as GenericSchedulerInputCompilationResult;
}

describe('Stable V5 learning proposal workload supersession', () => {
  it('keeps accepted spacing and calibration decisions on the replacement workload', () => {
    const result = evaluateWeeklyPlanningLearningStrategyProposalsV5({
      previousState: previousState(),
      document: correctionDocument(),
      localToFactId: {
        'task-replacement-container': 'task-1',
        'workload-replacement': 'workload-180',
      },
      compilation: compilation(),
      effortEstimates: [{
        targetFactId: 'workload-180',
        kind: 'session_duration',
        minutes: 20,
        unitCode: 'word',
      }],
      workloadSupersessions: {
        'workload-220': 'workload-180',
      },
      graphRevision: 5,
      turnId: 'turn-5',
    });

    expect(result.records).toHaveLength(2);
    expect(result.pendingProposal).toBeNull();
    expect(result.acceptedSpacedProposal).toMatchObject({
      id: 'spacing-old',
      workloadFactId: 'workload-180',
      status: 'accepted',
    });
    expect(result.acceptedCalibrationProposal).toMatchObject({
      id: 'calibration-old',
      workloadFactId: 'workload-180',
      selectedSessionMinutes: 20,
      status: 'accepted',
    });
  });
});
