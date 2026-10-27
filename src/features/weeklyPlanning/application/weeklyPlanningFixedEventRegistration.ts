import { minutesFromTime } from '../../../lib/date';
import { expandPlansForDate } from '../../../lib/planRecurrence';
import type { Plan } from '../../../types/domain';
import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import type { GenericSchedulerInputCompilationResult } from '../semantic/weeklyPlanningGenericSchedulerInput';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import type { WeeklyPlanningStableV5PreviewProvenance } from '../weeklyPlanningPreviewProvenance';
import type { WeeklyPlanningFixedEventCommunicationFacts } from './weeklyPlanningFixedEventOnlyInteraction';

/** Project resolved commitments without allocating, splitting or moving them. */
export function createWeeklyPlanningFixedEventRegistrationCandidates(params: {
  graph: WeeklyPlanningFactGraphV5;
  compilation: GenericSchedulerInputCompilationResult;
  requested: boolean;
}): WeeklyDraftCandidate[] {
  if (!params.requested || params.compilation.status === 'needs_resolution'
    || params.compilation.issues.some(issue => issue.blocking)) return [];
  const input = params.compilation.input;
  if (!input) return [];
  const active = createWeeklyPlanningActiveSchedulerGraphViewV5(params.graph);
  return active.tasks.flatMap(task => {
    if (task.category !== 'non_study') return [];
    const reservations = input.fixedTaskReservations.filter(entry => entry.taskId === task.id);
    // Multiple dates/intervals are not a single resolved fixed-event request.
    if (reservations.length !== 1) return [];
    const reservation = reservations[0];
    if (reservation.start.date !== reservation.end.date) return [];
    const workItemKey = `fixed-event:${reservation.id}`;
    const stableV5Metadata: WeeklyPlanningStableV5PreviewProvenance = {
      runtime: 'stable_v5', conversationId: task.source.conversationId,
      graphRevision: params.graph.revision, taskId: task.id,
      sourceFactRefs: [task.id, reservation.temporalConstraintFactId], planType: 'other',
    };
    return [{
      stableKey: `stable-v5:${params.graph.revision}:${workItemKey}`,
      date: reservation.start.date, startTime: reservation.start.time, endTime: reservation.end.time,
      durationMinutes: minutesFromTime(reservation.end.time) - minutesFromTime(reservation.start.time),
      title: task.title, source: 'fixed_event_registration' as const,
      approvalStatus: 'unapproved' as const, workItemKey, stableV5Metadata,
    }];
  });
}

export function weeklyPlanningFixedEventRegistrationFacts(
  candidates: WeeklyDraftCandidate[], plans: Plan[], workAwaitingAuthorization: string[] = [],
): WeeklyPlanningFixedEventCommunicationFacts {
  const overlaps: NonNullable<WeeklyPlanningFixedEventCommunicationFacts['eventRegistration']>['overlaps'] = [];
  candidates.forEach((candidate, index) => {
    const others = [...candidates.slice(index + 1), ...expandPlansForDate(plans, candidate.date)];
    others.forEach(other => {
      if (candidate.date !== other.date) return;
      const startTime = candidate.startTime > other.startTime ? candidate.startTime : other.startTime;
      const endTime = candidate.endTime < other.endTime ? candidate.endTime : other.endTime;
      if (startTime < endTime) overlaps.push({ date: candidate.date, startTime, endTime,
        titles: [candidate.title, other.title] });
    });
  });
  return { statusReason: 'fixed_event_registration_preview', eventRegistration: { eventCreatedByTurn: false, candidates, overlaps,
    ...(workAwaitingAuthorization.length > 0 ? { workAwaitingAuthorization } : {}),
  } };
}
