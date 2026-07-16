import type { WeeklyPlanningCommandPayload } from './weeklyPlanningCommandTypes';

const CONFIDENCE_VALUES = new Set(['high', 'medium', 'low']);
const STUDY_SCOPE_UNITS = new Set([
  'minutes', 'hours', 'pages', 'problems', 'words', 'lessons', 'chapters',
  'year_field_chunk', 'topic', 'unknown',
]);
const HARDNESS_VALUES = new Set(['hard', 'soft']);
const PRIORITY_POLICY_KINDS = new Set([
  'field_first', 'deadline_first', 'weakness_first', 'score_weight_first', 'balanced', 'unknown',
]);
const LIFE_CONSTRAINT_KINDS = new Set([
  'sleep', 'meal', 'bath', 'commute', 'club', 'cram_school', 'buffer',
]);
const COMPLETION_TARGET_KINDS = new Set(['all', 'latest_n_years', 'up_to_reachable', 'year_range']);
const TOP_LEVEL_COMMON_KEYS = ['type', 'confidence', 'sourceText', 'sourceSegment'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function hasCommandKeys(value: Record<string, unknown>, specific: readonly string[]): boolean {
  return hasOnlyKeys(value, [...TOP_LEVEL_COMMON_KEYS, ...specific]);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOptionalPositiveInteger(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isInteger(value) && value > 0);
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function isStringArray(value: unknown, options: { unique?: boolean; nonEmptyItems?: boolean } = {}): value is string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return false;
  if (options.nonEmptyItems && value.some((item) => item.trim().length === 0)) return false;
  if (options.unique && new Set(value).size !== value.length) return false;
  return true;
}

function isIntegerArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isInteger(item));
}

function hasValidCommonShape(command: Record<string, unknown>): boolean {
  return typeof command.type === 'string'
    && CONFIDENCE_VALUES.has(command.confidence as string)
    && typeof command.sourceText === 'string'
    && command.sourceText.length <= 4000
    && isOptionalString(command.sourceSegment);
}

function validatePriorityPolicy(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== 'string' || !PRIORITY_POLICY_KINDS.has(value.kind)) {
    return false;
  }
  if (value.kind === 'field_first') {
    return hasOnlyKeys(value, ['kind', 'order'])
      && isStringArray(value.order, { unique: true, nonEmptyItems: true })
      && value.order.length > 0;
  }
  return hasOnlyKeys(value, ['kind']);
}

function validateCompletionTarget(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== 'string' || !COMPLETION_TARGET_KINDS.has(value.kind)) {
    return false;
  }
  if (value.kind === 'all' || value.kind === 'up_to_reachable') {
    return hasOnlyKeys(value, ['kind', 'rawText']) && typeof value.rawText === 'string';
  }
  if (value.kind === 'latest_n_years') {
    return hasOnlyKeys(value, ['kind', 'count', 'rawText'])
      && typeof value.count === 'number' && Number.isInteger(value.count)
      && typeof value.rawText === 'string';
  }
  return hasOnlyKeys(value, ['kind', 'startYear', 'endYear', 'rawText'])
    && typeof value.startYear === 'number' && Number.isInteger(value.startYear)
    && typeof value.endYear === 'number' && Number.isInteger(value.endYear)
    && typeof value.rawText === 'string';
}

function validateExamScope(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'examType', 'fields', 'totalFields', 'totalYears', 'yearRange', 'strategyHint',
    'unitModel', 'unitCountHint', 'rawText',
  ])) return false;
  if (!isStringArray(value.fields, { unique: true, nonEmptyItems: true })) return false;
  if (!isStringArray(value.rawText)) return false;
  if (!isOptionalString(value.examType)) return false;
  if (!isOptionalPositiveInteger(value.totalFields) || !isOptionalPositiveInteger(value.totalYears)) return false;
  if (!isOptionalPositiveInteger(value.unitCountHint)) return false;
  if (value.strategyHint !== undefined
    && value.strategyHint !== 'field_first'
    && value.strategyHint !== 'year_first'
    && value.strategyHint !== 'unknown') return false;
  if (value.unitModel !== undefined && typeof value.unitModel !== 'string') return false;
  if (value.yearRange !== undefined) {
    if (!isRecord(value.yearRange)
      || !hasOnlyKeys(value.yearRange, ['startYear', 'endYear', 'sourceText'])
      || typeof value.yearRange.startYear !== 'number' || !Number.isInteger(value.yearRange.startYear)
      || typeof value.yearRange.endYear !== 'number' || !Number.isInteger(value.yearRange.endYear)
      || typeof value.yearRange.sourceText !== 'string') return false;
  }
  return true;
}

