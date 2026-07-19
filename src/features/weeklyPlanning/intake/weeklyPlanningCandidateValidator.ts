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
import { isPlanningRangeConsistentWithAbsoluteDateSource } from './weeklyPlanningAbsoluteDate';
import type { WeeklyPlanningIntakeContext } from './weeklyPlanningIntakeTypes';
import { normalizeIntakeText } from './weeklyPlanningTextParsing';

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


const MODEL_INSTRUCTION_PATTERN = /(?:system\s*prompt|developer\s*message|ignore\s+(?:all|previous)|システムプロンプト|開発者メッセージ|前の指示|これまでの指示|指示を無視|命令を無視|candidates?|command|json).{0,100}(?:出力|返して|生成|emit|return)|(?:candidates?|command|json).{0,100}(?:出力|返して|生成)/i;

function normalizedEvidence(value: string): string {
  return normalizeIntakeText(value)
    .toLowerCase()
    .replace(/[\s、。,.!?！？「」『』"'：:]/g, '');
}

function sourceTextIsGrounded(
  candidate: InterpretedCommandCandidate,
  command: ParsedWeeklyPlanningCommand,
): boolean {
  if (!candidate.sourceUserText) return true;
  const user = normalizedEvidence(candidate.sourceUserText);
  const source = normalizedEvidence(command.sourceSegment ?? command.sourceText);
  return source.length > 0 && user.includes(source);
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function approximatelyContains(userText: string, expected: string): boolean {
  const user = normalizedEvidence(userText);
  const target = normalizedEvidence(expected);
  if (target.length < 4 || user.includes(target)) return false;
  for (const length of [target.length - 1, target.length, target.length + 1]) {
    if (length < 3) continue;
    for (let index = 0; index + length <= user.length; index += 1) {
      if (levenshteinDistance(user.slice(index, index + length), target) <= 1) return true;
    }
  }
  return false;
}

function validateCommandGrounding(
  candidate: InterpretedCommandCandidate,
  command: ParsedWeeklyPlanningCommand,
  summary: InterpreterStateSummary,
): string | null {
  const userText = candidate.sourceUserText;
  if (!userText) return null;
  if (MODEL_INSTRUCTION_PATTERN.test(userText)) return 'prompt-injection-like-user-text';
  if (command.sourceSegment && !sourceTextIsGrounded(candidate, command)) return 'ungrounded-source-segment';
  const normalized = normalizeIntakeText(userText).trim();
  switch (command.type) {
    case 'note_no_fixed_events': {
      const fixedEventsQuestion = summary.lastQuestions?.some((question) => question.slotKey === 'fixed_events');
      const explicit = /(?:固定|動かせない|外せない|予定).*(?:ない|なし|ありません)|(?:ない|なし|ありません).*(?:固定|予定)/.test(normalized);
      const shortAnswer = fixedEventsQuestion
        && /^(?:特に)?(?:ない|なし|ありません|ないです)[。！!]*$/.test(normalized);
      return explicit || shortAnswer ? null : 'ungrounded-no-fixed-events';
    }
    case 'set_unit_rate':
      return /(?:\d+(?:\.\d+)?|[一二三四五六七八九十]+)\s*(?:時間|分)/.test(normalized)
        ? null : 'ungrounded-unit-rate';
    case 'set_priority_policy':
      return /優先|順番|先に|から.*(?:進め|やり|解き|始め)/.test(normalized)
        ? null : 'ungrounded-priority-policy';
    case 'use_constraint_source':
      return /時間割|予定表|登録済み|保存済み|いつもの授業|カレンダー/.test(normalized)
        ? null : 'ungrounded-constraint-source';
    case 'request_clarification':
      return /意味|どういう|何を答え|とは|って何|わからない/.test(normalized)
        ? null : 'ungrounded-clarification-request';
    case 'set_planning_range':
    case 'set_pending_planning_range':
      return /今日|明日|明後日|今週|来週|週末|夏休み|[月火水木金土日]曜|\d{1,2}\s*月\s*\d{1,2}\s*日|から|まで|週間|日間/.test(normalized)
        ? null : 'ungrounded-planning-range';
    case 'begin_weekly_planning':
      return /予定|計画|スケジュール/.test(normalized) && /立て|作|組|決め|したい|お願い/.test(normalized)
        ? null : 'ungrounded-planning-intent';
    case 'set_exam_scope': {
      const hasField = command.scope.fields.some((field) =>
        normalizedEvidence(normalized).includes(normalizedEvidence(field))
        || approximatelyContains(normalized, field));
      return hasField || /院試|過去問|20\d{2}/.test(normalized)
        ? null : 'ungrounded-exam-scope';
    }
    case 'add_fixed_event':
    case 'add_unavailable':
    case 'update_life_constraint':
      return /\d{1,2}\s*時|\d{1,2}:\d{2}|睡眠|寝|食事|夕食|風呂|入浴|移動|バイト|授業|予定/.test(normalized)
        ? null : 'ungrounded-life-constraint';
    case 'mark_completed_units':
    case 'mark_completion_target':
    case 'note_progress_boundary':
      return /年度|年分|終|済|未着手|進捗|どこまで/.test(normalized)
        ? null : 'ungrounded-progress';
    case 'set_study_goal':
      return /勉強|学習|課題|ワーク|過去問|進め|やり|解き|復習|暗記|おさらい|取り組/.test(normalized)
        ? null : 'ungrounded-study-goal';
    default:
      return null;
  }
}

function requiresTypoConfirmation(
  candidate: InterpretedCommandCandidate,
  command: ParsedWeeklyPlanningCommand,
): boolean {
  return Boolean(candidate.sourceUserText
    && command.type === 'set_exam_scope'
    && command.scope.fields.some((field) => approximatelyContains(candidate.sourceUserText!, field)));
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
  context?: WeeklyPlanningIntakeContext,
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
    const groundingError = validateCommandGrounding(candidate, command, summary);
    if (groundingError) {
      addRejected(result, effectiveCandidate, groundingError);
      return;
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

    if (
      command.type === 'set_planning_range'
      && context
      && !isPlanningRangeConsistentWithAbsoluteDateSource({
        sourceText: command.sourceSegment ?? command.sourceText,
        selectedDate: context.selectedDate,
        startDateTime: command.range.startDateTime,
      })
    ) {
      addRejected(result, effectiveCandidate, 'planning-range-absolute-date-mismatch');
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
      || requiresTypoConfirmation(candidate, command)
      || hasUnknownField(command, summary.knownFields)) {
      result.acceptedWithConfirmation.push(command);
      return;
    }

    result.accepted.push(command);
  });

  return result;
}
