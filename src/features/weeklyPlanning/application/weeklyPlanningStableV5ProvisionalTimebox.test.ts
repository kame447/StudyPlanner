import { describe, expect, it } from 'vitest';
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
      previousStatus: 'revision_pending',
      previousGraph: workGraph(['workload-math', 'workload-physics']),
      currentCompilation: missingCompilation([
        { questionFactId: 'workload-math' },
        { questionFactId: 'workload-physics' },
      ]),
    });

    expect(resolution).toMatchObject({
      source: 'current_directive',
      workloadFactIds: ['workload-math', 'workload-physics'],
      minutesPerWorkload: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5,
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
      previousStatus: 'revision_pending',
      previousGraph: workGraph(['workload-remaining']),
      currentCompilation: missingCompilation([
        {
          questionFactId: 'workload-completed',
          estimateForWorkloadFactId: 'workload-remaining',
        },
      ]),
    });

    expect(resolution.workloadFactIds).toEqual(['workload-remaining']);
  });

  it('carries forward only workload ids that were already provisionally schedulable in a draft-ready graph', () => {
    const resolution = resolveWeeklyPlanningProvisionalTimeboxV5({
      directive: null,
      previousStatus: 'draft_ready',
      previousGraph: workGraph(['workload-existing']),
      currentCompilation: missingCompilation([
        { questionFactId: 'workload-existing' },
        { questionFactId: 'workload-new' },
      ]),
    });

    expect(resolution).toMatchObject({
      source: 'draft_ready_carry_forward',
      workloadFactIds: ['workload-existing'],
    });
  });

  it('does not invent a timebox without explicit current authorization or a draft-ready carry-forward', () => {
    const resolution = resolveWeeklyPlanningProvisionalTimeboxV5({
      directive: null,
      previousStatus: 'revision_pending',
      previousGraph: workGraph(['workload-existing']),
      currentCompilation: missingCompilation([
        { questionFactId: 'workload-existing' },
      ]),
    });

    expect(resolution.source).toBeNull();
    expect(resolution.workloadFactIds).toEqual([]);
  });
});
