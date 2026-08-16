import { describe, expect, it } from 'vitest';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { createStableV5SemanticPublicStateSummary } from './weeklyPlanningStableV5SemanticContext';

function baseState(): PlanningIntakeState {
  return {
    status: 'revision_pending',
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
    shouldCreateDraft: false,
    shouldSavePlan: false,
    draftGenerationIntent: 'user_authorized',
    sourceTurns: [],
  };
}

describe('Stable V5 semantic public-state question binding', () => {
  it('publishes an options proposal as the exact machine pending question', () => {
    const previousState: PlanningIntakeState = {
      ...baseState(),
      lastQuestionContext: {
        kind: 'options',
        targetSlot: 'stable_v5:learning_strategy_proposal',
        intent: 'learning_strategy_proposal',
        topicId: 'workload-1',
        actionId: 'proposal-1',
      },
      learningStrategyProposalRecords: [{
        id: 'proposal-1',
        kind: 'spaced_memory_practice',
        taskId: 'task-1',
        workloadFactId: 'workload-1',
        scope: 'week',
        status: 'pending',
        suggestedSessionMinutes: { min: 15, max: 30 },
        selectedSessionMinutes: null,
        createdRevision: 2,
        proposedAtTurnId: 'turn-1',
        decidedAtTurnId: null,
      }],
    };
    const graph = {
      ...createEmptyWeeklyPlanningFactGraphV5(),
      revision: 2,
    };

    const summary = createStableV5SemanticPublicStateSummary({
      graph,
      messages: [],
      previousState,
    });

    expect(summary.pendingQuestion).toEqual({
      actionId: 'proposal-1',
      questionCode: 'learning_strategy_proposal',
      targetFactId: 'workload-1',
      graphRevision: 2,
      effortMeasurement: null,
    });
    expect(summary.learningStrategyProposals).toEqual([
      expect.objectContaining({
        publicId: 'proposal-1',
        workloadPublicId: 'workload-1',
        status: 'pending',
      }),
    ]);
  });

  it('keeps typed effort measurement on a normal machine question', () => {
    const previousState: PlanningIntakeState = {
      ...baseState(),
      lastQuestionContext: {
        kind: 'missing',
        targetSlot: 'stable_v5:missing_effort_estimate',
        intent: 'session_duration',
        topicId: 'workload-1',
        actionId: 'question-1',
      },
    };
    const graph = {
      ...createEmptyWeeklyPlanningFactGraphV5(),
      revision: 4,
    };

    const summary = createStableV5SemanticPublicStateSummary({
      graph,
      messages: [],
      previousState,
    });

    expect(summary.pendingQuestion).toEqual({
      actionId: 'question-1',
      questionCode: 'missing_effort_estimate',
      targetFactId: 'workload-1',
      graphRevision: 4,
      effortMeasurement: 'session_duration',
    });
  });
});
