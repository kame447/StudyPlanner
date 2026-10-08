import { conversationArchitecturePolicy, type WeeklyPlanningConversationArchitecture } from '../weeklyPlanningConversationArchitecture';
import type { GenericSchedulerInputCompilationResult } from '../semantic/weeklyPlanningGenericSchedulerInput';
import type { WeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';

/** Window questions remain in the fact graph. They have no placement consequence
 * while no study task exists, and automatically block again when study resumes.
 * All task/component/workload/commitment details retain their compiler authority. */
function projectWeeklyPlanningWindowQuestionSuspension(params: {
  graph: WeeklyPlanningActiveSchedulerGraphViewV5;
  architecture?: WeeklyPlanningConversationArchitecture;
}): WeeklyPlanningActiveSchedulerGraphViewV5 {
  const { graph } = params;
  if (!conversationArchitecturePolicy(params.architecture).interactionOutcome
    || graph.tasks.some(task => task.category === 'study')) return graph;
  const windows = new Set(graph.planningWindows.map(window => window.id));
  const uncertainties = graph.uncertainties.filter(need => !need.targetFactId || !windows.has(need.targetFactId));
  return uncertainties.length === graph.uncertainties.length ? graph : { ...graph, uncertainties };
}

/** Never infer absence of work from a blocked compiler's null input. The
 * hypothetical view must positively compile as empty or completely fixed. */
export function compileWithWeeklyPlanningWindowQuestionSuspension(params: {
  graph: WeeklyPlanningActiveSchedulerGraphViewV5;
  architecture?: WeeklyPlanningConversationArchitecture;
  compile: (graph: WeeklyPlanningActiveSchedulerGraphViewV5) => GenericSchedulerInputCompilationResult;
}): GenericSchedulerInputCompilationResult {
  const projected = projectWeeklyPlanningWindowQuestionSuspension(params);
  if (projected === params.graph) return params.compile(params.graph);
  const result = params.compile(projected);
  const resolvedEmpty = result.status === 'empty' && projected.tasks.length === 0;
  const fixedOnly = result.status === 'ready' && result.input !== null
    && result.input.movableWorkItems.length === 0
    && projected.tasks.every(task => result.input!.fixedTaskReservations.some(reservation => reservation.taskId === task.id));
  return !result.issues.some(issue => issue.blocking) && (resolvedEmpty || fixedOnly)
    ? result : params.compile(params.graph);
}
