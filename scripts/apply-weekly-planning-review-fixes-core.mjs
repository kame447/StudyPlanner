import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

function read(path) {
  return readFileSync(path, 'utf8');
}

function write(path, content) {
  mkdirSync(path.split('/').slice(0, -1).join('/'), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function replaceOnce(path, before, after) {
  const source = read(path);
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`anchor not found in ${path}: ${before.slice(0, 120)}`);
  if (source.indexOf(before, index + before.length) >= 0) {
    throw new Error(`anchor not unique in ${path}: ${before.slice(0, 120)}`);
  }
  write(path, source.slice(0, index) + after + source.slice(index + before.length));
}

write('src/features/weeklyPlanning/intake/weeklyPlanningCommandRuntimeValidation.ts', `import type { ParsedWeeklyPlanningCommand } from './weeklyPlanningCommandTypes';

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
  if (value.unitModel !== undefined && !STUDY_SCOPE_UNITS.has(value.unitModel as string)) return false;
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
    && isOptionalString(goal.subject)
    && (goal.unit === undefined || STUDY_SCOPE_UNITS.has(goal.unit as string))
    && isOptionalFiniteNumber(goal.amount);
}

export function isValidWeeklyPlanningCommand(value: unknown): value is ParsedWeeklyPlanningCommand {
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
        || !isOptionalPositiveInteger(pending.durationDays)) return false;
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
`);

write('src/features/weeklyPlanning/intake/weeklyPlanningExamScopeEnrichment.ts', `import type { SetExamScopeCommand } from './weeklyPlanningCommandTypes';
import type { ExamPrepScope } from './weeklyPlanningIntakeTypes';
import { uniqueList } from './weeklyPlanningTextParsing';

export interface ExamScopeEnrichmentResult {
  command?: SetExamScopeCommand;
  error?: 'confirmed-exam-scope-attribute-overwrite';
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size !== left.length || rightSet.size !== right.length) return false;
  return leftSet.size === rightSet.size && Array.from(leftSet).every((value) => rightSet.has(value));
}

function sameYearRange(
  left: ExamPrepScope['yearRange'],
  right: ExamPrepScope['yearRange'],
): boolean {
  if (!left || !right) return left === right;
  return left.startYear === right.startYear && left.endYear === right.endYear;
}

function conflicts<T>(existing: T | undefined, incoming: T | undefined): boolean {
  return existing !== undefined && incoming !== undefined && existing !== incoming;
}

export function normalizeExamScopeEnrichment(
  command: SetExamScopeCommand,
  existing: ExamPrepScope | undefined,
): ExamScopeEnrichmentResult {
  if (!existing) return { command };
  const incoming = command.scope;

  if (existing.fields.length > 0 && incoming.fields.length > 0
    && !sameStringSet(existing.fields, incoming.fields)) {
    return { error: 'confirmed-exam-scope-attribute-overwrite' };
  }
  if (existing.yearRange && incoming.yearRange && !sameYearRange(existing.yearRange, incoming.yearRange)) {
    return { error: 'confirmed-exam-scope-attribute-overwrite' };
  }
  if (
    conflicts(existing.examType, incoming.examType)
    || conflicts(existing.totalFields, incoming.totalFields)
    || conflicts(existing.totalYears, incoming.totalYears)
    || conflicts(existing.strategyHint, incoming.strategyHint)
    || conflicts(existing.unitModel, incoming.unitModel)
    || conflicts(existing.unitCountHint, incoming.unitCountHint)
  ) {
    return { error: 'confirmed-exam-scope-attribute-overwrite' };
  }

  return {
    command: {
      ...command,
      scope: {
        examType: existing.examType ?? incoming.examType,
        fields: existing.fields.length > 0 ? [...existing.fields] : [...incoming.fields],
        totalFields: existing.totalFields ?? incoming.totalFields,
        totalYears: existing.totalYears ?? incoming.totalYears,
        yearRange: existing.yearRange ?? incoming.yearRange,
        strategyHint: existing.strategyHint ?? incoming.strategyHint,
        unitModel: existing.unitModel ?? incoming.unitModel,
        unitCountHint: existing.unitCountHint ?? incoming.unitCountHint,
        rawText: uniqueList([...existing.rawText, ...incoming.rawText]),
      },
    },
  };
}
`);

replaceOnce(
  'src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts',
  `import type { ParsedWeeklyPlanningCommand } from './weeklyPlanningCommandTypes';`,
  `import type { ParsedWeeklyPlanningCommand } from './weeklyPlanningCommandTypes';\nimport { canonicalizeOptionalCommandNulls } from './weeklyPlanningCommandRuntimeValidation';`,
);
replaceOnce(
  'src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts',
  `const CONFIDENCE_VALUES = new Set(['high', 'medium', 'low']);\n\n`,
  ``,
);
replaceOnce(
  'src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts',
  `function omitNullObjectProperties(value: unknown): unknown {\n  if (Array.isArray(value)) {\n    return value.map((item) => omitNullObjectProperties(item));\n  }\n  if (!isRecord(value)) {\n    return value;\n  }\n\n  return Object.fromEntries(\n    Object.entries(value)\n      .filter(([, propertyValue]) => propertyValue !== null)\n      .map(([key, propertyValue]) => [key, omitNullObjectProperties(propertyValue)]),\n  );\n}\n\nfunction normalizeConfidence(value: unknown): ParsedWeeklyPlanningCommand['confidence'] {\n  return CONFIDENCE_VALUES.has(String(value))\n    ? value as ParsedWeeklyPlanningCommand['confidence']\n    : 'low';\n}\n\n`,
  ``,
);
replaceOnce(
  'src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts',
  `  const normalizedCommand = omitNullObjectProperties(rawCommand);\n  if (!isRecord(normalizedCommand) || typeof normalizedCommand.type !== 'string') {\n    return null;\n  }\n  const command = normalizedCommand;\n\n  const confidence = normalizeConfidence(command.confidence);\n  const wrappedNeedsConfirmation = isRecord(candidate.command) && typeof candidate.needsConfirmation === 'boolean'\n    ? candidate.needsConfirmation\n    : undefined;\n\n  return {\n    command: {\n      ...command,\n      confidence,\n    } as unknown as ParsedWeeklyPlanningCommand,\n    origin: 'ai_interpreter',\n    needsConfirmation: wrappedNeedsConfirmation ?? confidence === 'medium',\n  };`,
  `  const normalizedCommand = canonicalizeOptionalCommandNulls(rawCommand);\n  if (!isRecord(normalizedCommand) || typeof normalizedCommand.type !== 'string') {\n    return null;\n  }\n  const wrappedNeedsConfirmation = isRecord(candidate.command) && typeof candidate.needsConfirmation === 'boolean'\n    ? candidate.needsConfirmation\n    : undefined;\n\n  return {\n    command: normalizedCommand as unknown as ParsedWeeklyPlanningCommand,\n    origin: 'ai_interpreter',\n    needsConfirmation: wrappedNeedsConfirmation ?? normalizedCommand.confidence === 'medium',\n  };`,
);

replaceOnce(
  'src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts',
  `import { studyGoalIdentity } from './weeklyPlanningTaskIdentity';`,
  `import { studyGoalIdentity } from './weeklyPlanningTaskIdentity';\nimport { isValidWeeklyPlanningCommand } from './weeklyPlanningCommandRuntimeValidation';\nimport { normalizeExamScopeEnrichment } from './weeklyPlanningExamScopeEnrichment';`,
);
replaceOnce(
  'src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts',
  `    if (!hasRequiredShape(rawCommand)) {\n      addRejected(result, candidate, 'invalid-command-shape');\n      return;\n    }\n\n    const command = rawCommand;`,
  `    if (!isValidWeeklyPlanningCommand(rawCommand)) {\n      addRejected(result, candidate, 'invalid-command-shape');\n      return;\n    }\n\n    let command = rawCommand;\n    let effectiveCandidate = candidate;\n    if (command.type === 'set_exam_scope') {\n      const enrichment = normalizeExamScopeEnrichment(command, summary.examScopeSummary);\n      if (!enrichment.command) {\n        addRejected(result, candidate, enrichment.error ?? 'confirmed-exam-scope-attribute-overwrite');\n        return;\n      }\n      command = enrichment.command;\n      effectiveCandidate = command === candidate.command ? candidate : { ...candidate, command };\n    }`,
);
replaceOnce(
  'src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts',
  `      addRejected(result, candidate, enumError);`,
  `      addRejected(result, effectiveCandidate, enumError);`,
);
replaceOnce(
  'src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts',
  `      addRejected(result, candidate, valueError);`,
  `      addRejected(result, effectiveCandidate, valueError);`,
);
replaceOnce(
  'src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts',
  `      && !isSafeConfirmedSlotEnrichment({\n        command,\n        summary,\n        confirmedOverlaps,\n        unconfirmedSlots,\n      })`,
  `      && command.type !== 'set_exam_scope'`,
);
replaceOnce(
  'src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts',
  `      addRejected(result, candidate, 'confirmed-slot-overwrite');`,
  `      addRejected(result, effectiveCandidate, 'confirmed-slot-overwrite');`,
);
replaceOnce(
  'src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts',
  `    const rank = CONFIDENCE_RANK[command.confidence];\n    const conflictingSlot = slots.find((slot) => occupiedSlots.has(slot));`,
  `    const rank = CONFIDENCE_RANK[command.confidence];\n    const conflictingSlot = slots.find((slot) => occupiedSlots.has(slot));`,
);
replaceOnce(
  'src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts',
  `        addRejected(result, candidate, 'conflicting-slot-lower-confidence');`,
  `        addRejected(result, effectiveCandidate, 'conflicting-slot-lower-confidence');`,
);
replaceOnce(
  'src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts',
  `    slots.forEach((slot) => occupiedSlots.set(slot, { rank, candidate }));\n\n    if (command.confidence === 'low') {\n      result.clarifications.push(candidate);`,
  `    slots.forEach((slot) => occupiedSlots.set(slot, { rank, candidate: effectiveCandidate }));\n\n    if (command.confidence === 'low') {\n      result.clarifications.push(effectiveCandidate);`,
);

replaceOnce(
  'src/features/weeklyPlanning/intake/weeklyPlanningInterpreterTypes.ts',
  `import type { WeeklyPlanningIntakeContext } from './weeklyPlanningIntakeTypes';`,
  `import type { ExamPrepScope, WeeklyPlanningIntakeContext } from './weeklyPlanningIntakeTypes';`,
);
replaceOnce(
  'src/features/weeklyPlanning/intake/weeklyPlanningInterpreterTypes.ts',
  `  examScopeSummary?: {\n    fields: string[];\n    yearRange?: {\n      startYear: number;\n      endYear: number;\n    };\n  };`,
  `  examScopeSummary?: ExamPrepScope;`,
);

replaceOnce(
  'src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts',
  `    examScopeSummary: state.examPrepScope\n      ? {\n        fields: [...state.examPrepScope.fields],\n        ...(state.examPrepScope.yearRange\n          ? {\n            yearRange: {\n              startYear: state.examPrepScope.yearRange.startYear,\n              endYear: state.examPrepScope.yearRange.endYear,\n            },\n          }\n          : {}),\n      }\n      : undefined,`,
  `    examScopeSummary: state.examPrepScope\n      ? {\n          ...state.examPrepScope,\n          fields: [...state.examPrepScope.fields],\n          rawText: [...state.examPrepScope.rawText],\n          ...(state.examPrepScope.yearRange\n            ? { yearRange: { ...state.examPrepScope.yearRange } }\n            : {}),\n        }\n      : undefined,`,
);

replaceOnce(
  'src/features/weeklyPlanning/intake/weeklyPlanningIntakeTypes.ts',
  `  priorityPolicy: PriorityPolicy;`,
  `  priorityPolicy: PriorityPolicy;\n  priorityPolicySource?: 'user' | 'derived_single_field';`,
);
replaceOnce(
  'src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer.ts',
  `  const fields = commandScope.fields.length > 0\n    ? commandScope.fields\n    : previousScope?.fields ?? [];`,
  `  const fields = commandScope.fields.length > 0\n    ? uniqueList(commandScope.fields.map((field) => field.trim()).filter(Boolean))\n    : previousScope?.fields ?? [];`,
);
replaceOnce(
  'src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer.ts',
  `        priorityPolicy: toPriorityPolicyFromSetPriorityPolicyCommand(command),\n        missing: removeMissing(state.missing, [`,
  `        priorityPolicy: toPriorityPolicyFromSetPriorityPolicyCommand(command),\n        priorityPolicySource: 'user',\n        missing: removeMissing(state.missing, [`,
);

write('src/features/weeklyPlanning/intake/weeklyPlanningMissingStatus.ts', `import type { PlanningIntakeMissing, PlanningIntakeState, PlanningIntakeStatus } from './weeklyPlanningIntakeTypes';
import { deterministicQuestionsForState, statusForMissing } from './weeklyPlanningQuestionSlots';
import { uniqueList } from './weeklyPlanningTextParsing';

export function addMissing(
  current: PlanningIntakeMissing[],
  additions: PlanningIntakeMissing[],
): PlanningIntakeMissing[] {
  return uniqueList([...current, ...additions]);
}

export function removeMissing(
  current: PlanningIntakeMissing[],
  removals: PlanningIntakeMissing[],
): PlanningIntakeMissing[] {
  const removalSet = new Set(removals);
  return current.filter((item) => !removalSet.has(item));
}

export function hasConfirmedFixedEvents(state: PlanningIntakeState): boolean {
  return state.fixedEventsDeclaredNone === true
    || Boolean(state.constraintSourcesInUse?.length)
    || state.constraints.some((constraint) =>
      constraint.kind === 'unavailable'
      || (constraint.kind === 'fixed_event' && constraint.hardness === 'hard'),
    );
}

export function hasConfirmedSleepCycle(state: PlanningIntakeState): boolean {
  return state.constraints.some((constraint) =>
    constraint.kind === 'sleep' || constraint.kind === 'buffer',
  );
}

export function hasConfirmedMealBathConstraints(state: PlanningIntakeState): boolean {
  return state.constraints.some((constraint) =>
    constraint.kind === 'meal' || constraint.kind === 'bath',
  );
}

export function hasConfirmedLifeConstraints(state: PlanningIntakeState): boolean {
  return hasConfirmedSleepCycle(state) && hasConfirmedMealBathConstraints(state);
}

export function deriveMissingForPlanningRange(
  state: PlanningIntakeState,
): PlanningIntakeMissing[] {
  const missing: PlanningIntakeMissing[] = [];
  if (!state.examPrepScope && state.tasks.length === 0) missing.push('tasks_or_goals');
  if (!hasConfirmedFixedEvents(state)) missing.push('fixed_events');
  if (!hasConfirmedSleepCycle(state)) missing.push('sleep_cycle');
  if (!hasConfirmedMealBathConstraints(state)) missing.push('meal_bath_constraints');
  return missing;
}

function applyPriorityMissingState(state: PlanningIntakeState): PlanningIntakeState {
  const fields = uniqueList((state.examPrepScope?.fields ?? []).map((field) => field.trim()).filter(Boolean));
  const totalFields = state.examPrepScope?.totalFields;
  const isPriorityStage = Boolean(
    state.examPrepScope
    && state.unitRates.length > 0
    && !state.missing.includes('year_range')
    && !state.missing.includes('completion_direction'),
  );
  if (!isPriorityStage) return state;

  const isKnownSingleField = fields.length === 1 && (totalFields === undefined || totalFields === 1);
  let nextState = state;
  if (!isKnownSingleField && state.priorityPolicySource === 'derived_single_field') {
    nextState = {
      ...state,
      priorityPolicy: { kind: 'unknown' },
      priorityPolicySource: undefined,
    };
  }

  if (isKnownSingleField) {
    const missing = removeMissing(nextState.missing, ['priority_policy', 'next_field_after_math']);
    if (nextState.priorityPolicy.kind === 'unknown') {
      return {
        ...nextState,
        priorityPolicy: { kind: 'field_first', order: [fields[0]] },
        priorityPolicySource: 'derived_single_field',
        missing,
      };
    }
    return missing.length === nextState.missing.length ? nextState : { ...nextState, missing };
  }

  if (nextState.priorityPolicy.kind === 'unknown') {
    return {
      ...nextState,
      missing: addMissing(nextState.missing, ['priority_policy', 'next_field_after_math']),
    };
  }
  return nextState;
}

function resolveQuestions(state: PlanningIntakeState): string[] {
  return deterministicQuestionsForState(state);
}

function resolveStatus(state: PlanningIntakeState): PlanningIntakeStatus {
  const missingStatus = statusForMissing(state.missing);
  if (missingStatus) return missingStatus;
  return state.tasks.length > 0 || state.examPrepScope ? 'draft_ready' : 'idle';
}

export function finalizeState(state: PlanningIntakeState): PlanningIntakeState {
  const stateWithPriorityMissing = applyPriorityMissingState(state);
  const status = resolveStatus(stateWithPriorityMissing);
  const nextState = {
    ...stateWithPriorityMissing,
    status,
    missing: uniqueList(stateWithPriorityMissing.missing),
    assumptions: uniqueList(stateWithPriorityMissing.assumptions),
    uncertainties: uniqueList(stateWithPriorityMissing.uncertainties),
  };
  const shouldCreateDraft = status === 'draft_ready' && nextState.missing.length === 0;
  return {
    ...nextState,
    questions: resolveQuestions(nextState),
    shouldCreateDraft,
    shouldSavePlan: false,
  };
}
`);

write('src/features/weeklyPlanning/intake/weeklyPlanningReviewCoreFixes.test.ts', `import { describe, expect, it } from 'vitest';
import { validateInterpretedCandidates } from './weeklyPlanningCandidateValidator';
import { applyWeeklyPlanningCommands, createInitialPlanningIntakeState } from './weeklyPlanningIntakeReducer';
import { finalizeState } from './weeklyPlanningMissingStatus';
import type { InterpretedCommandCandidate, InterpreterStateSummary } from './weeklyPlanningInterpreterTypes';

function candidate(command: unknown): InterpretedCommandCandidate {
  return { command: command as never, origin: 'ai_interpreter', needsConfirmation: false };
}

const baseSummary: InterpreterStateSummary = { knownFields: [], confirmedSlots: [] };

describe('weekly planning review core fixes', () => {
  it('rejects duplicate exam fields instead of dropping a confirmed field', () => {
    const result = validateInterpretedCandidates([candidate({
      type: 'set_exam_scope',
      scope: { fields: ['数学', '数学'], yearRange: { startYear: 2025, endYear: 2020, sourceText: '2025〜2020' }, rawText: ['数学'] },
      sourceText: '数学',
      confidence: 'high',
    })], {
      ...baseSummary,
      knownFields: ['数学', '英語'],
      confirmedSlots: ['exam_scope'],
      examScopeSummary: { fields: ['数学', '英語'], rawText: ['数学と英語'] },
    });
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reason).toBe('invalid-command-shape');
  });

  it('preserves every confirmed exam scope attribute while enriching a missing year range', () => {
    const existing = {
      examType: '院試', fields: ['数学', '英語'], totalFields: 2, totalYears: 6,
      strategyHint: 'field_first' as const, unitModel: 'year_field_chunk' as const,
      unitCountHint: 12, rawText: ['既存'],
    };
    const result = validateInterpretedCandidates([candidate({
      type: 'set_exam_scope',
      scope: {
        examType: '院試', fields: ['英語', '数学'], totalFields: 2, totalYears: 6,
        yearRange: { startYear: 2025, endYear: 2020, sourceText: '2025〜2020' },
        strategyHint: 'field_first', unitModel: 'year_field_chunk', unitCountHint: 12, rawText: ['追加'],
      },
      sourceText: '2025〜2020', confidence: 'high',
    })], {
      ...baseSummary,
      knownFields: existing.fields,
      confirmedSlots: ['exam_scope'],
      examScopeSummary: existing,
    });
    expect(result.rejected).toEqual([]);
    const command = result.accepted[0];
    expect(command?.type).toBe('set_exam_scope');
    if (command?.type !== 'set_exam_scope') throw new Error('missing command');
    expect(command.scope).toMatchObject({ ...existing, yearRange: { startYear: 2025, endYear: 2020 } });
    const state = applyWeeklyPlanningCommands({ ...createInitialPlanningIntakeState(), examPrepScope: existing }, [command]);
    expect(state.examPrepScope).toMatchObject({ ...existing, yearRange: { startYear: 2025, endYear: 2020 } });
  });

  it('rejects conflicting confirmed exam attributes', () => {
    const result = validateInterpretedCandidates([candidate({
      type: 'set_exam_scope',
      scope: { examType: '別試験', fields: ['数学'], rawText: ['変更'] },
      sourceText: '変更', confidence: 'high',
    })], {
      ...baseSummary,
      knownFields: ['数学'], confirmedSlots: ['exam_scope'],
      examScopeSummary: { examType: '院試', fields: ['数学'], rawText: ['既存'] },
    });
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reason).toBe('confirmed-exam-scope-attribute-overwrite');
  });

  it.each([
    { type: 'set_priority_policy', policy: { kind: 'field_first' }, sourceText: '数学優先', confidence: 'high' },
    { type: 'set_priority_policy', policy: { kind: 'field_first', order: [null] }, sourceText: '数学優先', confidence: 'high' },
    { type: 'set_priority_policy', policy: { kind: 'field_first', order: ['数学'] }, sourceText: null, confidence: 'high' },
    { type: 'set_priority_policy', policy: { kind: 'field_first', order: ['数学'] }, sourceText: '数学優先', confidence: null },
    { type: 'set_priority_policy', policy: { kind: 'field_first', order: ['数学'] }, sourceText: '数学優先' },
  ])('rejects malformed required command fields %#', (command) => {
    const result = validateInterpretedCandidates([candidate(command)], { ...baseSummary, knownFields: ['数学'] });
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reason).toBe('invalid-command-shape');
  });

  it('does not auto-confirm priority when totalFields says more fields remain', () => {
    const state = finalizeState({
      ...createInitialPlanningIntakeState(),
      examPrepScope: { fields: ['数学'], totalFields: 2, rawText: ['数学ほか'] },
      unitRates: [{ unit: 'year_field_chunk', minutesPerUnit: 60, source: 'user' }],
      missing: [],
    });
    expect(state.priorityPolicy).toEqual({ kind: 'unknown' });
    expect(state.missing).toContain('priority_policy');
  });

  it('reopens priority when a derived single-field policy later becomes multi-field', () => {
    const single = finalizeState({
      ...createInitialPlanningIntakeState(),
      examPrepScope: { fields: ['数学'], totalFields: 1, rawText: ['数学'] },
      unitRates: [{ unit: 'year_field_chunk', minutesPerUnit: 60, source: 'user' }],
      missing: [],
    });
    const multi = finalizeState({
      ...single,
      examPrepScope: { ...single.examPrepScope!, fields: ['数学', '英語'], totalFields: 2 },
    });
    expect(multi.priorityPolicy).toEqual({ kind: 'unknown' });
    expect(multi.missing).toContain('priority_policy');
  });
});
`);

for (const path of [
  'docs/ai/tasks/20260716-weekly-planning-conversation-hardening.md',
]) {
  let content = read(path);
  content = content.replace('Status: closed\nClosed: 2026-07-16', 'Status: open\nReopened: 2026-07-16');
  write(path, content);
}

write('docs/ai/tasks/20260716-weekly-planning-conversation-hardening-review-fixes.md', `# 週間計画対話改善のCodexレビュー指摘を修正する

Status: open
Created: 2026-07-16
Parent: \`20260716-weekly-planning-conversation-hardening.md\`

## 目的

PR #5の初回Codexレビューで確認されたBLOCKER、MAJOR、MINORを、既存機能を壊さず一般化された責務として修正する。

## 実装順

1. exam scope属性単位mergeとpriority provenance
2. command unionの閉じたruntime validation
3. fixed event occurrenceの共通抽出と全対話経路のgrounding
4. session-owned async turnとapproval lock
5. modal再開、storage version、controller契約
6. 全テスト・build・再レビュー

## 完了条件

- [ ] BLOCKER 4件を再現テスト付きで解消する
- [ ] MAJOR 4件を解消する
- [ ] MINOR指摘を解消する
- [ ] 全テストとproduction buildを通す
- [ ] Codex再レビュー用mdを更新する
`);

write('docs/ai/tasks/20260716-weekly-planning-exam-scope-attribute-merge.md', `# exam scopeを属性単位で安全に補完する

Status: open
Created: 2026-07-16
Parent: \`20260716-weekly-planning-conversation-hardening-review-fixes.md\`

## 完了条件

- [ ] fieldsの空文字と重複を拒否する
- [ ] 確定済みfieldsを欠落させない
- [ ] 確定済みexamType、件数、strategy、unit情報を上書きしない
- [ ] 未確定yearRangeだけを補完できる
- [ ] reducer適用後まで既存属性を保持する
- [ ] 自動単一分野priorityにprovenanceを持たせる
- [ ] 分野追加時にpriority確認を再開する
`);

write('docs/ai/tasks/20260716-weekly-planning-closed-command-runtime-validation.md', `# AI command unionを閉じたruntime validatorで検証する

Status: open
Created: 2026-07-16
Parent: \`20260716-weekly-planning-conversation-hardening-review-fixes.md\`

## 完了条件

- [ ] 共通必須type、confidence、sourceTextを検証する
- [ ] command別必須項目と分岐必須項目を検証する
- [ ] 配列要素型と重複を検証する
- [ ] unknown propertyを拒否する
- [ ] optional propertyのnullだけを未指定へ変換する
- [ ] 必須nullと不正confidenceを補修しない
`);

console.log('weekly planning core review fixes applied');
