import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';
import type { GenericPlanningWorkItem } from '../semantic/weeklyPlanningGenericWorkItems';
import type { GenericSchedulerInput, WeeklyPlanningGenericSchedulerGraphView } from '../semantic/weeklyPlanningGenericSchedulerInput';
import { resolveWeeklyPlanningWorkItemSessionDurationV5 } from '../semantic/weeklyPlanningSchedulerWorkDistributionV5';
import type { WeeklyPlanningStableV5PreviewProvenance } from '../weeklyPlanningPreviewProvenance';

export interface WeeklyPlanningPreviewConstraintSatisfaction {
  sourceFactId: string;
  taskId: string;
  taskLabel: string;
  kind: 'preferred_window' | 'session_duration';
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

  function windowSatisfaction(facts: readonly {
    id: string; startTime: string | null; endTime: string | null; namedTimePeriod: string | null;
  }[], taskId: string, items: readonly GenericPlanningWorkItem[]) {
    const sourceIds = new Set(facts.map(fact => fact.id));
    const placements = schedulerInput.preferredPlacements.filter(placement =>
      sourceIds.has(placement.sourceFactId) && placement.taskId === taskId);
    const scheduled = candidatesFor(items);
    const usable = facts.every(fact => {
      const compiled = placements.filter(placement => placement.sourceFactId === fact.id);
      const needsClockWindow = Boolean(fact.startTime || fact.endTime || fact.namedTimePeriod);
      return compiled.length > 0 && (!needsClockWindow || compiled.every(placement => placement.window !== null));
    });
    const hasCurrentSources = graph.revision === schedulerInput.graphRevision
      && items.every(item => item.sourceFactRefs.includes(item.taskId)
        && (!item.componentId || item.sourceFactRefs.includes(item.componentId)))
      && scheduled.every(candidate => {
        const item = items.find(entry => entry.id === candidate.workItemKey)!;
        return item.sourceFactRefs.every(source => metadata(candidate)?.sourceFactRefs.includes(source));
      });
    const status = !usable || !hasCurrentSources || items.length === 0 || scheduled.length === 0 ? 'not_evaluated'
      : scheduled.every(candidate => {
        const item = items.find(entry => entry.id === candidate.workItemKey)!;
        return candidate.durationMinutes > 0
          && candidate.durationMinutes === minutes(candidate.endTime) - minutes(candidate.startTime)
          && placements.some(placement =>
            placement.targetFactId === (item.componentId ?? item.taskId)
            && placement.dates.includes(candidate.date)
            && (!placement.window || (minutes(candidate.startTime) >= placement.window.startMinute
              && minutes(candidate.endTime) <= placement.window.endMinute)));
      }) && items.every(item => {
        const allocated = scheduled.filter(candidate => candidate.workItemKey === item.id);
        const ordered = [...allocated].sort((left, right) => left.date.localeCompare(right.date)
          || minutes(left.startTime) - minutes(right.startTime));
        return allocated.length > 0
          && allocated.reduce((total, candidate) => total + candidate.durationMinutes, 0) === item.estimatedMinutes
          && ordered.every((candidate, index) => index === 0 || candidate.date !== ordered[index - 1].date
            || minutes(candidate.startTime) >= minutes(ordered[index - 1].endTime));
      })
        ? 'satisfied' : 'not_satisfied';
    for (const fact of facts) {
      result.push({ sourceFactId: fact.id, taskId, taskLabel: taskLabel(taskId), kind: 'preferred_window', status });
    }
  }

  // Applicable windows are alternatives, as in placement search. A Monday candidate need
  // not also occupy each other weekday. Target matching above keeps components independent.
  const taskPreferences = graph.temporalConstraints.filter(fact => fact.kind === 'preferred_window');
  const planPreferences = graph.availabilityDeclarations.filter(fact => fact.kind === 'preferred'
    || (fact.kind === 'available' && fact.constraintLevel === 'soft'));
  const taskIds = new Set([...taskPreferences.map(fact => fact.taskId), ...schedulerInput.movableWorkItems.map(item => item.taskId)]);
  for (const taskId of taskIds) {
    const scoped = taskPreferences.filter(fact => fact.taskId === taskId);
    const alternatives = [...scoped, ...planPreferences];
    if (alternatives.length === 0) continue;
    const items = schedulerInput.movableWorkItems.filter(item => item.taskId === taskId
      && (planPreferences.length > 0 || scoped.some(fact => fact.targetFactId === item.taskId || fact.targetFactId === item.componentId)));
    windowSatisfaction(alternatives, taskId, items);
  }
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
