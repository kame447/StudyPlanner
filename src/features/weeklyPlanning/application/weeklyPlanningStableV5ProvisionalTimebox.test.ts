import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_STATE_VERSION_V5,
  type WeeklyPlanningProvisionalTimeboxStateV5,
} from '../intake/weeklyPlanningProvisionalTimeboxStateV5';
import type {
  GenericSchedulerInputCompilationResult,
  WeeklyPlanningGenericSchedulerGraphView,
} from '../semantic/weeklyPlanningGenericSchedulerInput';
import type {
  WeeklyPlanningGenericWorkGraphView,
} from '../semantic/weeklyPlanningGenericWorkItems';
import {
  projectWeeklyPlanningProvisionalTimeboxGraphV5,
  resolveWeeklyPlanningProvisionalTimeboxV5,
  WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5,
} from './weeklyPlanningStableV5ProvisionalTimebox';

const source = {
  conversationId: 'conversation-1',
  turnId: 'turn-1',
  semanticLocalId: 'local-1',
  sourceText: '開始していません。',
  origin: 'user' as const,
};

function workGraph(workloadIds: string[]): WeeklyPlanningGenericWorkGraphView {
  return {
    tasks: workloadIds.map((id) => ({
      id: `task-${id}`,
      category: 'study',
      title: id,
      source,
      createdRevision: 1,
    })),
    components: [],
    workloads: workloadIds.map((id) => ({
      id,
      taskId: `task-${id}`,
      componentId: null,
      quantityRole: 'remaining',
      amount: 100,
      unitCode: 'custom',
      unitLabel: '%',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      source,
      createdRevision: 1,
    })),
    effortEstimates: [],
  };
}

function missingCompilation(
  issues: Array<{ questionFactId: string; estimateForWorkloadFactId?: string }>,
): GenericSchedulerInputCompilationResult {
  return {
    status: 'needs_resolution',
    input: null,
    issues: issues.map((issue) => ({
      domain: 'work_item' as const,
      code: 'missing_effort_estimate' as const,
      blocking: true,
      factId: issue.questionFactId,
      details: issue.estimateForWorkloadFactId
        ? {
            estimateForWorkloadFactId: issue.estimateForWorkloadFactId,
            questionBasis: 'completed_workload_total',
          }
        : undefined,
    })),
  };
}

function authorizedState(workloadFactIds: string[]): WeeklyPlanningProvisionalTimeboxStateV5 {
  return {
    version: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_STATE_VERSION_V5,
    workloadFactIds,
    minutesPerWorkload: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5,
    authorizedAtGraphRevision: 11,
    authorizedAtTurnId: 'turn-9',
  };
}

describe('Stable V5 provisional timebox scheduler projection', () => {
  it('projects only current missing-effort workloads into scheduler minutes without mutating facts', () => {
    const graph = {
      ...workGraph(['workload-math', 'workload-physics']),
      revision: 11,
      availabilityDeclarations: [],
      constraintSourceRequests: [],
      planningWindows: [],
      relations: [],
      uncertainties: [],
      temporalConstraints: [],
      recurrences: [],
    } as unknown as WeeklyPlanningGenericSchedulerGraphView;

    const resolution = resolveWeeklyPlanningProvisionalTimeboxV5({
      directive: {
        kind: 'provisional_timebox',
        scope: 'current_missing_effort',
      },
      previousState: null,
      currentCompilation: missingCompilation([
        { questionFactId: 'workload-math' },
        { questionFactId: 'workload-physics' },
      ]),
      graphRevision: 11,
      turnId: 'turn-9',
    });

    expect(resolution).toMatchObject({
      source: 'current_directive',
      workloadFactIds: ['workload-math', 'workload-physics'],
      minutesPerWorkload: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5,
      state: {
        authorizedAtGraphRevision: 11,
        authorizedAtTurnId: 'turn-9',
      },
    });

    const projected = projectWeeklyPlanningProvisionalTimeboxGraphV5({
      graph,
      resolution,
    });

    expect(projected.workloads).toEqual([
      expect.objectContaining({
        id: 'workload-math',
        amount: 60,
        unitCode: 'minute',
        unitLabel: '分',
        quantityRole: 'remaining',
      }),
      expect.objectContaining({
        id: 'workload-physics',
        amount: 60,
        unitCode: 'minute',
        unitLabel: '分',
        quantityRole: 'remaining',
      }),
    ]);
    expect(graph.workloads).toEqual([
      expect.objectContaining({
        id: 'workload-math',
        amount: 100,
        unitCode: 'custom',
        unitLabel: '%',
      }),
      expect.objectContaining({
        id: 'workload-physics',
        amount: 100,
        unitCode: 'custom',
        unitLabel: '%',
      }),
    ]);
    expect(projected.effortEstimates).toEqual([]);
  });

  it('uses the real estimate target rather than a historical question target', () => {
    const resolution = resolveWeeklyPlanningProvisionalTimeboxV5({
      directive: {
        kind: 'provisional_timebox',
        scope: 'current_missing_effort',
      },
      previousState: null,
      currentCompilation: missingCompilation([
        {
          questionFactId: 'workload-completed',
          estimateForWorkloadFactId: 'workload-remaining',
        },
      ]),
      graphRevision: 11,
      turnId: 'turn-9',
    });

    expect(resolution.workloadFactIds).toEqual(['workload-remaining']);
  });

  it('carries forward only workload ids explicitly authorized in session state', () => {
    const resolution = resolveWeeklyPlanningProvisionalTimeboxV5({
      directive: null,
      previousState: authorizedState(['workload-existing']),
      currentCompilation: missingCompilation([
        { questionFactId: 'workload-existing' },
        { questionFactId: 'workload-new' },
      ]),
      graphRevision: 12,
      turnId: 'turn-10',
    });

    expect(resolution).toMatchObject({
      source: 'session_state',
      workloadFactIds: ['workload-existing'],
      state: {
        workloadFactIds: ['workload-existing'],
        authorizedAtTurnId: 'turn-9',
      },
    });
  });

  it('rejects malformed persisted state instead of treating draft status as authorization', () => {
    const resolution = resolveWeeklyPlanningProvisionalTimeboxV5({
      directive: null,
      previousState: {
        ...authorizedState(['workload-existing']),
        minutesPerWorkload: 999,
      },
      currentCompilation: missingCompilation([
        { questionFactId: 'workload-existing' },
      ]),
      graphRevision: 12,
      turnId: 'turn-10',
    });

    expect(resolution.source).toBeNull();
    expect(resolution.workloadFactIds).toEqual([]);
    expect(resolution.state).toBeNull();
  });
});
