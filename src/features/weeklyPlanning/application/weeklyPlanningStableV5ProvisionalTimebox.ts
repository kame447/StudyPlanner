import {
  readWeeklyPlanningProvisionalTimeboxStateV5,
  WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5,
  WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_STATE_VERSION_V5,
  type WeeklyPlanningProvisionalTimeboxStateV5,
} from '../intake/weeklyPlanningProvisionalTimeboxStateV5';
import type {
  WeeklyPlanningContextualDirectiveV5,
} from '../semantic/weeklyPlanningSemanticNormalizerContractsV5';
import type {
  GenericSchedulerInputCompilationResult,
  WeeklyPlanningGenericSchedulerGraphView,
} from '../semantic/weeklyPlanningGenericSchedulerInput';

export const WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_POLICY_VERSION_V5 =
  'weekly-planning-provisional-timebox-v1' as const;
export { WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5 };

export interface WeeklyPlanningProvisionalTimeboxResolutionV5 {
  policyVersion: typeof WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_POLICY_VERSION_V5;
  source: 'current_directive' | 'session_state' | null;
  workloadFactIds: string[];
  minutesPerWorkload: number;
  state: WeeklyPlanningProvisionalTimeboxStateV5 | null;
}

function currentMissingEffortWorkloadFactIds(
  compilation: GenericSchedulerInputCompilationResult,
): string[] {
  const ids = compilation.issues.flatMap((issue) => {
    if (issue.domain !== 'work_item' || issue.code !== 'missing_effort_estimate') {
      return [];
    }
    const estimateTarget = issue.details?.estimateForWorkloadFactId;
    return [
      typeof estimateTarget === 'string' && estimateTarget.trim()
        ? estimateTarget
        : issue.factId,
    ];
  });
  return [...new Set(ids.filter((value) => value.trim()))];
}

function stateForAuthorization(params: {
  workloadFactIds: string[];
  graphRevision: number;
  turnId: string;
}): WeeklyPlanningProvisionalTimeboxStateV5 | null {
  if (params.workloadFactIds.length === 0 || !params.turnId.trim()) return null;
  return {
    version: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_STATE_VERSION_V5,
    workloadFactIds: [...params.workloadFactIds],
    minutesPerWorkload: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5,
    authorizedAtGraphRevision: params.graphRevision,
    authorizedAtTurnId: params.turnId,
  };
}

export function resolveWeeklyPlanningProvisionalTimeboxV5(params: {
  directive: WeeklyPlanningContextualDirectiveV5 | null | undefined;
  previousState: unknown;
  currentCompilation: GenericSchedulerInputCompilationResult;
  graphRevision: number;
  turnId: string;
}): WeeklyPlanningProvisionalTimeboxResolutionV5 {
  const currentMissing = currentMissingEffortWorkloadFactIds(params.currentCompilation);
  if (params.directive?.kind === 'provisional_timebox') {
    const state = stateForAuthorization({
      workloadFactIds: currentMissing,
      graphRevision: params.graphRevision,
      turnId: params.turnId,
    });
    return {
      policyVersion: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_POLICY_VERSION_V5,
      source: state ? 'current_directive' : null,
      workloadFactIds: state?.workloadFactIds ?? [],
      minutesPerWorkload: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5,
      state,
    };
  }

  const previous = readWeeklyPlanningProvisionalTimeboxStateV5(params.previousState);
  if (!previous) {
    return {
      policyVersion: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_POLICY_VERSION_V5,
      source: null,
      workloadFactIds: [],
      minutesPerWorkload: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5,
      state: null,
    };
  }

  const currentMissingSet = new Set(currentMissing);
  const workloadFactIds = previous.workloadFactIds.filter((id) => currentMissingSet.has(id));
  const state = workloadFactIds.length > 0
    ? { ...previous, workloadFactIds }
    : null;
  return {
    policyVersion: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_POLICY_VERSION_V5,
    source: state ? 'session_state' : null,
    workloadFactIds,
    minutesPerWorkload: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5,
    state,
  };
}

export function projectWeeklyPlanningProvisionalTimeboxGraphV5(params: {
  graph: WeeklyPlanningGenericSchedulerGraphView;
  resolution: WeeklyPlanningProvisionalTimeboxResolutionV5;
}): WeeklyPlanningGenericSchedulerGraphView {
  if (!params.resolution.source || params.resolution.workloadFactIds.length === 0) {
    return params.graph;
  }
  const projectedIds = new Set(params.resolution.workloadFactIds);
  return {
    ...params.graph,
    workloads: params.graph.workloads.map((workload) =>
      projectedIds.has(workload.id)
        ? {
            ...workload,
            amount: params.resolution.minutesPerWorkload,
            unitCode: 'minute',
            unitLabel: '分',
            rangeStart: null,
            rangeEnd: null,
            perOccurrence: false,
            periodExpression: null,
          }
        : workload),
  };
}
