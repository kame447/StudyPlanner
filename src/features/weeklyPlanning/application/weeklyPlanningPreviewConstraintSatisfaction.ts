import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';
import type { GenericPlanningWorkItem } from '../semantic/weeklyPlanningGenericWorkItems';
import type { GenericSchedulerInput, WeeklyPlanningGenericSchedulerGraphView } from '../semantic/weeklyPlanningGenericSchedulerInput';
import { resolveWeeklyPlanningWorkItemSessionDurationV5 } from '../semantic/weeklyPlanningSchedulerWorkDistributionV5';
import type { WeeklyPlanningStableV5PreviewProvenance } from '../weeklyPlanningPreviewProvenance';

export interface WeeklyPlanningPreviewConstraintSatisfaction {
  sourceFactId: string;
  taskId: string;
  taskLabel: string;
  kind: 'session_duration';
  status: 'satisfied' | 'not_satisfied' | 'not_evaluated';
}

function metadata(candidate: WeeklyDraftCandidate): WeeklyPlanningStableV5PreviewProvenance | undefined {
  return (candidate as WeeklyDraftCandidate & { stableV5Metadata?: WeeklyPlanningStableV5PreviewProvenance }).stableV5Metadata;
}

function minutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

/**
 * Read-only evidence about the actual new preview, never a second interpretation of the
 * user's language. Accepted preferences alone cannot prove that placement honored them.
 * Call with the active scheduler graph and the candidates actually exposed by the turn.
 */
export function projectWeeklyPlanningPreviewConstraintSatisfaction(params: {
  graph: WeeklyPlanningGenericSchedulerGraphView;
  schedulerInput: GenericSchedulerInput;
  candidates: readonly WeeklyDraftCandidate[];
}): WeeklyPlanningPreviewConstraintSatisfaction[] {
  const { graph, schedulerInput, candidates } = params;
  const result: WeeklyPlanningPreviewConstraintSatisfaction[] = [];
  const taskLabel = (taskId: string) => graph.tasks.find(task => task.id === taskId)?.title ?? taskId;
  const candidatesFor = (items: readonly GenericPlanningWorkItem[]) => candidates.filter(candidate =>
    items.some(item => item.id === candidate.workItemKey
      && metadata(candidate)?.taskId === item.taskId
      && metadata(candidate)?.graphRevision === schedulerInput.graphRevision));

  for (const fact of graph.effortEstimates.filter(fact => fact.kind === 'session_duration')) {
    // Use the same typed specificity policy as compilation. An overridden task preference
    // must not be reported as a failed condition for a more specific component/workload.
    const items = schedulerInput.movableWorkItems.filter(item =>
      resolveWeeklyPlanningWorkItemSessionDurationV5({ item, estimates: graph.effortEstimates }).sourceFactIds.includes(fact.id));
    if (items.length === 0) continue;
    const scheduled = candidatesFor(items);
    const status = scheduled.length === 0 || !items.every(item => item.sourceFactRefs.includes(fact.id))
      || !scheduled.every(candidate => metadata(candidate)?.sourceFactRefs.includes(fact.id))
      ? 'not_evaluated'
      : scheduled.every(candidate => candidate.durationMinutes <= fact.minutes
        && candidate.durationMinutes === minutes(candidate.endTime) - minutes(candidate.startTime))
        && items.every(item => {
          const sessions = scheduled.filter(candidate => candidate.workItemKey === item.id);
          return sessions.length === 1 && sessions[0].durationMinutes === item.estimatedMinutes;
        })
        ? 'satisfied' : 'not_satisfied';
    result.push({ sourceFactId: fact.id, taskId: fact.taskId, taskLabel: taskLabel(fact.taskId), kind: 'session_duration', status });
  }
  return result;
}
