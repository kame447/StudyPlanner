import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningLearningStrategyProposalRecord } from '../intake/weeklyPlanningIntakeTypes';
import type {
  GenericSchedulerInputCompilationResult,
  WeeklyPlanningGenericSchedulerGraphView,
} from './weeklyPlanningGenericSchedulerInput';
import { applyAcceptedMemorySessionProjectionV5 } from './weeklyPlanningAcceptedMemorySessionProjectionV5';

const source = {
  conversationId: 'conversation',
  turnId: 'turn',
  semanticLocalId: 'workload',
  sourceText: '英単語220語',
  origin: 'user' as const,
};

const OBSERVED_220_WORD_ESTIMATE_MINUTES = (20 / 35) * 220;

function graph(): WeeklyPlanningGenericSchedulerGraphView {
  return {
    revision: 2,
    planningWindows: [],
    tasks: [{ id: 'task', category: 'study', title: '英単語', source, createdRevision: 1 }] as unknown as WeeklyPlanningGenericSchedulerGraphView['tasks'],
    components: [],
    workloads: [{
      id: 'workload', taskId: 'task', componentId: null, quantityRole: 'target',
      amount: 220, unitCode: 'word', unitLabel: '語', rangeStart: null, rangeEnd: null,
      perOccurrence: false, periodExpression: null, source, createdRevision: 1,
    }],
    effortEstimates: [{
      id: 'session-effort', taskId: 'task', targetFactId: 'workload',
      kind: 'session_duration', minutes: 20, unitCode: null, precision: 'approximate',
      source, createdRevision: 2,
    }],
    temporalConstraints: [], taskDateRules: [], recurrences: [], relations: [],
    uncertainties: [], availabilityDeclarations: [], constraintSourceRequests: [],
  };
}

function compilation(): GenericSchedulerInputCompilationResult {
  return {
    status: 'ready',
    issues: [],
    input: {
      version: 'weekly-planning-generic-scheduler-input-v2',
      graphRevision: 2,
      ownerId: 'owner',
      horizon: {
        startDate: '2026-08-17', endDate: '2026-08-23', timeZone: 'Asia/Tokyo',
        planningWindowFactIds: [],
      },
      movableWorkItems: [{
        version: 'weekly-planning-generic-work-item-v1',
        id: 'item', taskId: 'task', componentId: null, workloadFactId: 'workload',
        label: '英単語 220語', quantityRole: 'target', actionability: 'actionable',
        quantity: {
          amount: 220, unitCode: 'word', unitLabel: '語',
          ordinalRange: { start: 1, end: 220 }, actualRange: null,
        },
        estimatedMinutes: 140,
        baseEstimatedMinutes: OBSERVED_220_WORD_ESTIMATE_MINUTES,
        calibrationMultiplier: 1,
        roundingStepMinutes: 15,
        estimateBasis: 'observed_pace',
        estimateSourceFactIds: [], estimateSourceWorkloadFactIds: [],
        splitPolicy: 'unknown', periodExpression: null, sourceFactRefs: ['workload'],
      }],
      fixedTaskReservations: [], taskDateEligibilities: [], availabilityWindows: [],
      sourceSelections: [], relations: [], hardDateBounds: [], preferredPlacements: [],
      sourceFactRefs: ['workload'],
    },
  };
}

function proposal(kind: 'spaced_memory_practice' | 'calibrate_memory_pace'): WeeklyPlanningLearningStrategyProposalRecord {
  return {
    id: `proposal-${kind}`, kind, taskId: 'task', workloadFactId: 'workload', scope: 'week',
    status: 'accepted', suggestedSessionMinutes: { min: 20, max: 20 },
    selectedSessionMinutes: 20, createdRevision: 2, proposedAtTurnId: 'turn-1',
    decidedAtTurnId: 'turn-2',
  };
}

describe('accepted memory session projection', () => {
  it('keeps the 125.7-minute observation-derived estimate until buffering and full-session allocation', () => {
    expect(OBSERVED_220_WORD_ESTIMATE_MINUTES).toBeCloseTo(125.7142857);
    const result = applyAcceptedMemorySessionProjectionV5({
      compilation: compilation(), graph: graph(),
      acceptedSpacedProposal: proposal('spaced_memory_practice'),
      acceptedCalibrationProposal: null,
    });
    expect(result.input?.movableWorkItems).toHaveLength(7);
    expect(result.input?.movableWorkItems.map((item) => item.estimatedMinutes)).toEqual([
      20, 20, 20, 20, 20, 20, 20,
    ]);
    expect(result.input?.movableWorkItems.reduce(
      (sum, item) => sum + (item.estimatedMinutes ?? 0),
      0,
    )).toBe(140);
    expect(result.input?.movableWorkItems.reduce(
      (sum, item) => sum + item.quantity.amount,
      0,
    )).toBe(220);
  });

  it('uses one full accepted session even when the buffered estimate is shorter', () => {
    const sourceCompilation = compilation();
    sourceCompilation.input!.movableWorkItems[0] = {
      ...sourceCompilation.input!.movableWorkItems[0],
      estimatedMinutes: 15,
      baseEstimatedMinutes: 10,
    };
    const result = applyAcceptedMemorySessionProjectionV5({
      compilation: sourceCompilation, graph: graph(),
      acceptedSpacedProposal: proposal('spaced_memory_practice'),
      acceptedCalibrationProposal: null,
    });
    expect(result.input?.movableWorkItems).toHaveLength(1);
    expect(result.input?.movableWorkItems[0].estimatedMinutes).toBe(20);
  });

  it('does not sessionize before the strategy is accepted', () => {
    const result = applyAcceptedMemorySessionProjectionV5({
      compilation: compilation(), graph: graph(), acceptedSpacedProposal: null,
      acceptedCalibrationProposal: null,
    });
    expect(result).toEqual(compilation());
  });

  it('keeps cold-start calibration as exactly one trial instead of full-scope sessions', () => {
    const result = applyAcceptedMemorySessionProjectionV5({
      compilation: compilation(), graph: graph(),
      acceptedSpacedProposal: proposal('spaced_memory_practice'),
      acceptedCalibrationProposal: proposal('calibrate_memory_pace'),
    });
    expect(result).toEqual(compilation());
  });
});
