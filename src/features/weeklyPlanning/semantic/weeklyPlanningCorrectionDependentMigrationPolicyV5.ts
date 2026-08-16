import type {
  EffortEstimateFactV5,
  WeeklyPlanningFactGraphV5,
  WorkloadFactV5,
} from './weeklyPlanningFactGraphV5';

export type WeeklyPlanningWorkloadDependentFactKindV5 =
  | 'effort_estimate'
  | 'temporal_constraint'
  | 'task_date_rule'
  | 'recurrence'
  | 'uncertainty';

export interface WeeklyPlanningWorkloadDependentFactV5 {
  kind: WeeklyPlanningWorkloadDependentFactKindV5;
  factId: string;
}

export type WeeklyPlanningDependentMigrationDecisionV5 =
  | { action: 'carry'; reason: string }
  | { action: 'invalidate'; reason: string }
  | { action: 'reject'; reason: string };

function activeFactIds(graph: WeeklyPlanningFactGraphV5): Set<string> {
  return new Set(
    graph.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId),
  );
}

export function activeWeeklyPlanningWorkloadDependentsV5(params: {
  graph: WeeklyPlanningFactGraphV5;
  workloadFactId: string;
}): WeeklyPlanningWorkloadDependentFactV5[] {
  const activeIds = activeFactIds(params.graph);
  const dependents: WeeklyPlanningWorkloadDependentFactV5[] = [];
  const add = (
    kind: WeeklyPlanningWorkloadDependentFactKindV5,
    factId: string,
    targetFactId: string | null,
  ): void => {
    if (activeIds.has(factId) && targetFactId === params.workloadFactId) {
      dependents.push({ kind, factId });
    }
  };

  params.graph.effortEstimates.forEach((fact) =>
    add('effort_estimate', fact.id, fact.targetFactId));
  params.graph.temporalConstraints.forEach((fact) =>
    add('temporal_constraint', fact.id, fact.targetFactId));
  params.graph.taskDateRules.forEach((fact) =>
    add('task_date_rule', fact.id, fact.targetFactId));
  params.graph.recurrences.forEach((fact) =>
    add('recurrence', fact.id, fact.targetFactId));
  params.graph.uncertainties.forEach((fact) =>
    add('uncertainty', fact.id, fact.targetFactId));

  return dependents.sort((left, right) =>
    left.kind.localeCompare(right.kind) || left.factId.localeCompare(right.factId));
}

function effortMigrationDecision(params: {
  effort: EffortEstimateFactV5;
  target: WorkloadFactV5;
  replacement: WorkloadFactV5;
}): WeeklyPlanningDependentMigrationDecisionV5 {
  if (params.effort.kind === 'session_duration') {
    return {
      action: 'carry',
      reason: 'session-duration-is-independent-of-total-workload-amount',
    };
  }
  if (
    params.effort.kind === 'duration_per_unit'
    && params.target.unitCode === params.replacement.unitCode
  ) {
    return {
      action: 'carry',
      reason: 'per-unit-duration-keeps-the-same-unit',
    };
  }
  return {
    action: 'invalidate',
    reason: params.effort.kind === 'total_duration'
      ? 'total-duration-depends-on-replaced-workload-amount'
      : 'per-unit-duration-unit-changed',
  };
}

/**
 * Correction dependency policy for replacing one workload with another.
 *
 * Every active fact kind that can target a workload must have an explicit
 * decision here. Unknown semantic carry rules fail closed instead of being
 * silently rebound by generic lifecycle code.
 */
export function decideWeeklyPlanningWorkloadDependentMigrationV5(params: {
  graph: WeeklyPlanningFactGraphV5;
  dependent: WeeklyPlanningWorkloadDependentFactV5;
  target: WorkloadFactV5;
  replacement: WorkloadFactV5;
}): WeeklyPlanningDependentMigrationDecisionV5 {
  if (params.dependent.kind === 'effort_estimate') {
    const effort = params.graph.effortEstimates.find(
      (fact) => fact.id === params.dependent.factId,
    );
    if (!effort) {
      return { action: 'reject', reason: 'dependent-effort-fact-missing' };
    }
    return effortMigrationDecision({
      effort,
      target: params.target,
      replacement: params.replacement,
    });
  }

  switch (params.dependent.kind) {
    case 'temporal_constraint':
      return {
        action: 'reject',
        reason: 'temporal-constraint-rebinding-needs-explicit-semantic-policy',
      };
    case 'task_date_rule':
      return {
        action: 'reject',
        reason: 'task-date-rule-rebinding-needs-explicit-semantic-policy',
      };
    case 'recurrence':
      return {
        action: 'reject',
        reason: 'recurrence-rebinding-needs-explicit-semantic-policy',
      };
    case 'uncertainty':
      return {
        action: 'reject',
        reason: 'uncertainty-rebinding-needs-explicit-semantic-policy',
      };
  }
}