function validateStudyGoal(command: Record<string, unknown>): boolean {
  if (!hasCommandKeys(command, ['goal']) || !isRecord(command.goal)) return false;
  const goal = command.goal;
  return hasOnlyKeys(goal, ['title', 'subject', 'unit', 'amount'])
    && isNonEmptyString(goal.title)
    && goal.title.length <= 200
    && isOptionalString(goal.subject)
    && (goal.unit === undefined || typeof goal.unit === 'string')
    && isOptionalFiniteNumber(goal.amount);
}

export function isValidWeeklyPlanningCommand(value: unknown): value is WeeklyPlanningCommandPayload {
  if (!isRecord(value) || !hasValidCommonShape(value)) return false;

  switch (value.type) {
    case 'add_unavailable': {
      if (!hasCommandKeys(value, ['range']) || !isRecord(value.range)) return false;
      const range = value.range;
      return hasOnlyKeys(range, ['date', 'start', 'end', 'hardness', 'reason'])
        && isOptionalString(range.date)
        && typeof range.start === 'string'
        && typeof range.end === 'string'
        && HARDNESS_VALUES.has(range.hardness as string)
        && isOptionalString(range.reason);
    }
    case 'add_fixed_event': {
      if (!hasCommandKeys(value, ['event']) || !isRecord(value.event)) return false;
      const event = value.event;
      return hasOnlyKeys(event, ['date', 'start', 'end', 'durationMinutes', 'hardness'])
        && isOptionalString(event.date)
        && isOptionalString(event.start)
        && isOptionalString(event.end)
        && isOptionalFiniteNumber(event.durationMinutes)
        && HARDNESS_VALUES.has(event.hardness as string);
    }
    case 'update_life_constraint': {
      if (!hasCommandKeys(value, ['kind', 'constraint'])
        || typeof value.kind !== 'string'
        || !LIFE_CONSTRAINT_KINDS.has(value.kind)
        || !isRecord(value.constraint)) return false;
      const constraint = value.constraint;
      return hasOnlyKeys(constraint, [
        'date', 'start', 'end', 'durationMinutes', 'studyAvailableStart', 'hardness',
      ])
        && isOptionalString(constraint.date)
        && isOptionalString(constraint.start)
        && isOptionalString(constraint.end)
        && isOptionalString(constraint.studyAvailableStart)
        && isOptionalFiniteNumber(constraint.durationMinutes)
        && HARDNESS_VALUES.has(constraint.hardness as string);
    }
    case 'use_constraint_source':
      return hasCommandKeys(value, ['source'])
        && isRecord(value.source)
        && hasOnlyKeys(value.source, ['kind', 'selector'])
        && (value.source.kind === 'timetable' || value.source.kind === 'existing_plans' || value.source.kind === 'calendar')
        && value.source.selector === 'active';
    case 'request_clarification':
      return hasCommandKeys(value, ['target', 'ref'])
        && (value.target === 'referenced_question' || value.target === 'referenced_term' || value.target === 'unresolved_slot')
        && isOptionalString(value.ref);
    case 'set_priority_policy':
      return hasCommandKeys(value, ['policy']) && validatePriorityPolicy(value.policy);
    case 'mark_completed_units':
      return hasCommandKeys(value, ['field', 'completedYears', 'mergeMode'])
        && isNonEmptyString(value.field)
        && isIntegerArray(value.completedYears)
        && (value.mergeMode === 'replace' || value.mergeMode === 'append');
    case 'mark_completion_target':
      return hasCommandKeys(value, ['field', 'target'])
        && (value.field === undefined || isNonEmptyString(value.field))
        && validateCompletionTarget(value.target);
    case 'note_progress_boundary':
      return hasCommandKeys(value, ['field', 'boundaryYear', 'ambiguity'])
        && (value.field === undefined || isNonEmptyString(value.field))
        && typeof value.boundaryYear === 'number' && Number.isInteger(value.boundaryYear)
        && value.ambiguity === 'completion_direction';
    case 'note_no_fixed_events':
      return hasCommandKeys(value, []);
    case 'note_uncertainty':
      return hasCommandKeys(value, ['uncertainty'])
        && value.uncertainty === 'unknown_fields_may_take_longer';
    case 'set_unit_rate': {
      if (!hasCommandKeys(value, ['unitRate']) || !isRecord(value.unitRate)) return false;
      const unitRate = value.unitRate;
      return hasOnlyKeys(unitRate, ['unit', 'minutesPerUnit', 'source', 'uncertainty', 'rawText'])
        && STUDY_SCOPE_UNITS.has(unitRate.unit as string)
        && typeof unitRate.minutesPerUnit === 'number' && Number.isFinite(unitRate.minutesPerUnit)
        && (unitRate.source === 'user' || unitRate.source === 'assumption' || unitRate.source === 'default')
        && (unitRate.uncertainty === undefined || unitRate.uncertainty === 'low' || unitRate.uncertainty === 'medium' || unitRate.uncertainty === 'high')
        && isOptionalString(unitRate.rawText);
    }
    case 'set_exam_scope':
      return hasCommandKeys(value, ['scope']) && validateExamScope(value.scope);
    case 'set_planning_range': {
      if (!hasCommandKeys(value, ['range']) || !isRecord(value.range)) return false;
      const range = value.range;
      return hasOnlyKeys(range, ['startDateTime', 'endDateTime', 'sourceText', 'calendarDayCount', 'confidence'])
        && isOptionalString(range.startDateTime)
        && isOptionalString(range.endDateTime)
        && isOptionalString(range.sourceText)
        && isOptionalPositiveInteger(range.calendarDayCount)
        && (range.confidence === 'explicit' || range.confidence === 'inferred' || range.confidence === 'missing');
    }
    case 'set_pending_planning_range': {
      if (!hasCommandKeys(value, ['pending']) || !isRecord(value.pending)) return false;
      const pending = value.pending;
      if (!hasOnlyKeys(pending, ['scope', 'durationDays', 'sourceText'])
        || !isRecord(pending.scope)
        || typeof pending.sourceText !== 'string'
        || (pending.durationDays !== undefined
          && (typeof pending.durationDays !== 'number'
            || !Number.isInteger(pending.durationDays)
            || pending.durationDays <= 0))) return false;
      return hasOnlyKeys(pending.scope, ['kind', 'label', 'startDate', 'endDate'])
        && (pending.scope.kind === 'next_week' || pending.scope.kind === 'named_future_period')
        && typeof pending.scope.label === 'string'
        && isOptionalString(pending.scope.startDate)
        && isOptionalString(pending.scope.endDate);
    }
    case 'begin_weekly_planning':
      return hasCommandKeys(value, []);
    case 'set_study_goal':
      return validateStudyGoal(value);
    default:
      return false;
  }
}

