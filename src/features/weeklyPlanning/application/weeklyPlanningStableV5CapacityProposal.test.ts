import { describe, expect, it } from 'vitest';
import type {
  WeeklyPlanningLearningStrategyProposalRecord,
} from '../intake/weeklyPlanningIntakeTypes';
import type {
  GenericSchedulerInputCompilationResult,
} from '../semantic/weeklyPlanningGenericSchedulerInput';
import {
  evaluateWeeklyPlanningInsufficientCapacityProposalV5,
  type WeeklyPlanningCapacityPreviewEvidenceV5,
} from './weeklyPlanningStableV5CapacityProposal';

function acceptedSpacing(overrides: Partial<WeeklyPlanningLearningStrategyProposalRecord> = {}): WeeklyPlanningLearningStrategyProposalRecord {
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
    ...overrides,
  };
}

function mixedProposal(overrides: Partial<WeeklyPlanningLearningStrategyProposalRecord> = {}): WeeklyPlanningLearningStrategyProposalRecord {
  return {
    ...acceptedSpacing(),
    id: 'wpp_capacity_spacing-1',
    kind: 'mixed_acquisition_review',
    status: 'pending',
    capacityStrategy: {
      trigger: 'insufficient_capacity',
      acquisition: 'longer_sessions',
      review: 'short_distributed_sessions',
      unscheduledWorkItemIds: ['item-memory'],
    },
    decidedAtTurnId: null,
    ...overrides,
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
        { id: 'item-other-memory', workloadFactId: 'workload-other-memory' },
      ],
    },
  } as unknown as GenericSchedulerInputCompilationResult;
}

function preview(
  status: WeeklyPlanningCapacityPreviewEvidenceV5['status'],
  unscheduledWorkItemIds: string[],
): WeeklyPlanningCapacityPreviewEvidenceV5 {
  return { status, unscheduledWorkItemIds };
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

  it('does not let an unrelated pending proposal suppress the affected workload proposal', () => {
    const unrelatedPending = mixedProposal({
      id: 'wpp_capacity_other',
      taskId: 'task-other-memory',
      workloadFactId: 'workload-other-memory',
      capacityStrategy: {
        trigger: 'insufficient_capacity',
        acquisition: 'longer_sessions',
        review: 'short_distributed_sessions',
        unscheduledWorkItemIds: ['item-other-memory'],
      },
    });
    const result = evaluateWeeklyPlanningInsufficientCapacityProposalV5({
      records: [acceptedSpacing(), unrelatedPending],
      compilation: compilation(),
      preview: preview('insufficient_capacity', ['item-memory']),
      graphRevision: 5,
      turnId: 'turn-5',
    });

    expect(result.pendingProposal).toMatchObject({
      id: 'wpp_capacity_spacing-1',
      workloadFactId: 'workload-memory',
      status: 'pending',
      capacityStrategy: {
        unscheduledWorkItemIds: ['item-memory'],
      },
    });
    expect(result.records.filter((record) => record.status === 'pending')).toHaveLength(2);
  });

  it('skips an already-covered workload, proposes for another workload, and scopes evidence to that workload', () => {
    const otherSpacing = acceptedSpacing({
      id: 'spacing-2',
      taskId: 'task-other-memory',
      workloadFactId: 'workload-other-memory',
    });
    const alreadyCovered = mixedProposal();
    const result = evaluateWeeklyPlanningInsufficientCapacityProposalV5({
      records: [acceptedSpacing(), alreadyCovered, otherSpacing],
      compilation: compilation(),
      preview: preview('insufficient_capacity', ['item-memory', 'item-other-memory']),
      graphRevision: 6,
      turnId: 'turn-6',
    });

    expect(result.pendingProposal).toMatchObject({
      id: 'wpp_capacity_spacing-2',
      taskId: 'task-other-memory',
      workloadFactId: 'workload-other-memory',
      status: 'pending',
      capacityStrategy: {
        unscheduledWorkItemIds: ['item-other-memory'],
      },
    });
    expect(result.records).toHaveLength(4);
  });

  it('returns an existing same-target pending mixed proposal without duplicating it', () => {
    const existingPending = mixedProposal();
    const result = evaluateWeeklyPlanningInsufficientCapacityProposalV5({
      records: [acceptedSpacing(), existingPending],
      compilation: compilation(),
      preview: preview('insufficient_capacity', ['item-memory']),
      graphRevision: 5,
      turnId: 'turn-5',
    });

    expect(result.pendingProposal).toEqual(existingPending);
    expect(result.records).toHaveLength(2);
  });

  it('does not duplicate a mixed strategy after it was already decided', () => {
    const mixed = mixedProposal({ status: 'rejected', decidedAtTurnId: 'turn-5' });
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
