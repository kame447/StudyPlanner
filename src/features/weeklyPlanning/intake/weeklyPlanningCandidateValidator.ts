import {
  isDateWithinWindow,
  isIsoCalendarDate,
  isOrderedPlanningDateTimeRange,
  isValidPlanningDateTime,
  isValidDateWindow,
  isValidPlanningDurationDays,
} from './weeklyPlanningDateValidation';
import type { ParsedWeeklyPlanningCommand } from './weeklyPlanningCommandTypes';
import type {
  CandidateValidationResult,
  InterpretedCommandCandidate,
  InterpreterStateSummary,
} from './weeklyPlanningInterpreterTypes';
import { studyGoalIdentity } from './weeklyPlanningTaskIdentity';
import { isValidWeeklyPlanningCommand } from './weeklyPlanningCommandRuntimeValidation';
import { normalizeExamScopeEnrichment } from './weeklyPlanningExamScopeEnrichment';
import type { WeeklyPlanningIntakeContext } from './weeklyPlanningIntakeTypes';

const CONFIDENCE_RANK = {
  low: 0,
  medium: 1,
  high: 2,
} as const;

export const KNOWN_COMMAND_TYPES = new Set([
  'add_unavailable',
  'add_fixed_event',
  'add_relative_constraint',
  'update_life_constraint',
  'note_study_time_preference',
  'use_constraint_source',
  'request_clarification',
  'set_priority_policy',
  'mark_completed_units',
  'mark_completion_target',
  'note_progress_boundary',
  'note_no_fixed_events',
  'note_uncertainty',
  'set_unit_rate',
  'set_exam_scope',
  'set_planning_range',
  'set_pending_planning_range',
  'begin_weekly_planning',
  'authorize_draft_generation',
  'set_study_goal',
]);

const STUDY_SCOPE_UNITS = new Set([
  'minutes',
  'hours',
  'pages',
  'problems',
  'words',
  'lessons',
  'chapters',
  'year_field_chunk',
  'topic',
  'unknown',
]);

const PRIORITY_POLICY_KINDS = new Set([
  'field_first',
  'deadline_first',
  'weakness_first',
  'score_weight_first',
  'balanced',
  'unknown',
]);

const LIFE_CONSTRAINT_KINDS = new Set([
  'sleep',
  'meal',
  'bath',
  'commute',
  'club',
  'cram_school',
  'buffer',
]);
const RELATIVE_RELATIONS = new Set(['before', 'after', 'during_buffer']);
const RELATIVE_CONSTRAINT_KINDS = new Set(['commute', 'buffer']);
const STUDY_TIME_PREFERENCE_KINDS = new Set(['avoid_morning', 'prefer_before_sleep']);

const PLANNING_TEMPORAL_SCOPE_KINDS = new Set(['next_week', 'named_future_period']);

