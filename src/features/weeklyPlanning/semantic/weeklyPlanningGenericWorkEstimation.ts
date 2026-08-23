import type {
  EffortEstimateFact,
  WorkloadFact,
} from './weeklyPlanningFactGraph';
import {
  safeWeeklyPlanningComputedPositiveNumberV5,
} from './weeklyPlanningNumericSafetyV5';

export type GenericWorkItemEstimateBasis =
  | 'intrinsic_duration'
  | 'direct_effort'
  | 'observed_pace';

export interface GenericWorkItemEstimateResolution {
  estimatedMinutes: number | null;
  basis: GenericWorkItemEstimateBasis | null;
  sourceFactIds: string[];
  sourceWorkloadFactIds: string[];
  ambiguous: boolean;
}

function resolvedEstimate(params: {
  estimatedMinutes: number;
  basis: GenericWorkItemEstimateBasis;
  sourceFactIds?: string[];
  sourceWorkloadFactIds?: string[];
}): GenericWorkItemEstimateResolution {
  const safeMinutes = safeWeeklyPlanningComputedPositiveNumberV5(
    params.estimatedMinutes,
  );
  return {
    estimatedMinutes: safeMinutes,
    basis: safeMinutes === null ? null : params.basis,
    sourceFactIds: params.sourceFactIds ?? [],
    sourceWorkloadFactIds: params.sourceWorkloadFactIds ?? [],
    ambiguous: false,
  };
}

export function effortEstimateTargetsWorkload(
  estimate: EffortEstimateFact,
  workload: WorkloadFact,
): boolean {
  return estimate.taskId === workload.taskId
    && (estimate.targetFactId === workload.id
      || estimate.targetFactId === workload.taskId
      || estimate.targetFactId === workload.componentId);
}

function intrinsicEstimate(workload: WorkloadFact): GenericWorkItemEstimateResolution | null {
  if (workload.unitCode === 'minute') {
    return resolvedEstimate({
      estimatedMinutes: workload.amount,
      basis: 'intrinsic_duration',
    });
  }
  if (workload.unitCode === 'hour') {
    return resolvedEstimate({
      estimatedMinutes: workload.amount * 60,
      basis: 'intrinsic_duration',
    });
  }
  return null;
}

function directEstimate(params: {
  workload: WorkloadFact;
  estimates: ReadonlyArray<EffortEstimateFact>;
}): GenericWorkItemEstimateResolution {
  const matching = params.estimates.filter((estimate) =>
    effortEstimateTargetsWorkload(estimate, params.workload));
  const perUnit = matching.filter((estimate) =>
    estimate.kind === 'duration_per_unit' && estimate.unitCode === params.workload.unitCode);
  if (perUnit.length === 1) {
    return resolvedEstimate({
      estimatedMinutes: perUnit[0].minutes * params.workload.amount,
      basis: 'direct_effort',
      sourceFactIds: [perUnit[0].id],
    });
  }
  if (perUnit.length > 1) {
    return {
      estimatedMinutes: null,
      basis: null,
      sourceFactIds: perUnit.map((value) => value.id),
      sourceWorkloadFactIds: [],
      ambiguous: true,
    };
  }

  const total = matching.filter((estimate) => estimate.kind === 'total_duration');
  if (total.length === 1) {
    return resolvedEstimate({
      estimatedMinutes: total[0].minutes,
      basis: 'direct_effort',
      sourceFactIds: [total[0].id],
    });
  }
  if (total.length > 1) {
    return {
      estimatedMinutes: null,
      basis: null,
      sourceFactIds: total.map((value) => value.id),
      sourceWorkloadFactIds: [],
      ambiguous: true,
    };
  }

  const session = matching.filter((estimate) =>
    estimate.kind === 'session_duration' && estimate.unitCode === params.workload.unitCode);
  if (params.workload.unitCode === 'session' && session.length === 1) {
    return resolvedEstimate({
      estimatedMinutes: session[0].minutes * params.workload.amount,
      basis: 'intrinsic_duration',
      sourceFactIds: [session[0].id],
    });
  }
  if (params.workload.unitCode === 'session' && session.length > 1) {
    return {
      estimatedMinutes: null,
      basis: null,
      sourceFactIds: session.map((value) => value.id),
      sourceWorkloadFactIds: [],
      ambiguous: true,
    };
  }

  return {
    estimatedMinutes: null,
    basis: null,
    sourceFactIds: [],
    sourceWorkloadFactIds: [],
    ambiguous: false,
  };
}

