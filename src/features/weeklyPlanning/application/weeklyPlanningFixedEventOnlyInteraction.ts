import { conversationArchitecturePolicy } from '../weeklyPlanningConversationArchitecture';
import type { WeeklyPlanningConversationArchitecture } from '../weeklyPlanningConversationArchitecture';
import { createWeeklyPlanningActiveSchedulerGraphViewV5, type WeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import type { GenericSchedulerInputCompilationResult } from '../semantic/weeklyPlanningGenericSchedulerInput';

/** Fixed commitments constrain placement but never produce savable preview candidates.
 * This presentation decision closes only the empty-work invitation; it cannot alter
 * readiness, facts, preview authorization or persistence. No user prose is read. */
export function fixedEventOnlyInteractionStatus(params: {
  architecture: WeeklyPlanningConversationArchitecture | undefined;
  graph: WeeklyPlanningFactGraphV5;
  compilation: GenericSchedulerInputCompilationResult;
  semanticChanged: boolean;
  previousQuestionSlot: string | undefined;
  declinedAdditionalWork: boolean;
  requestedEventRegistration?: boolean;
  previousOptionalInvitationClosed?: boolean;
}): 'fixed_event_manual_entry' | 'no_additional_work' | null {
  if (!conversationArchitecturePolicy(params.architecture).interactionOutcome
    || params.compilation.status === 'needs_resolution'
    || params.compilation.issues.some(issue => issue.blocking)
    || (params.compilation.input?.movableWorkItems.length ?? 0) > 0) return null;
  const active = createWeeklyPlanningActiveSchedulerGraphViewV5(params.graph);
  const reservations = params.compilation.input?.fixedTaskReservations ?? [];
  const fixedTasksOnly = active.tasks.length > 0 && active.tasks.every(task => task.category === 'non_study'
    && reservations.some(reservation => reservation.taskId === task.id));
  if (!fixedTasksOnly) {
    const emptyResolved = active.tasks.length === 0 && params.compilation.status === 'empty'
      && params.compilation.issues.length === 0;
    if (!emptyResolved) return null;
    if (params.requestedEventRegistration) return 'fixed_event_manual_entry';
    const busyOnly = active.availabilityDeclarations.some(fact => fact.kind === 'unavailable' && fact.constraintLevel === 'hard');
    // The preceding closed, question-free status is retained by the compatibility state.
    // New planning details reopen ordinary routing; an unchanged acknowledgement does not.
    return (busyOnly && params.declinedAdditionalWork)
      || (!params.semanticChanged && params.previousOptionalInvitationClosed)
      ? 'no_additional_work' : null;
  }
  return params.semanticChanged || params.previousQuestionSlot === 'stable_v5:missing_schedulable_work'
    ? 'fixed_event_manual_entry' : 'no_additional_work';
}

/** The subject of an optional invitation, never a replacement for a required detail. */
export type WeeklyPlanningScheduleCommunicationIntent =
  | 'confirm_existing_schedule'
  | 'register_event'
  | 'identify_study_work'
  | 'clarify_schedule_request';

export function scheduleCommunicationIntent(
  active: WeeklyPlanningActiveSchedulerGraphViewV5,
): WeeklyPlanningScheduleCommunicationIntent {
  if (active.tasks.some(task => task.category === 'study')) return 'identify_study_work';
  if (active.tasks.length > 0) return 'register_event';
  return 'clarify_schedule_request';
}

/** Required questions about occupied time retain their own detail intent and authority. */
export function isExistingScheduleQuestion(code: string | null): boolean {
  return code !== null && [
    'missing_commitment_date_scope', 'ambiguous_commitment_recurrence', 'invalid_commitment_interval',
    'unsupported_commitment_date_expression', 'commitment_outside_planning_window',
    'constraint_source_unavailable', 'active_constraint_source_missing',
  ].includes(code);
}
