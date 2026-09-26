import {
  filterActiveWeeklyPlanningFactsV5,
} from './weeklyPlanningFactLifecycleV5';
import type {
  WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import type {
  WeeklyPlanningGenericSchedulerGraphView,
} from './weeklyPlanningGenericSchedulerInput';
import {
  projectWeeklyPlanningSchedulerAvailabilityDeclarationsV5,
} from './weeklyPlanningSchedulerAvailabilityProjectionV5';

export type WeeklyPlanningActiveSchedulerGraphViewV5 =
  WeeklyPlanningGenericSchedulerGraphView
  & {
    readonly studyContexts: ReadonlyArray<WeeklyPlanningFactGraphV5['studyContexts'][number]>;
  };

export function createWeeklyPlanningActiveSchedulerGraphViewV5(
  graph: WeeklyPlanningFactGraphV5,
): WeeklyPlanningActiveSchedulerGraphViewV5 {
  const activeAvailabilityDeclarations = filterActiveWeeklyPlanningFactsV5(
    graph,
    graph.availabilityDeclarations,
  );
  const availabilityDeclarations = [
    ...projectWeeklyPlanningSchedulerAvailabilityDeclarationsV5(activeAvailabilityDeclarations),
    ...activeAvailabilityDeclarations.filter((declaration) => declaration.kind === 'capacity'),
  ];

  return {
    revision: graph.revision,
    planningWindows: filterActiveWeeklyPlanningFactsV5(graph, graph.planningWindows),
    tasks: filterActiveWeeklyPlanningFactsV5(graph, graph.tasks),
    studyContexts: filterActiveWeeklyPlanningFactsV5(graph, graph.studyContexts),
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
