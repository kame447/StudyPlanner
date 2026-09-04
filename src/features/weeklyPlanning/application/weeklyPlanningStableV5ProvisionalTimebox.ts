import type { PlanningIntakeStatus } from '../intake/weeklyPlanningIntakeTypes';
import type {
  WeeklyPlanningContextualDirectiveV5,
} from '../semantic/weeklyPlanningSemanticNormalizerContractsV5';
import {
  compileGenericPlanningWorkItems,
  type WeeklyPlanningGenericWorkGraphView,
} from '../semantic/weeklyPlanningGenericWorkItems';
import type {
  GenericSchedulerInputCompilationResult,
  WeeklyPlanningGenericSchedulerGraphView,
} from '../semantic/weeklyPlanningGenericSchedulerInput';

export const WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_POLICY_VERSION_V5 =
  'weekly-planning-provisional-timebox-v1' as const;
export const WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5 = 60;

export interface WeeklyPlanningProvisionalTimeboxResolutionV5 {
  policyVersion: typeof WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_POLICY_VERSION_V5;
  source: 'current_directive' | 'draft_ready_carry_forward' | null;
  workloadFactIds: string[];
  minutesPerWorkload: number;
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

function graphMissingEffortWorkloadFactIds(
  graph: WeeklyPlanningGenericWorkGraphView,
): string[] {
  return [...new Set(
    compileGenericPlanningWorkItems(graph).issues
      .filter((issue) => issue.code === 'missing_effort_estimate')
      .map((issue) => issue.workloadFactId),
  )];
}

function provisionalRequested(
  directive: WeeklyPlanningContextualDirectiveV5 | null | undefined,
): boolean {
  return directive?.kind === 'provisional_timebox'
    && directive.scope === 'current_missing_effort';
}

export function resolveWeeklyPlanningProvisionalTimeboxV5(params: {
  directive?: WeeklyPlanningContextualDirectiveV5 | null;
  previousStatus: PlanningIntakeStatus | null;
  previousGraph: WeeklyPlanningGenericWorkGraphView;
  currentCompilation: GenericSchedulerInputCompilationResult;
}): WeeklyPlanningProvisionalTimeboxResolutionV5 {
  const currentIds = currentMissingEffortWorkloadFactIds(params.currentCompilation);
  if (currentIds.length === 0) {
    return {
      policyVersion: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_POLICY_VERSION_V5,
      source: null,
      workloadFactIds: [],
      minutesPerWorkload: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5,
    };
  }

  if (provisionalRequested(params.directive)) {
    return {
      policyVersion: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_POLICY_VERSION_V5,
      source: 'current_directive',
      workloadFactIds: currentIds,
      minutesPerWorkload: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5,
    };
  }

  if (params.previousStatus !== 'draft_ready') {
    return {
      policyVersion: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_POLICY_VERSION_V5,
      source: null,
      workloadFactIds: [],
      minutesPerWorkload: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5,
    };
  }

  const previousIds = new Set(graphMissingEffortWorkloadFactIds(params.previousGraph));
  const carried = currentIds.filter((id) => previousIds.has(id));
  return {
    policyVersion: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_POLICY_VERSION_V5,
    source: carried.length > 0 ? 'draft_ready_carry_forward' : null,
    workloadFactIds: carried,
    minutesPerWorkload: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5,
  };
}

export function projectWeeklyPlanningProvisionalTimeboxGraphV5<
  T extends WeeklyPlanningGenericSchedulerGraphView,
>(params: {
  graph: T;
  resolution: WeeklyPlanningProvisionalTimeboxResolutionV5;
}): T {
  if (params.resolution.workloadFactIds.length === 0) return params.graph;
  const selected = new Set(params.resolution.workloadFactIds);
  const workloads = params.graph.workloads.map((workload) => {
    if (!selected.has(workload.id)) return workload;
    return {
      ...workload,
      amount: params.resolution.minutesPerWorkload,
      unitCode: 'minute' as const,
      unitLabel: '分',
      rangeStart: null,
      rangeEnd: null,
    };
  });
  return {
    ...params.graph,
    workloads,
  } as T;
}
