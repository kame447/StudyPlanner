import { minutesFromTime, parseTimeToMinutes, timeFromMinutes } from '../../../lib/date';
import { expandPlansForDate } from '../../../lib/planRecurrence';
import type { Plan } from '../../../types/domain';
import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import type { SemanticConversationActV5 } from '../semantic/weeklyPlanningConversationActsV5';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import type { GenericSchedulerInputCompilationResult } from '../semantic/weeklyPlanningGenericSchedulerInput';
import type { WeeklyPlanningStableV5PreviewProvenance } from '../weeklyPlanningPreviewProvenance';

export type WeeklyPlanningFixedEventStatusReason = 'fixed_event_manual_entry' | 'no_additional_work' | 'fixed_event_registration_preview';

export interface WeeklyPlanningUnregisteredFixedEvent {
  taskId: string;
  title: string;
  reason: 'multiple_intervals' | 'crosses_midnight';
}

/** Turn-local explanation facts, never an event write or save capability. */
export interface WeeklyPlanningFixedEventCommunicationFacts {
  statusReason: WeeklyPlanningFixedEventStatusReason;
  eventRegistration?: {
    eventCreatedByTurn: false;
    candidates: WeeklyDraftCandidate[];
    workAwaitingAuthorization?: string[];
    unregistered?: WeeklyPlanningUnregisteredFixedEvent[];
    overlaps: Array<{ date: string; startTime: string; endTime: string; titles: [string, string] }>;
  };
  manualEntry?: {
    navigationLabel: '予定';
    actionLabel: '予定を追加';
    eventCreatedByTurn: false;
  };
}

/** Busy-only commitments retain the optional-invitation/manual-entry fallback.
 * Explicit resolved task registration is projected before this fallback.
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

/** Project resolved commitments without allocating, splitting or moving them. */
export function projectWeeklyPlanningFixedEventRegistration(params: {
  graph: WeeklyPlanningFactGraphV5;
  compilation: GenericSchedulerInputCompilationResult;
  registrationActs: readonly SemanticConversationActV5[];
  currentTurnId: string;
}): { candidates: WeeklyDraftCandidate[]; unregistered: WeeklyPlanningUnregisteredFixedEvent[] } {
  const acts = params.registrationActs.filter(act => act.kind === 'request_event_registration');
  const unregistered: WeeklyPlanningUnregisteredFixedEvent[] = [];
  if (acts.length === 0 || params.compilation.status === 'needs_resolution'
    || params.compilation.issues.some(issue => issue.blocking)) return { candidates: [], unregistered };
  const input = params.compilation.input;
  if (!input) return { candidates: [], unregistered };
  const active = createWeeklyPlanningActiveSchedulerGraphViewV5(params.graph);
  // Task identity may predate a current-turn update to its time, workload or context.
  const currentTaskIds = new Set([
    ...active.tasks.filter(task => task.source.turnId === params.currentTurnId).map(task => task.id),
    ...[...active.studyContexts, ...active.components, ...active.workloads, ...active.effortEstimates,
      ...active.temporalConstraints, ...active.taskDateRules, ...active.recurrences]
      .filter(fact => fact.source.turnId === params.currentTurnId).map(fact => fact.taskId),
  ]);
  const candidates = active.tasks.flatMap(task => {
    if (!acts.some(act => act.targetPublicId === null
      ? currentTaskIds.has(task.id) : act.targetPublicId === task.id)) return [];
    const reservations = input.fixedTaskReservations.filter(entry => entry.taskId === task.id);
    const reason = reservations.some(reservation => reservation.start.date !== reservation.end.date)
      ? 'crosses_midnight' : reservations.length > 1 ? 'multiple_intervals' : null;
    if (reason) { unregistered.push({ taskId: task.id, title: task.title, reason }); return []; }
    if (reservations.length !== 1) return [];
    const reservation = reservations[0];
    const workItemKey = `fixed-event:${reservation.id}`;
    const stableV5Metadata: WeeklyPlanningStableV5PreviewProvenance = {
      runtime: 'stable_v5', conversationId: task.source.conversationId,
      graphRevision: params.graph.revision, taskId: task.id,
      sourceFactRefs: [task.id, reservation.temporalConstraintFactId],
      planType: task.category === 'study' ? 'study' : 'other',
    };
    return [{
      stableKey: `stable-v5:${params.graph.revision}:${workItemKey}`,
      date: reservation.start.date, startTime: reservation.start.time, endTime: reservation.end.time,
      durationMinutes: minutesFromTime(reservation.end.time) - minutesFromTime(reservation.start.time),
      title: task.title, source: 'fixed_event_registration' as const,
      approvalStatus: 'unapproved' as const, workItemKey, stableV5Metadata,
    }];
  });
  return { candidates, unregistered };
}

export function weeklyPlanningFixedEventRegistrationFacts(
  candidates: WeeklyDraftCandidate[], plans: Plan[], workAwaitingAuthorization: string[] = [],
  unregistered: WeeklyPlanningUnregisteredFixedEvent[] = [],
): WeeklyPlanningFixedEventCommunicationFacts {
  const overlaps: NonNullable<WeeklyPlanningFixedEventCommunicationFacts['eventRegistration']>['overlaps'] = [];
  candidates.forEach((candidate, index) => {
    const others = [...candidates.slice(index + 1), ...expandPlansForDate(plans, candidate.date)];
    others.forEach(other => {
      if (candidate.date !== other.date) return;
      const start = Math.max(parseTimeToMinutes(candidate.startTime), parseTimeToMinutes(other.startTime));
      const end = Math.min(parseTimeToMinutes(candidate.endTime, 'end'), parseTimeToMinutes(other.endTime, 'end'));
      if (start < end) overlaps.push({ date: candidate.date, startTime: timeFromMinutes(start), endTime: timeFromMinutes(end),
        titles: [candidate.title, other.title] });
    });
  });
  return { ...fixedEventCommunicationFacts(candidates.length > 0 ? 'fixed_event_registration_preview' : 'fixed_event_manual_entry'), eventRegistration: { eventCreatedByTurn: false, candidates, overlaps,
    ...(unregistered.length > 0 ? { unregistered } : {}),
    ...(workAwaitingAuthorization.length > 0 ? { workAwaitingAuthorization } : {}),
  } };
}

export function weeklyPlanningUnregisteredFixedEventMessage(events: WeeklyPlanningUnregisteredFixedEvent[]): string {
  return events.map(event => `${event.title}は${event.reason === 'multiple_intervals'
    ? '複数の日付や時間帯がある' : '日付をまたぐ'}ため、この登録経路の候補に含めていません。`).join('');
}
