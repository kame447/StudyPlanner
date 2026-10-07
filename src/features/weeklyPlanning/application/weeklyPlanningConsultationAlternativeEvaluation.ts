import { placementCandidateBlocks } from '../semantic/weeklyPlanningStableV5PlacementCandidates';
import type { SemanticConversationActV5 } from '../semantic/weeklyPlanningConversationActsV5';
import type { GenericSchedulerInputCompilationResult } from '../semantic/weeklyPlanningGenericSchedulerInput';
import type { WeeklyPlanningPlacementGraphViewV5 } from '../semantic/weeklyPlanningPlacementGraphViewV5';
import { calendarWeekday, canonicalWeekdayIndex, listCalendarDatesInclusive, resolveCanonicalDateExpression } from '../semantic/weeklyPlanningCalendarResolver';
import { weeklyPlanningEvidenceChannelForSourceTextV5 } from '../semantic/weeklyPlanningCurrentTurnProvenanceV5';
import { scheduleWeeklyPlanningStableV5Preview } from '../semantic/weeklyPlanningStableV5PreviewScheduler';
import type { ExecuteWeeklyPlanningStableV5RuntimeTurnInput } from './weeklyPlanningStableV5RuntimeContracts';
import type { WeeklyPlanningTurnRequestContext } from './weeklyPlanningTemporalContext';

export interface WeeklyPlanningConsultationAlternativeEvidence {
  alternative?: { scope: 'task' | 'plan'; taskIds: string[]; taskLabels: string[]; dates: string[] };
  feasibility:
    | { status: 'fits' | 'does_not_fit'; basis: 'alternative_scheduler' }
    | { status: 'not_evaluated'; reason: 'planning_details_missing' | 'no_schedulable_work'
        | 'ambiguous_alternative' | 'invalid_alternative' | 'alternative_not_grounded' | 'alternative_target_unavailable'
        | 'alternative_outside_horizon' | 'fixed_work_not_movable' };
}

/** A bounded, read-only scheduler query. It never installs a fact or publishes a preview. */
export function evaluateWeeklyPlanningConsultationAlternative(params: {
  acts: readonly SemanticConversationActV5[] | undefined;
  compilation: GenericSchedulerInputCompilationResult;
  graph: WeeklyPlanningPlacementGraphViewV5;
  input: Pick<ExecuteWeeklyPlanningStableV5RuntimeTurnInput, 'userText' | 'plans' | 'scheduleTemplates' | 'timetableTermId'>;
  requestContext: WeeklyPlanningTurnRequestContext;
}): WeeklyPlanningConsultationAlternativeEvidence | null {
  const acts = (params.acts ?? []).filter(act => act.kind === 'consultation_request' && act.placementAlternative);
  const act = acts[0];
  if (!act?.placementAlternative) return null;
  const proposal = act.placementAlternative;
  if ('unavailable' in proposal) return { feasibility: { status: 'not_evaluated',
    reason: proposal.unavailable === 'unknown_target' ? 'alternative_target_unavailable' : 'invalid_alternative' } };
  const tasks = params.graph.tasks.filter(task => proposal.scope === 'plan' || task.id === act.targetPublicId);
  const alternative: NonNullable<WeeklyPlanningConsultationAlternativeEvidence['alternative']> = {
    scope: proposal.scope, taskIds: tasks.map(task => task.id), taskLabels: tasks.map(task => task.title), dates: [],
  };
  const unknown = (reason: Extract<WeeklyPlanningConsultationAlternativeEvidence['feasibility'], { status: 'not_evaluated' }>['reason']): WeeklyPlanningConsultationAlternativeEvidence =>
    ({ alternative, feasibility: { status: 'not_evaluated', reason } });
  if (acts.length !== 1) return unknown('ambiguous_alternative');
  if (weeklyPlanningEvidenceChannelForSourceTextV5(proposal.sourceText, params.input.userText) !== 'user') return unknown('alternative_not_grounded');
  if (tasks.length === 0) return unknown('alternative_target_unavailable');
  if (params.compilation.status === 'needs_resolution') return unknown('planning_details_missing');
  const compiled = params.compilation.input;
  if (!compiled) return unknown('no_schedulable_work');
  const selected = new Set(alternative.taskIds);
  if (compiled.fixedTaskReservations.some(item => selected.has(item.taskId))) return unknown('fixed_work_not_movable');
  if (!compiled.movableWorkItems.some(item => selected.has(item.taskId))) return unknown('no_schedulable_work');
  const horizonDates = listCalendarDatesInclusive(compiled.horizon.startDate, compiled.horizon.endDate) ?? [];
  const dates = new Set<string>();
  for (const expression of proposal.dateExpressions) {
    const weekday = canonicalWeekdayIndex(expression);
    if (weekday !== null) {
      horizonDates.filter(date => calendarWeekday(date) === weekday).forEach(date => dates.add(date));
    } else {
      const resolved = resolveCanonicalDateExpression({ expression, currentDate: params.requestContext.currentDate, weekStartsOn: params.requestContext.weekStartsOn });
      if (resolved.status !== 'resolved') return unknown('alternative_outside_horizon');
      // Do not claim to test an out-of-horizon portion of a proposed range.
      if (resolved.range.start < compiled.horizon.startDate || resolved.range.end > compiled.horizon.endDate) return unknown('alternative_outside_horizon');
      horizonDates.filter(date => date >= resolved.range.start && date <= resolved.range.end).forEach(date => dates.add(date));
    }
  }
  alternative.dates = [...dates].sort();
  if (dates.size === 0) return unknown('alternative_outside_horizon');
  const input = structuredClone(compiled);
  input.taskDateEligibilities = input.taskDateEligibilities.filter(entry => !selected.has(entry.taskId));
  for (const taskId of selected) {
    const accepted = compiled.taskDateEligibilities.find(entry => entry.taskId === taskId);
    input.taskDateEligibilities.push({
      taskId, allowedDates: alternative.dates.filter(date => !accepted?.allowedDates || accepted.allowedDates.includes(date)),
      excludedDates: accepted?.excludedDates ?? [], sourceFactIds: accepted?.sourceFactIds ?? [],
    });
  }
  const result = scheduleWeeklyPlanningStableV5Preview({
    input, graph: params.graph, plans: params.input.plans, scheduleTemplates: params.input.scheduleTemplates,
    timetableTermId: params.input.timetableTermId,
    notBefore: { date: params.requestContext.notBeforeDate, time: params.requestContext.notBeforeTime },
  });
  if (result.status === 'empty' || (result.status === 'ready'
    && !placementCandidateBlocks(result.candidates).some(block => selected.has(block.taskId)))) return unknown('no_schedulable_work');
  return { alternative, feasibility: { status: result.status === 'ready' ? 'fits' : 'does_not_fit', basis: 'alternative_scheduler' } };
}