function removeNull(record: Record<string, unknown>, key: string): void {
  if (record[key] === null) delete record[key];
}

function copyNested(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key];
  if (!isRecord(value)) return undefined;
  const copy = { ...value };
  record[key] = copy;
  return copy;
}

export function canonicalizeOptionalCommandNulls(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const command = { ...value };
  removeNull(command, 'sourceSegment');

  switch (command.type) {
    case 'add_unavailable': {
      const range = copyNested(command, 'range');
      if (range) ['date', 'reason'].forEach((key) => removeNull(range, key));
      break;
    }
    case 'add_fixed_event': {
      const event = copyNested(command, 'event');
      if (event) ['date', 'start', 'end', 'durationMinutes'].forEach((key) => removeNull(event, key));
      break;
    }
    case 'update_life_constraint': {
      const constraint = copyNested(command, 'constraint');
      if (constraint) ['date', 'start', 'end', 'durationMinutes', 'studyAvailableStart'].forEach((key) => removeNull(constraint, key));
      break;
    }
    case 'request_clarification':
      removeNull(command, 'ref');
      break;
    case 'mark_completion_target':
    case 'note_progress_boundary':
      removeNull(command, 'field');
      break;
    case 'set_unit_rate': {
      const unitRate = copyNested(command, 'unitRate');
      if (unitRate) ['uncertainty', 'rawText'].forEach((key) => removeNull(unitRate, key));
      break;
    }
    case 'set_exam_scope': {
      const scope = copyNested(command, 'scope');
      if (scope) {
        ['examType', 'totalFields', 'totalYears', 'yearRange', 'strategyHint', 'unitModel', 'unitCountHint']
          .forEach((key) => removeNull(scope, key));
      }
      break;
    }
    case 'set_planning_range': {
      const range = copyNested(command, 'range');
      if (range) ['startDateTime', 'endDateTime', 'sourceText', 'calendarDayCount'].forEach((key) => removeNull(range, key));
      break;
    }
    case 'set_pending_planning_range': {
      const pending = copyNested(command, 'pending');
      if (pending) {
        removeNull(pending, 'durationDays');
        const scope = copyNested(pending, 'scope');
        if (scope) ['startDate', 'endDate'].forEach((key) => removeNull(scope, key));
      }
      break;
    }
    case 'set_study_goal': {
      const goal = copyNested(command, 'goal');
      if (goal) ['subject', 'unit', 'amount'].forEach((key) => removeNull(goal, key));
      break;
    }
    default:
      break;
  }

  return command;
}
