import type { ParsedWeeklyPlanningCommand } from './weeklyPlanningCommandTypes';
import type {
  CandidateValidationResult,
  InterpretedCommandCandidate,
  InterpreterStateSummary,
} from './weeklyPlanningInterpreterTypes';
import { studyGoalIdentity } from './weeklyPlanningTaskIdentity';
import { isValidWeeklyPlanningCommand } from './weeklyPlanningCommandRuntimeValidation';
import { normalizeExamScopeEnrichment } from './weeklyPlanningExamScopeEnrichment';

const CONFIDENCE_RANK = {
  low: 0,
  medium: 1,
  high: 2,
} as const;

export const KNOWN_COMMAND_TYPES = new Set([
  'add_unavailable',
  'add_fixed_event',
  'update_life_constraint',
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
  return typeof value === 'string' && /^([01]?\d|2[0-4]):[0-5]\d$/.test(value);
}

function isDate(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
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
    case 'update_life_constraint':
      if (!LIFE_CONSTRAINT_KINDS.has(command.kind)) return 'invalid-life-constraint-kind';
      return !HARDNESS_VALUES.has(command.constraint.hardness) ? 'invalid-hardness' : null;
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

  // 可用性が不明なときは利用不可として扱う(空/不明なソースを鵜呑みにしない安全側)。
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
    case 'set_pending_planning_range': {
      const { scope, durationDays } = command.pending;
      if (scope.startDate !== undefined && !isDate(scope.startDate)) return 'invalid-date';
      if (scope.endDate !== undefined && !isDate(scope.endDate)) return 'invalid-date';
      if (durationDays !== undefined && (!Number.isInteger(durationDays) || durationDays <= 0)) {
        return 'invalid-duration-days';
      }
      return null;
    }
    case 'set_study_goal':
      return command.goal.amount === undefined
        || (typeof command.goal.amount === 'number'
          && Number.isFinite(command.goal.amount)
          && command.goal.amount > 0)
        ? null
        : 'invalid-goal-amount';
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
    case 'mark_completion_target':
    case 'note_progress_boundary':
      return ['progress'];
    case 'set_unit_rate':
      return ['unit_duration_estimate'];
    case 'add_fixed_event':
    case 'note_no_fixed_events':
    case 'use_constraint_source':
      return ['fixed_events'];
    case 'add_unavailable':
      return ['fixed_events'];
    case 'update_life_constraint':
      return ['life_constraints'];
    case 'set_study_goal':
      return [studyGoalIdentity(command.goal.title)];
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

      // planner decision: 参照した schedule source が実際に非空かを capability snapshot で検証する。
      // 空なら fixed_events を勝手に充足せず、rejected として残す(pipeline が確認へ倒す)。
      if (!constraintSourceAvailable(command.source, summary)) {
        addRejected(result, candidate, 'constraint-source-unavailable');
        return;
      }
    }

    // 聞き返しは state を進めない対話イベント。slot を占有させず専用バケットへ振り分ける。
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

      const pendingStartDate = summary.pendingPlanningRange.startDate;
      const pendingEndDate = summary.pendingPlanningRange.endDate;
      if (pendingStartDate && pendingEndDate) {
        const isWithinPendingWindow = rangeStartDate >= pendingStartDate
          && rangeStartDate <= pendingEndDate;
        if (!isWithinPendingWindow) {
          result.acceptedWithConfirmation.push(command);
          return;
        }
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

    if (command.confidence === 'medium' || candidate.needsConfirmation || hasUnknownField(command, summary.knownFields)) {
      result.acceptedWithConfirmation.push(command);
      return;
    }

    result.accepted.push(command);
  });

  return result;
}
