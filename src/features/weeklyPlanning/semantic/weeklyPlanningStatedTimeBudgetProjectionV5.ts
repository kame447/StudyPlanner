import type {
  WeeklyPlanningGenericSchedulerGraphView,
} from './weeklyPlanningGenericSchedulerInput';
import type { GenericTaskTotalDurationSource } from './weeklyPlanningGenericWorkItems';

const STATED_TIME_BUDGET_WORKLOAD_ID_PREFIX = 'wpsb_';

type ProjectedWorkload = WeeklyPlanningGenericSchedulerGraphView['workloads'][number];

/**
 * Consume an accepted task total in the scheduler-facing view when no workload
 * exists. Choosing future total work rather than past progress or session length
 * remains the semantic owner's responsibility; this projection never reads text.
 * The exact accepted minutes and evidence are retained without changing the
 * canonical graph. Any workload, including progress on a component, suppresses
 * the projection so the existing quantity/effort rules remain authoritative.
 */
function statedTimeBudgetWorkloads(
  graph: WeeklyPlanningGenericSchedulerGraphView,
): Array<{ workload: ProjectedWorkload; source: GenericTaskTotalDurationSource }> {
  const tasksWithWorkload = new Set(graph.workloads.map((workload) => workload.taskId));
  const fixedIntervalTasks = new Set(graph.temporalConstraints
    .filter((constraint) =>
      constraint.targetFactId === constraint.taskId
      && constraint.kind === 'fixed_interval'
      && constraint.constraintLevel === 'hard')
    .map((constraint) => constraint.taskId));

  return graph.tasks.flatMap((task): Array<{ workload: ProjectedWorkload; source: GenericTaskTotalDurationSource }> => {
    if (tasksWithWorkload.has(task.id) || fixedIntervalTasks.has(task.id)) return [];
    const budgets = graph.effortEstimates
      .filter((estimate) =>
        estimate.taskId === task.id
        && estimate.targetFactId === task.id
        && estimate.kind === 'total_duration'
        && Number.isFinite(estimate.minutes)
        && estimate.minutes > 0)
      .sort((left, right) => left.id.localeCompare(right.id));
    // Identical restatements agree; conflicting totals stay unresolved.
    if (budgets.length === 0 || new Set(budgets.map((estimate) => estimate.minutes)).size !== 1) {
      return [];
    }
    const budget = budgets[0];
    const id = `${STATED_TIME_BUDGET_WORKLOAD_ID_PREFIX}${budget.id}`;
    return [{ workload: {
      derivationKind: 'task_total_duration',
      id,
      taskId: task.id,
      componentId: null,
      quantityRole: 'target',
      amount: budget.minutes,
      unitCode: 'minute',
      unitLabel: '分',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      source: budget.source,
      createdRevision: budget.createdRevision,
    }, source: {
      kind: 'task_total_duration', derivedWorkloadId: id, taskId: task.id,
      graphRevision: graph.revision, effortEstimateFactIds: budgets.map((estimate) => estimate.id),
    } }];
  });
}

export function projectWeeklyPlanningStatedTimeBudgetGraphV5<
  TGraph extends WeeklyPlanningGenericSchedulerGraphView,
>(graph: TGraph): TGraph {
  const projected = statedTimeBudgetWorkloads(graph);
  if (projected.length === 0) return graph;
  return {
    ...graph,
    workloads: [...graph.workloads, ...projected.map((entry) => entry.workload)],
    derivedWorkloadSources: [
      ...(graph.derivedWorkloadSources ?? []), ...projected.map((entry) => entry.source),
    ],
  };
}
