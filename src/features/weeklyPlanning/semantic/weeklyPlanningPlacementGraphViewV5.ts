import {
  filterActiveWeeklyPlanningFactsV5,
} from './weeklyPlanningFactLifecycleV5';
import type {
  WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';

export interface WeeklyPlanningPlacementGraphViewV5 {
  readonly tasks: ReadonlyArray<WeeklyPlanningFactGraphV5['tasks'][number]>;
  readonly studyContexts: ReadonlyArray<WeeklyPlanningFactGraphV5['studyContexts'][number]>;
  readonly components: ReadonlyArray<WeeklyPlanningFactGraphV5['components'][number]>;
  readonly workloads: ReadonlyArray<WeeklyPlanningFactGraphV5['workloads'][number]>;
}

export function createWeeklyPlanningPlacementGraphViewV5(
  graph: WeeklyPlanningFactGraphV5,
): WeeklyPlanningPlacementGraphViewV5 {
  return {
    tasks: filterActiveWeeklyPlanningFactsV5(graph, graph.tasks),
    studyContexts: filterActiveWeeklyPlanningFactsV5(graph, graph.studyContexts),
    components: filterActiveWeeklyPlanningFactsV5(graph, graph.components),
    workloads: filterActiveWeeklyPlanningFactsV5(graph, graph.workloads),
  };
}
