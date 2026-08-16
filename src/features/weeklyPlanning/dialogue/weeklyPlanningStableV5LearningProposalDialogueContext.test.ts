import { describe, expect, it } from 'vitest';
import {
  learningStrategyProposalIntentForStableV5Dialogue,
} from './weeklyPlanningStableV5DialogueContext';

describe('Stable V5 learning proposal dialogue intent', () => {
  it('projects the exact pending spaced-memory proposal for the renderer', () => {
    expect(learningStrategyProposalIntentForStableV5Dialogue({
      questionCode: 'learning_strategy_proposal',
      actionId: 'proposal-spacing',
      proposalRecords: [{
        id: 'proposal-spacing',
        kind: 'spaced_memory_practice',
        workloadFactId: 'workload-1',
        status: 'pending',
        suggestedSessionMinutes: { min: 15, max: 30 },
        selectedSessionMinutes: null,
      }],
    })).toEqual({
      kind: 'learning_strategy_proposal',
      proposalKind: 'spaced_memory_practice',
      targetFactId: 'workload-1',
      suggestedSessionDurationMinutes: { min: 15, max: 30 },
      spacingInterval: 'not_yet_selected',
      rationale: 'distributed_retrieval_supports_retention',
      decisionRequested: 'accept_or_reject',
    });
  });

  it('projects pace calibration as a one-session observation plan', () => {
    expect(learningStrategyProposalIntentForStableV5Dialogue({
      questionCode: 'learning_strategy_proposal',
      actionId: 'proposal-calibration',
      proposalRecords: [{
        id: 'proposal-calibration',
        kind: 'calibrate_memory_pace',
        workloadFactId: 'workload-1',
        status: 'pending',
        suggestedSessionMinutes: { min: 20, max: 20 },
        selectedSessionMinutes: 20,
      }],
    })).toEqual({
      kind: 'learning_strategy_proposal',
      proposalKind: 'calibrate_memory_pace',
      targetFactId: 'workload-1',
      suggestedSessionDurationMinutes: { min: 20, max: 20 },
      selectedSessionDurationMinutes: 20,
      sessionDurationMinutes: 20,
      measurementPlan: {
        observation: 'progress_during_single_session',
        objective: 'measure_personal_pace',
        futureUse: 'personalize_future_session_planning',
      },
      decisionRequested: 'accept_or_reject',
    });
  });

  it('does not project a stale or already-decided proposal', () => {
    expect(learningStrategyProposalIntentForStableV5Dialogue({
      questionCode: 'learning_strategy_proposal',
      actionId: 'proposal-spacing',
      proposalRecords: [{
        id: 'proposal-spacing',
        kind: 'spaced_memory_practice',
        workloadFactId: 'workload-1',
        status: 'accepted',
        suggestedSessionMinutes: { min: 15, max: 30 },
      }],
    })).toBeNull();
  });
});
