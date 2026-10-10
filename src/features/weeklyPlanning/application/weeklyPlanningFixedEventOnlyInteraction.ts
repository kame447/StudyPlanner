import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import type { GenericSchedulerInputCompilationResult } from '../semantic/weeklyPlanningGenericSchedulerInput';

export type WeeklyPlanningFixedEventStatusReason = 'fixed_event_manual_entry' | 'no_additional_work';

/** Turn-local explanation facts, never an event write or save capability. */
export interface WeeklyPlanningFixedEventCommunicationFacts {
  statusReason: WeeklyPlanningFixedEventStatusReason;
  manualEntry?: {
    navigationLabel: '予定';
    actionLabel: '予定を追加';
    eventCreatedByTurn: false;
  };
}

/** Fixed commitments constrain placement; they are not savable event candidates.
 * Close only an optional invitation after the compiler proves no movable work.
 * No user prose, rendered reply, comparison mode or persistence API is read. */
export function fixedEventOnlyInteractionStatus(params: {
  graph: WeeklyPlanningFactGraphV5;
  compilation: GenericSchedulerInputCompilationResult;
  semanticChanged: boolean;
  previousQuestionSlot: string | undefined;
  declinedAdditionalWork: boolean;
  requestedEventRegistration: boolean;
  previousOptionalInvitationClosed: boolean;
}): WeeklyPlanningFixedEventStatusReason | null {
  if (params.compilation.status === 'needs_resolution'
    || params.compilation.issues.some(issue => issue.blocking)
    || (params.compilation.input?.movableWorkItems.length ?? 0) > 0) return null;
  const active = createWeeklyPlanningActiveSchedulerGraphViewV5(params.graph);
  const reservations = params.compilation.input?.fixedTaskReservations ?? [];
  const nonStudyOnly = active.tasks.length > 0 && active.tasks.every(task => task.category === 'non_study');
  const fixedTasksOnly = nonStudyOnly && active.tasks.every(task => reservations.some(reservation => reservation.taskId === task.id));
  const declinedOptionalInvitation = params.declinedAdditionalWork
    && params.previousQuestionSlot === 'stable_v5:missing_schedulable_work';
  if (nonStudyOnly && declinedOptionalInvitation && !params.requestedEventRegistration) return 'no_additional_work';
  if (!fixedTasksOnly) {
    const emptyResolved = active.tasks.length === 0 && params.compilation.status === 'empty'
      && params.compilation.issues.length === 0;
    if (!emptyResolved) return null;
    if (params.requestedEventRegistration) return 'fixed_event_manual_entry';
    const busyOnly = active.availabilityDeclarations.some(fact => fact.kind === 'unavailable' && fact.constraintLevel === 'hard');
    return (busyOnly && params.declinedAdditionalWork)
      || declinedOptionalInvitation
      || (!params.semanticChanged && params.previousOptionalInvitationClosed)
      ? 'no_additional_work' : null;
  }
  return params.requestedEventRegistration || params.semanticChanged
    || params.previousQuestionSlot === 'stable_v5:missing_schedulable_work'
    ? 'fixed_event_manual_entry' : 'no_additional_work';
}

export function fixedEventCommunicationFacts(
  statusReason: WeeklyPlanningFixedEventStatusReason,
): WeeklyPlanningFixedEventCommunicationFacts {
  return { statusReason, ...(statusReason === 'fixed_event_manual_entry' ? { manualEntry: {
    navigationLabel: '予定' as const, actionLabel: '予定を追加' as const, eventCreatedByTurn: false as const,
  } } : {}) };
}
