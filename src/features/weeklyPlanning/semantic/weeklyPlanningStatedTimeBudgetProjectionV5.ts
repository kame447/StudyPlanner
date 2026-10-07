import type {
  WeeklyPlanningGenericSchedulerGraphView,
} from './weeklyPlanningGenericSchedulerInput';

export const WEEKLY_PLANNING_STATED_TIME_BUDGET_PROJECTION_VERSION_V5 =
  'weekly-planning-stated-time-budget-projection-v1' as const;

const STATED_TIME_BUDGET_WORKLOAD_ID_PREFIX = 'wpsb_';

type ProjectedWorkload = WeeklyPlanningGenericSchedulerGraphView['workloads'][number];

/**
 * A user-stated total time for a task that has no content quantity at all (「卒研を合計2時間」)
 * is the time budget of that task. The semantic layer may type it as the task's
 * `total_duration` cost instead of a minute/hour `target` workload; both mean "schedule this
 * much time on this task". Without this projection the task has no schedulable work, so the
 * application keeps asking for a content quantity the user has explicitly declined to give.
 *
 * Scheduler-facing projection only (like the provisional timebox): nothing is persisted and
 * the semantic graph is unchanged. It applies only while the task has no workload of any role
 * on the task or its components; once a content quantity is accepted the same estimate is
 * that quantity's cost again and the projection disappears. No quantity or duration is
 * invented: the amount is exactly the accepted estimate, with its own source evidence.
 */
function statedTimeBudgetWorkloads(
  graph: WeeklyPlanningGenericSchedulerGraphView,
): ProjectedWorkload[] {
  const tasksWithWorkload = new Set(graph.workloads.map((workload) => workload.taskId));
  const fixedIntervalTasks = new Set(graph.temporalConstraints
    .filter((constraint) =>
      constraint.targetFactId === constraint.taskId
      && constraint.kind === 'fixed_interval'
      && constraint.constraintLevel === 'hard')
    .map((constraint) => constraint.taskId));

  return graph.tasks.flatMap((task): ProjectedWorkload[] => {
    if (tasksWithWorkload.has(task.id) || fixedIntervalTasks.has(task.id)) return [];
    const budgets = graph.effortEstimates
      .filter((estimate) =>
        estimate.taskId === task.id
        && estimate.targetFactId === task.id
        && estimate.kind === 'total_duration'
        && Number.isFinite(estimate.minutes)
        && estimate.minutes > 0)
      .sort((left, right) => left.id.localeCompare(right.id));
    // Two different accepted totals for the same task are contradictory; leave them to the
    // existing resolution flow instead of choosing one.
    if (budgets.length === 0 || new Set(budgets.map((estimate) => estimate.minutes)).size !== 1) {
      return [];
    }
    const budget = budgets[0];
    return [{
      id: `${STATED_TIME_BUDGET_WORKLOAD_ID_PREFIX}${budget.id}`,
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
    }];
  });
}

export function projectWeeklyPlanningStatedTimeBudgetGraphV5<
  TGraph extends WeeklyPlanningGenericSchedulerGraphView,
>(graph: TGraph): TGraph {
  const projected = statedTimeBudgetWorkloads(graph);
  if (projected.length === 0) return graph;
  return { ...graph, workloads: [...graph.workloads, ...projected] };
}
