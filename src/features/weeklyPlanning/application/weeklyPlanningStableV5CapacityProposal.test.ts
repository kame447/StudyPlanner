import { describe, expect, it } from 'vitest';
import type {
  WeeklyPlanningLearningStrategyProposalRecord,
} from '../intake/weeklyPlanningIntakeTypes';
import type {
  GenericSchedulerInputCompilationResult,
} from '../semantic/weeklyPlanningGenericSchedulerInput';
import type {
  WeeklyPlanningStableV5PreviewSchedulerResult,
} from '../semantic/weeklyPlanningStableV5PreviewScheduler';
import {
  evaluateWeeklyPlanningInsufficientCapacityProposalV5,
} from './weeklyPlanningStableV5CapacityProposal';

function acceptedSpacing(): WeeklyPlanningLearningStrategyProposalRecord {
  return {
    id: 'spacing-1',
    kind: 'spaced_memory_practice',
    taskId: 'task-memory',
    workloadFactId: 'workload-memory',
    scope: 'week',
    status: 'accepted',
    suggestedSessionMinutes: { min: 15, max: 30 },
    selectedSessionMinutes: null,
    createdRevision: 2,
    proposedAtTurnId: 'turn-1',
    decidedAtTurnId: 'turn-2',
  };
}

function compilation(): GenericSchedulerInputCompilationResult {
  return {
    status: 'ready',
    issues: [],
    input: {
      movableWorkItems: [
        { id: 'item-memory', workloadFactId: 'workload-memory' },
        { id: 'item-math', workloadFactId: 'workload-math' },
      ],
    },
  } as unknown as GenericSchedulerInputCompilationResult;
}

function preview(
  status: WeeklyPlanningStableV5PreviewSchedulerResult['status'],
  unscheduledWorkItemIds: string[],
): WeeklyPlanningStableV5PreviewSchedulerResult {
  return {
    schedulerVersion: 'weekly-planning-stable-v5-preview-scheduler-v1',
    status,
    candidates: [],
    unscheduledWorkItemIds,
  };
}

describe('Stable V5 insufficient-capacity learning proposal', () => {
  it('creates one typed mixed acquisition-review proposal from scheduler and accepted memory evidence', () => {
    const result = evaluateWeeklyPlanningInsufficientCapacityProposalV5({
      records: [acceptedSpacing()],
      compilation: compilation(),
      preview: preview('insufficient_capacity', ['item-memory']),
      graphRevision: 4,
      turnId: 'turn-4',
    });

    expect(result.pendingProposal).toMatchObject({
      id: 'wpp_capacity_spacing-1',
      kind: 'mixed_acquisition_review',
      taskId: 'task-memory',
      workloadFactId: 'workload-memory',
      status: 'pending',
      suggestedSessionMinutes: { min: 15, max: 30 },
      capacityStrategy: {
        trigger: 'insufficient_capacity',
        acquisition: 'longer_sessions',
        review: 'short_distributed_sessions',
        unscheduledWorkItemIds: ['item-memory'],
      },
    });
    expect(result.records).toHaveLength(2);
  });

  it('does not infer a memory strategy from capacity shortage alone', () => {
    const result = evaluateWeeklyPlanningInsufficientCapacityProposalV5({
      records: [],
      compilation: compilation(),
      preview: preview('insufficient_capacity', ['item-memory']),
      graphRevision: 4,
      turnId: 'turn-4',
    });

    expect(result.pendingProposal).toBeNull();
    expect(result.records).toEqual([]);
  });

  it('does not offer the memory strategy for a shortage on an unrelated workload', () => {
    const result = evaluateWeeklyPlanningInsufficientCapacityProposalV5({
      records: [acceptedSpacing()],
      compilation: compilation(),
      preview: preview('insufficient_capacity', ['item-math']),
      graphRevision: 4,
      turnId: 'turn-4',
    });

    expect(result.pendingProposal).toBeNull();
  });

  it('does not duplicate a mixed strategy after it was already decided', () => {
    const mixed: WeeklyPlanningLearningStrategyProposalRecord = {
      ...acceptedSpacing(),
      id: 'wpp_capacity_spacing-1',
      kind: 'mixed_acquisition_review',
      status: 'rejected',
      capacityStrategy: {
        trigger: 'insufficient_capacity',
        acquisition: 'longer_sessions',
        review: 'short_distributed_sessions',
        unscheduledWorkItemIds: ['item-memory'],
      },
    };
    const result = evaluateWeeklyPlanningInsufficientCapacityProposalV5({
      records: [acceptedSpacing(), mixed],
      compilation: compilation(),
      preview: preview('insufficient_capacity', ['item-memory']),
      graphRevision: 5,
      turnId: 'turn-5',
    });

    expect(result.pendingProposal).toBeNull();
    expect(result.records).toHaveLength(2);
  });
});
