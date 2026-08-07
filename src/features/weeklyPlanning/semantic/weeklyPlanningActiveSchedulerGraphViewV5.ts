import {
  filterActiveWeeklyPlanningFactsV5,
} from './weeklyPlanningFactLifecycleV5';
import type {
  WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import type {
  WeeklyPlanningGenericSchedulerGraphView,
} from './weeklyPlanningGenericSchedulerInput';

export function createWeeklyPlanningActiveSchedulerGraphViewV5(
  graph: WeeklyPlanningFactGraphV5,
): WeeklyPlanningGenericSchedulerGraphView {
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
    availabilityDeclarations: filterActiveWeeklyPlanningFactsV5(
      graph,
      graph.availabilityDeclarations,
    ),
    constraintSourceRequests: filterActiveWeeklyPlanningFactsV5(
      graph,
      graph.constraintSourceRequests,
    ),
  };
}
