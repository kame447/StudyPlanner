import {
  filterActiveWeeklyPlanningFactsV5,
} from './weeklyPlanningFactLifecycleV5';
import type {
  AvailabilityDeclarationFactV5,
  WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import type {
  WeeklyPlanningGenericSchedulerGraphView,
} from './weeklyPlanningGenericSchedulerInput';

type SchedulerAvailabilityDeclarationV5 = AvailabilityDeclarationFactV5 & {
  kind: 'available' | 'unavailable' | 'preferred' | 'avoided';
};

function isSchedulerAvailabilityDeclarationV5(
  declaration: AvailabilityDeclarationFactV5,
): declaration is SchedulerAvailabilityDeclarationV5 {
  if (declaration.kind === 'no_additional_constraint') return false;

  // A hard positive availability fact without an actual time window cannot
  // narrow placement. Preserve it in the Fact Graph as user meaning, but do not
  // turn it into a resolver question or rewrite the semantic response.
  if (
    declaration.kind === 'available'
    && declaration.constraintLevel === 'hard'
    && declaration.namedTimePeriod === null
    && declaration.startTime === null
    && declaration.endTime === null
    && declaration.recurrenceKind === null
  ) return false;

  return true;
}

export function createWeeklyPlanningActiveSchedulerGraphViewV5(
  graph: WeeklyPlanningFactGraphV5,
): WeeklyPlanningGenericSchedulerGraphView {
  const availabilityDeclarations = filterActiveWeeklyPlanningFactsV5(
    graph,
    graph.availabilityDeclarations,
  ).filter(isSchedulerAvailabilityDeclarationV5);

  return {
    revision: graph.revision,
    planningWindows: filterActiveWeeklyPlanningFactsV5(graph, graph.planningWindows),
    tasks: filterActiveWeeklyPlanningFactsV5(graph, graph.tasks),
    components: filterActiveWeeklyPlanningFactsV5(graph, graph.components),
    workloads: filterActiveWeeklyPlanningFactsV5(graph, graph.workloads),
    effortEstimates: filterActiveWeeklyPlanningFactsV5(graph, graph.effortEstimates),
    temporalConstraints: filterActiveWeeklyPlanningFactsV5(
      graph,
      graph.temporalConstraints,
    ),
    taskDateRules: filterActiveWeeklyPlanningFactsV5(graph, graph.taskDateRules),
    recurrences: filterActiveWeeklyPlanningFactsV5(graph, graph.recurrences),
    relations: filterActiveWeeklyPlanningFactsV5(graph, graph.relations),
    uncertainties: filterActiveWeeklyPlanningFactsV5(graph, graph.uncertainties),
    availabilityDeclarations,
    constraintSourceRequests: filterActiveWeeklyPlanningFactsV5(
      graph,
      graph.constraintSourceRequests,
    ),
  };
}
