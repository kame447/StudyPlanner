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
      suggestedSessionMinutes: { min: 15, max: 30 },
      selectedSessionMinutes: null,
      rationale: 'distributed_retrieval_supports_retention',
      decisionRequested: 'accept_or_reject',
    });
  });

  it('keeps the pace-calibration proposal distinct from the spacing proposal', () => {
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
      suggestedSessionMinutes: { min: 20, max: 20 },
      selectedSessionMinutes: 20,
      rationale: 'measure_personal_pace',
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
