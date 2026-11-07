// Evaluation only: compare accepted typed dates, never reinterpret the user's words.
import { resolveWeeklyPlanningAcceptedPlanningWindow, type WeeklyPlanningTurnRequestContext } from '../application/weeklyPlanningTemporalContext';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { resolveCanonicalDateExpression } from '../semantic/weeklyPlanningCalendarResolver';
import type { WeeklyPlanningFactGraphV5 } from '../vnext/weeklyPlanningVNextV5Boundary';

export interface RealApiDateMeaningOracle {
  planningWindow?: { startDate: string; endDate: string };
  workDate?: { task: string; date: string };
  recurrence?: { kind: 'weekly'; days: string[]; startDate: string };
}

export function compareRealApiDateMeaning(params: {
  oracle: RealApiDateMeaningOracle | undefined;
  graph: WeeklyPlanningFactGraphV5;
  requestContext: WeeklyPlanningTurnRequestContext;
  /** Workload-oracle bindings, independent of model-generated titles. */
  taskIdsByKey?: ReadonlyMap<string, string>;
}): string[] {
  const { oracle, requestContext } = params;
  if (!oracle) return [];
  const graph = createWeeklyPlanningActiveSchedulerGraphViewV5(params.graph);
  const window = resolveWeeklyPlanningAcceptedPlanningWindow({ graph, requestContext });
  const resolve = (expression: string | null) => expression === null ? null : resolveCanonicalDateExpression({
    expression, currentDate: requestContext.currentDate, weekStartsOn: requestContext.weekStartsOn,
  }).range;
  const differences: string[] = [];
  if (oracle.planningWindow && (window?.startDate !== oracle.planningWindow.startDate || window?.endDate !== oracle.planningWindow.endDate)) {
    differences.push(`planning window expected=${oracle.planningWindow.startDate}/${oracle.planningWindow.endDate}`);
  }
  if (oracle.workDate) {
    const { task, date } = oracle.workDate;
    const taskId = params.taskIdsByKey?.get(task);
    const bounds = graph.temporalConstraints.filter(fact => fact.taskId === taskId
      && (fact.kind === 'deadline' || fact.kind === 'latest_end'));
    // A stated day can be a deadline, an end bound or a single-day window. An
    // unrelated task's date and a conflicting hard bound are not equivalent.
    const hasDate = bounds.some(fact => resolve(fact.dateExpression)?.end === date)
      || (window?.startDate === date && window.endDate === date);
    const conflictingHardDate = bounds.some(fact => fact.constraintLevel === 'hard'
      && resolve(fact.dateExpression)?.end !== date);
    if (!taskId || !hasDate || conflictingHardDate) differences.push(`work date missing or conflicting for ${task}: ${date}`);
  }
  if (oracle.recurrence) {
    const expected = oracle.recurrence;
    const taskId = graph.tasks.length === 1 ? graph.tasks[0].id : null;
    const recurrence = graph.recurrences.length === 1 ? graph.recurrences[0] : null;
    if (!taskId || recurrence?.taskId !== taskId || recurrence.kind !== expected.kind
      || recurrence.count !== null || [...recurrence.days].sort().join(',') !== [...expected.days].sort().join(',')) {
      differences.push('weekly recurrence differs');
    }
    const startIsKept = graph.temporalConstraints.some(fact => fact.taskId === taskId && fact.kind === 'earliest_start'
      && resolve(fact.dateExpression)?.start === expected.startDate)
      || window?.startDate === expected.startDate;
    if (!startIsKept) differences.push(`recurrence start missing: ${expected.startDate}`);
  }
  return differences;
}