const HARDNESS_VALUES = new Set(['hard', 'soft']);
const MERGE_MODES = new Set(['replace', 'append']);
const CONSTRAINT_SOURCE_KINDS = new Set(['timetable', 'existing_plans', 'calendar']);
const CLARIFICATION_TARGETS = new Set(['referenced_question', 'referenced_term', 'unresolved_slot']);
const COMPLETION_TARGET_KINDS = new Set([
  'all',
  'latest_n_years',
  'up_to_reachable',
  'year_range',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTime(value: unknown): boolean {
  return typeof value === 'string'
    && /^(?:[01]?\d|2[0-3]):[0-5]\d$|^24:00$/.test(value);
}

function isDate(value: unknown): boolean {
  return typeof value === 'string' && isIsoCalendarDate(value);
}

function isReasonableYear(year: unknown): boolean {
  if (typeof year !== 'number' || !Number.isInteger(year)) {
    return false;
  }

  return year >= 2000 && year <= new Date().getFullYear() + 1;
}

function isReasonableMinutes(minutes: unknown): boolean {
  return typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0 && minutes <= 24 * 60;
}

function commandType(command: unknown): string | undefined {
  return isRecord(command) && typeof command.type === 'string' ? command.type : undefined;
}

function validateEnumVocabulary(command: ParsedWeeklyPlanningCommand): string | null {
  switch (command.type) {
    case 'set_pending_planning_range':
      return !PLANNING_TEMPORAL_SCOPE_KINDS.has(command.pending.scope.kind)
        ? 'invalid-planning-temporal-scope-kind' : null;
    case 'set_study_goal':
      return command.goal.unit !== undefined && !STUDY_SCOPE_UNITS.has(command.goal.unit)
        ? 'invalid-unit'
        : null;
    case 'set_exam_scope':
      return command.scope.unitModel && !STUDY_SCOPE_UNITS.has(command.scope.unitModel)
        ? 'invalid-unit-model'
        : null;
    case 'set_unit_rate':
      return !STUDY_SCOPE_UNITS.has(command.unitRate.unit) ? 'invalid-unit' : null;
    case 'set_priority_policy':
      return !PRIORITY_POLICY_KINDS.has(command.policy.kind) ? 'invalid-priority-policy-kind' : null;
    case 'mark_completed_units':
      return !MERGE_MODES.has(command.mergeMode) ? 'invalid-merge-mode' : null;
    case 'mark_completion_target':
      return !COMPLETION_TARGET_KINDS.has(command.target.kind) ? 'invalid-completion-target-kind' : null;
    case 'add_unavailable':
      return !HARDNESS_VALUES.has(command.range.hardness) ? 'invalid-hardness' : null;
    case 'add_fixed_event':
      return !HARDNESS_VALUES.has(command.event.hardness) ? 'invalid-hardness' : null;
    case 'add_relative_constraint':
      if (!RELATIVE_RELATIONS.has(command.relation)) return 'invalid-relative-relation';
      return !RELATIVE_CONSTRAINT_KINDS.has(command.kind) ? 'invalid-relative-constraint-kind' : null;
    case 'update_life_constraint':
      if (!LIFE_CONSTRAINT_KINDS.has(command.kind)) return 'invalid-life-constraint-kind';
      return !HARDNESS_VALUES.has(command.constraint.hardness) ? 'invalid-hardness' : null;
    case 'note_study_time_preference':
      return !STUDY_TIME_PREFERENCE_KINDS.has(command.preference.kind)
        ? 'invalid-study-time-preference-kind'
        : null;
    case 'use_constraint_source':
      return !CONSTRAINT_SOURCE_KINDS.has(command.source.kind) ? 'invalid-constraint-source-kind' : null;
    case 'request_clarification':
      return !CLARIFICATION_TARGETS.has(command.target) ? 'invalid-clarification-target' : null;
    default:
      return null;
  }
}

function constraintSourceAvailable(
  source: Extract<ParsedWeeklyPlanningCommand, { type: 'use_constraint_source' }>['source'],
  summary: InterpreterStateSummary,
): boolean {
  const availability = summary.availableConstraintSources;

  if (!availability) {
    return false;
  }

  switch (source.kind) {
    case 'timetable':
      return availability.timetable;
    case 'existing_plans':
      return availability.existingPlans;
    case 'calendar':
      return availability.calendar;
    default:
      return false;
  }
}

function validateValueRange(command: ParsedWeeklyPlanningCommand): string | null {
  switch (command.type) {
    case 'set_planning_range':
      return (command.range.startDateTime === undefined
        && command.range.endDateTime === undefined)
        || isOrderedPlanningDateTimeRange(command.range)
        ? null
        : 'invalid-planning-range';
    case 'set_pending_planning_range': {
      const {
        scope,
        planningStartDate,
        planningStartDateTime,
        durationDays,
        planningEndDateTime,
      } = command.pending;
      if (!isValidDateWindow(scope)) return 'invalid-pending-planning-range';
      if (planningStartDate !== undefined && !isIsoCalendarDate(planningStartDate)) {
        return 'invalid-pending-planning-range';
      }
      if (planningStartDateTime !== undefined
        && (!isValidPlanningDateTime(planningStartDateTime)
          || planningStartDate === undefined
          || planningStartDateTime.slice(0, 10) !== planningStartDate)) {
        return 'invalid-pending-planning-range';
      }
      if (planningEndDateTime !== undefined
        && (!isValidPlanningDateTime(planningEndDateTime)
          || scope.windowEndDate === undefined
          || planningEndDateTime.slice(0, 10) !== scope.windowEndDate)) {
        return 'invalid-pending-planning-range';
      }
      if (durationDays !== undefined && !isValidPlanningDurationDays(durationDays)) {
        return 'invalid-duration-days';
      }
      if (durationDays !== undefined && planningEndDateTime !== undefined) {
        return 'invalid-pending-planning-range';
      }
      const resolvedStartDate = planningStartDateTime?.slice(0, 10) ?? planningStartDate;
      if (resolvedStartDate !== undefined && !isDateWithinWindow(resolvedStartDate, scope)) {
        return 'invalid-pending-planning-range';
      }
      if (resolvedStartDate !== undefined
        && (durationDays !== undefined || planningEndDateTime !== undefined)) {
        return 'resolved-pending-planning-range';
      }
      return null;
    }
    case 'set_study_goal':
      if (command.goal.amount !== undefined
        && (!Number.isFinite(command.goal.amount) || command.goal.amount <= 0)) {
        return 'invalid-goal-amount';
      }
      if ((command.goal.deadlineDate !== undefined || command.goal.deadlineTime !== undefined)
        && command.goal.deadlineDeclared !== true) {
        return 'deadline-payload-requires-declaration';
      }
      if (command.goal.deadlineDate !== undefined && !isDate(command.goal.deadlineDate)) {
        return 'invalid-deadline-date';
      }
      if (command.goal.deadlineTime !== undefined && !isTime(command.goal.deadlineTime)) {
        return 'invalid-deadline-time';
      }
      return null;
    case 'add_relative_constraint':
      if (!Number.isInteger(command.offsetMinutes)
        || command.offsetMinutes < 0
        || command.offsetMinutes > 24 * 60) return 'invalid-relative-offset';
      return command.durationMinutes === undefined || isReasonableMinutes(command.durationMinutes)
        ? null
        : 'invalid-duration-minutes';
    case 'set_exam_scope': {
      const yearRange = command.scope.yearRange;
      if (yearRange && (!isReasonableYear(yearRange.startYear) || !isReasonableYear(yearRange.endYear))) {
        return 'invalid-year-range';
      }
      return null;
    }
    case 'mark_completed_units':
      return command.completedYears.every(isReasonableYear) ? null : 'invalid-completed-year';
    case 'mark_completion_target':
      if (command.target.kind === 'latest_n_years') {
        return Number.isInteger(command.target.count) && command.target.count > 0 ? null : 'invalid-completion-target-count';
      }
      if (command.target.kind === 'year_range') {
        return isReasonableYear(command.target.startYear) && isReasonableYear(command.target.endYear)
          ? null
          : 'invalid-completion-target-year-range';
      }
      return null;
    case 'note_progress_boundary':
      return isReasonableYear(command.boundaryYear) ? null : 'invalid-progress-year';
    case 'set_unit_rate':
      return isReasonableMinutes(command.unitRate.minutesPerUnit) ? null : 'invalid-unit-rate-minutes';
    case 'add_unavailable':
      if (command.range.date && !isDate(command.range.date)) return 'invalid-date';
      if (command.range.start && !isTime(command.range.start)) return 'invalid-time';
      if (command.range.end && !isTime(command.range.end)) return 'invalid-time';
      return null;
    case 'add_fixed_event':
      if (command.event.date && !isDate(command.event.date)) return 'invalid-date';
      if (command.event.start && !isTime(command.event.start)) return 'invalid-time';
      if (command.event.end && !isTime(command.event.end)) return 'invalid-time';
      if (command.event.durationMinutes !== undefined && !isReasonableMinutes(command.event.durationMinutes)) {
        return 'invalid-duration-minutes';
      }
      return null;
    case 'update_life_constraint':
      if (command.constraint.date && !isDate(command.constraint.date)) return 'invalid-date';
      if (command.constraint.start && !isTime(command.constraint.start)) return 'invalid-time';
      if (command.constraint.end && !isTime(command.constraint.end)) return 'invalid-time';
      if (command.constraint.durationMinutes !== undefined && !isReasonableMinutes(command.constraint.durationMinutes)) {
        return 'invalid-duration-minutes';
      }
      return null;
    default:
      return null;
  }
}

function commandSlotKeys(command: ParsedWeeklyPlanningCommand): string[] {
  switch (command.type) {
    case 'set_exam_scope': {
      const slots: string[] = [];
      if (command.scope.fields.length > 0) slots.push('exam_scope');
      if (command.scope.yearRange) slots.push('year_range');
      return slots;
    }
    case 'set_planning_range':
    case 'set_pending_planning_range':
      return ['planning_range'];
    case 'set_priority_policy':
      return ['priority_policy'];
    case 'mark_completed_units':
      return [`progress:${command.field}`];
    case 'mark_completion_target':
      return [command.field ? `progress:${command.field}` : 'progress'];
    case 'note_progress_boundary':
      return [command.field ? `progress:${command.field}` : 'progress'];
    case 'set_unit_rate':
      return ['unit_duration_estimate'];
    case 'add_fixed_event':
    case 'note_no_fixed_events':
    case 'use_constraint_source':
      return ['fixed_events'];
    case 'add_relative_constraint':
      return [`relative_constraint:${command.anchorRef}:${command.kind}`];
    case 'add_unavailable':
      return ['fixed_events'];
    case 'update_life_constraint':
      return [`life_constraints:${command.kind}:${command.constraint.date ?? 'all'}`];
    case 'note_study_time_preference':
      return [`study_time_preference:${command.preference.kind}:${command.preference.taskRef ?? 'all'}`];
    case 'set_study_goal':
      return [studyGoalIdentity(command.goal.title, command.goal.subject)];
    default:
      return [];
  }
}

function referencedFields(command: ParsedWeeklyPlanningCommand): string[] {
  switch (command.type) {
    case 'set_priority_policy':
      return command.policy.kind === 'field_first' ? command.policy.order : [];
    case 'mark_completed_units':
      return [command.field];
    case 'mark_completion_target':
      return command.field ? [command.field] : [];
    case 'note_progress_boundary':
      return command.field ? [command.field] : [];
    default:
      return [];
  }
}

function hasUnknownField(command: ParsedWeeklyPlanningCommand, knownFields: string[]): boolean {
  const references = referencedFields(command);

  return knownFields.length > 0 && references.some((field) => !knownFields.includes(field));
}

function addRejected(
  result: CandidateValidationResult,
  candidate: InterpretedCommandCandidate,
  reason: string,
): void {
  result.rejected.push({ candidate, reason });
}

function removeCandidateFromAcceptedResults(
  result: CandidateValidationResult,
  candidate: InterpretedCommandCandidate,
): void {
  result.accepted = result.accepted.filter((command) => command !== candidate.command);
  result.acceptedWithConfirmation = result.acceptedWithConfirmation.filter(
    (command) => command !== candidate.command,
  );
  result.clarifications = result.clarifications.filter((item) => item !== candidate);
}

export function validateInterpretedCandidates(
  candidates: InterpretedCommandCandidate[],
  summary: InterpreterStateSummary,
  _context?: WeeklyPlanningIntakeContext,
): CandidateValidationResult {
  const result: CandidateValidationResult = {
    accepted: [],
    acceptedWithConfirmation: [],
    clarifications: [],
    clarificationRequests: [],
    rejected: [],
    parseRejections: [],
  };
  const occupiedSlots = new Map<string, { rank: number; candidate: InterpretedCommandCandidate }>();

  candidates.forEach((candidate) => {
    const rawCommand = candidate.command;

    const type = commandType(rawCommand);

    if (!type || !KNOWN_COMMAND_TYPES.has(type)) {
      addRejected(result, candidate, 'unknown-command-type');
      return;
    }

    if (!isValidWeeklyPlanningCommand(rawCommand)) {
      addRejected(result, candidate, 'invalid-command-shape');
      return;
    }

    let command = rawCommand;
    let effectiveCandidate = candidate;
    if (command.type === 'set_exam_scope') {
      const enrichment = normalizeExamScopeEnrichment(command, summary.examScopeSummary);
      if (!enrichment.command) {
        addRejected(result, candidate, enrichment.error ?? 'confirmed-slot-overwrite');
        return;
      }
      command = enrichment.command;
      effectiveCandidate = command === candidate.command ? candidate : { ...candidate, command };
    }
    const enumError = validateEnumVocabulary(command);

    if (enumError) {
      addRejected(result, effectiveCandidate, enumError);
      return;
    }

    const valueError = validateValueRange(command);

    if (valueError) {
      addRejected(result, effectiveCandidate, valueError);
      return;
    }

    if (command.type === 'use_constraint_source') {
      const resolution = candidate.constraintSourceResolution;
      if (resolution && resolution.status !== 'resolved') {
        if (resolution.clarificationRequest) {
          result.clarificationRequests.push(resolution.clarificationRequest);
        }
        addRejected(result, candidate, `constraint-source-reference-${resolution.status}`);
        return;
      }

      if (!constraintSourceAvailable(command.source, summary)) {
        addRejected(result, candidate, 'constraint-source-unavailable');
        return;
      }
    }

    if (command.type === 'add_relative_constraint') {
      const anchors = summary.constraintAnchors?.filter((anchor) => anchor.ref === command.anchorRef) ?? [];
      if (anchors.length !== 1) {
        addRejected(result, effectiveCandidate, 'relative-constraint-anchor-unavailable');
        return;
      }
      const [anchor] = anchors;
      if (!anchor.date || !anchor.start || !anchor.end) {
        addRejected(result, effectiveCandidate, 'relative-constraint-anchor-incomplete');
        return;
      }
    }

    if (command.type === 'note_study_time_preference' && command.preference.taskRef) {
      const taskMatches = summary.tasks?.filter((task) => task.ref === command.preference.taskRef) ?? [];
      if (taskMatches.length !== 1) {
        addRejected(result, effectiveCandidate, 'study-time-preference-task-unavailable');
        return;
      }
    }

    if (command.type === 'request_clarification') {
      result.clarificationRequests.push(command);
      return;
    }

    if (command.type === 'set_planning_range' && summary.pendingPlanningRange) {
      const rangeStartDate = command.range.startDateTime?.slice(0, 10);
      const rangeEndDate = command.range.endDateTime?.slice(0, 10);
      if (command.range.confidence !== 'explicit' || !rangeStartDate || !rangeEndDate) {
        addRejected(result, candidate, 'pending-range-clarification');
        return;
      }

      const pendingStartDate = summary.pendingPlanningRange.windowStartDate;
      const pendingEndDate = summary.pendingPlanningRange.windowEndDate;
      if ((pendingStartDate && rangeStartDate < pendingStartDate)
        || (pendingEndDate && rangeStartDate > pendingEndDate)) {
        addRejected(result, candidate, 'pending-range-outside-window');
        return;
      }
      if (
        summary.pendingPlanningRange.planningEndDateTime
        && command.range.endDateTime !== summary.pendingPlanningRange.planningEndDateTime
      ) {
        addRejected(result, candidate, 'pending-range-end-mismatch');
        return;
      }
    }

    const slots = commandSlotKeys(command);

    const confirmedOverlaps = slots.filter((slot) => summary.confirmedSlots.includes(slot));
    if (
      confirmedOverlaps.length > 0
      && command.type !== 'set_exam_scope'
    ) {
      addRejected(result, effectiveCandidate, 'confirmed-slot-overwrite');
      return;
    }

    const rank = CONFIDENCE_RANK[command.confidence];
    const conflictingSlot = slots.find((slot) => occupiedSlots.has(slot));

    if (conflictingSlot) {
      const existing = occupiedSlots.get(conflictingSlot);
      if (existing && existing.rank >= rank) {
        addRejected(result, effectiveCandidate, 'conflicting-slot-lower-confidence');
        return;
      }

      if (existing) {
        removeCandidateFromAcceptedResults(result, existing.candidate);
        addRejected(result, existing.candidate, 'conflicting-slot-lower-confidence');
        Array.from(occupiedSlots.entries()).forEach(([slot, occupied]) => {
          if (occupied.candidate === existing.candidate) {
            occupiedSlots.delete(slot);
          }
        });
      }
    }

    slots.forEach((slot) => occupiedSlots.set(slot, { rank, candidate: effectiveCandidate }));

    if (command.confidence === 'low') {
      result.clarifications.push(effectiveCandidate);
      return;
    }

    if (command.confidence === 'medium'
      || candidate.needsConfirmation
      || hasUnknownField(command, summary.knownFields)) {
      result.acceptedWithConfirmation.push(command);
      return;
    }

    result.accepted.push(command);
  });

  return result;
}
