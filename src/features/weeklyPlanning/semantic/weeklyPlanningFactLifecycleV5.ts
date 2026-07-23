import type {
  PlanningFactLifecycleEntryV5,
  WeeklyPlanningFactDiffEntryV5,
  WeeklyPlanningFactGraphV5,
  WeeklyPlanningFactKindV5,
} from './weeklyPlanningFactGraphV5';

export interface WeeklyPlanningFactLifecycleGraphView {
  readonly factLifecycles?: ReadonlyArray<PlanningFactLifecycleEntryV5>;
}

export function activeWeeklyPlanningFactIdsV5(
  graph: WeeklyPlanningFactLifecycleGraphView,
): Set<string> | null {
  if (!graph.factLifecycles) return null;
  return new Set(
    graph.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId),
  );
}

export function isWeeklyPlanningFactActiveV5(
  graph: WeeklyPlanningFactLifecycleGraphView,
  factId: string,
): boolean {
  const activeIds = activeWeeklyPlanningFactIdsV5(graph);
  return activeIds === null || activeIds.has(factId);
}

export function filterActiveWeeklyPlanningFactsV5<T extends { id: string }>(
  graph: WeeklyPlanningFactLifecycleGraphView,
  facts: ReadonlyArray<T>,
): T[] {
  const activeIds = activeWeeklyPlanningFactIdsV5(graph);
  return activeIds === null
    ? [...facts]
    : facts.filter((fact) => activeIds.has(fact.id));
}

export function createActiveLifecycleEntriesV5(params: {
  added: ReadonlyArray<WeeklyPlanningFactDiffEntryV5>;
  revision: number;
}): PlanningFactLifecycleEntryV5[] {
  return params.added.map((entry) => ({
    factId: entry.id,
    status: 'active',
    createdRevision: params.revision,
    terminalRevision: null,
    supersededByFactId: null,
  }));
}

export function weeklyPlanningFactKindByIdV5(
  graph: WeeklyPlanningFactGraphV5,
): Map<string, WeeklyPlanningFactKindV5> {
  const kinds = new Map<string, WeeklyPlanningFactKindV5>();
  const register = (
    kind: WeeklyPlanningFactKindV5,
    facts: ReadonlyArray<{ id: string }>,
  ): void => {
    facts.forEach((fact) => kinds.set(fact.id, kind));
  };
  register('planning_window', graph.planningWindows);
  register('task', graph.tasks);
  register('study_context', graph.studyContexts);
  register('component', graph.components);
  register('workload', graph.workloads);
  register('effort_estimate', graph.effortEstimates);
  register('temporal_constraint', graph.temporalConstraints);
  register('task_date_rule', graph.taskDateRules);
  register('recurrence', graph.recurrences);
  register('relation', graph.relations);
  register('uncertainty', graph.uncertainties);
  register('correction_intent', graph.correctionIntents);
  register('decision_intent', graph.decisionIntents);
  register('availability_declaration', graph.availabilityDeclarations);
  register('constraint_source_request', graph.constraintSourceRequests);
  return kinds;
}