function samePaceScope(left: WorkloadFact, right: WorkloadFact): boolean {
  return left.taskId === right.taskId
    && left.componentId === right.componentId
    && left.unitCode === right.unitCode;
}

export function findObservedPaceEvidenceQuestionTarget(params: {
  workload: WorkloadFact;
  workloads: ReadonlyArray<WorkloadFact>;
  estimates: ReadonlyArray<EffortEstimateFact>;
}): WorkloadFact | null {
  const completed = params.workloads.filter((candidate) =>
    candidate.quantityRole === 'completed'
    && candidate.amount > 0
    && samePaceScope(candidate, params.workload));
  if (completed.length !== 1) return null;

  const [candidate] = completed;
  const alreadyHasEstimate = params.estimates.some((estimate) =>
    estimate.taskId === candidate.taskId
    && estimate.targetFactId === candidate.id);
  return alreadyHasEstimate ? null : candidate;
}

function observedPaceEstimate(params: {
  workload: WorkloadFact;
  workloads: ReadonlyArray<WorkloadFact>;
  estimates: ReadonlyArray<EffortEstimateFact>;
}): GenericWorkItemEstimateResolution {
  if (params.workload.amount <= 0) {
    return {
      estimatedMinutes: null,
      basis: null,
      sourceFactIds: [],
      sourceWorkloadFactIds: [],
      ambiguous: false,
    };
  }
  const completed = params.workloads.filter((candidate) =>
    candidate.quantityRole === 'completed'
    && candidate.amount > 0
    && samePaceScope(candidate, params.workload));
  const evidence = completed.flatMap((completedWorkload) =>
    params.estimates
      .filter((estimate) =>
        estimate.taskId === completedWorkload.taskId
        && estimate.targetFactId === completedWorkload.id
        && (
          estimate.kind === 'total_duration'
          || (
            estimate.kind === 'duration_per_unit'
            && estimate.unitCode === completedWorkload.unitCode
          )
        ))
      .map((estimate) => ({ completedWorkload, estimate })));
  if (evidence.length !== 1) {
    return {
      estimatedMinutes: null,
      basis: null,
      sourceFactIds: evidence.map(({ estimate }) => estimate.id),
      sourceWorkloadFactIds: evidence.map(({ completedWorkload }) => completedWorkload.id),
      ambiguous: evidence.length > 1,
    };
  }
  const [{ completedWorkload, estimate }] = evidence;
  const paceMinutes = estimate.kind === 'duration_per_unit'
    ? estimate.minutes
    : estimate.minutes / completedWorkload.amount;
  return resolvedEstimate({
    estimatedMinutes: paceMinutes * params.workload.amount,
    basis: 'observed_pace',
    sourceFactIds: [estimate.id],
    sourceWorkloadFactIds: [completedWorkload.id],
  });
}

export function resolveGenericWorkItemEstimate(params: {
  workload: WorkloadFact;
  workloads: ReadonlyArray<WorkloadFact>;
  estimates: ReadonlyArray<EffortEstimateFact>;
}): GenericWorkItemEstimateResolution {
  const intrinsic = intrinsicEstimate(params.workload);
  if (intrinsic) return intrinsic;
  const direct = directEstimate({
    workload: params.workload,
    estimates: params.estimates,
  });
  if (direct.ambiguous || direct.estimatedMinutes !== null) return direct;
  return observedPaceEstimate(params);
}
