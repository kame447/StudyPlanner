import type {
  WeeklyPlanningActiveSchedulerGraphViewV5,
} from './weeklyPlanningActiveSchedulerGraphViewV5';

declare const weeklyPlanningPlacementGraphViewBrand: unique symbol;

export type WeeklyPlanningPlacementGraphViewV5 = Pick<
  WeeklyPlanningActiveSchedulerGraphViewV5,
  'tasks' | 'studyContexts' | 'components' | 'workloads'
> & {
  readonly [weeklyPlanningPlacementGraphViewBrand]: true;
};

export function createWeeklyPlanningPlacementGraphViewV5(
  graph: WeeklyPlanningActiveSchedulerGraphViewV5,
): WeeklyPlanningPlacementGraphViewV5 {
  return {
    tasks: graph.tasks,
    studyContexts: graph.studyContexts,
    components: graph.components,
    workloads: graph.workloads,
  } as WeeklyPlanningPlacementGraphViewV5;
}
