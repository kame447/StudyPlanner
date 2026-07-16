import {
  isDateWithinWindow,
  isIsoCalendarDate,
  isOrderedPlanningDateTimeRange,
  isValidDateWindow,
  isValidPlanningDurationDays,
} from './intake/weeklyPlanningDateValidation';
import type { PlanningIntakeState } from './intake/weeklyPlanningIntakeTypes';
import type { WeeklyDraftCandidate } from './scheduling/weeklyDraftCandidateGenerator';
import type {
  PlanningState,
  WeeklyPlanDraftBlock,
  WeeklyPlanningMessage,
} from './weeklyPlanningSessionTypes';
import { createInitialPlanningState } from './weeklyPlanningSessionTypes';

const STORAGE_PREFIX = 'study-planner:weekly-planning:v2';
const STORAGE_VERSION = 2;

interface StoredPlanningStateV2 {
  version: typeof STORAGE_VERSION;
  state: PlanningState;
}

const MODES = new Set<PlanningState['mode']>(['idle', 'editing', 'preview', 'approval', 'applied']);
const DRAFT_BLOCK_STATUSES = new Set<WeeklyPlanDraftBlock['status']>([
  'draft',
  'applied',
  'cancelled',
]);
const MESSAGE_ROLES = new Set<WeeklyPlanningMessage['role']>(['user', 'assistant']);
const INTAKE_STATUSES = new Set<PlanningIntakeState['status']>([
  'idle',
  'needs_scope',
  'range_collected',
  'scope_collected',
  'needs_exam_info',
  'needs_year_range',
  'needs_progress_clarification',
  'needs_unit_rate',
  'needs_priority_policy',
  'needs_life_constraints',
  'draft_ready',
  'revision_pending',
  'approved',
]);
const INTAKE_INTENTS = new Set<PlanningIntakeState['intent']>([
  'weekly_study_planning',
  'exam_prep_planning',
  'regular_schedule',
  'study_advice',
  'unknown',
]);
const MISSING_SLOTS = new Set<PlanningIntakeState['missing'][number]>([
  'planning_period',
  'planning_start_date',
  'planning_duration',
  'tasks_or_goals',
  'fixed_events',
  'sleep_cycle',
  'meal_bath_constraints',
  'year_range',
  'progress',
  'completion_direction',
  'unit_duration_estimate',
  'priority_policy',
  'next_field_after_math',
  'life_constraints',
]);
const UNCERTAINTIES = new Set<PlanningIntakeState['uncertainties'][number]>([
  'unknown_fields_may_take_longer',
]);
const TASK_UNITS = new Set<PlanningIntakeState['tasks'][number]['unit']>([
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
const TASK_SOURCES = new Set<PlanningIntakeState['tasks'][number]['source']>([
  'command',
  'legacy_fallback',
]);
const PROGRESS_AMBIGUITIES = new Set<PlanningIntakeState['progress'][number]['ambiguity']>([
  'completion_direction',
  'year_range',
  'field_scope',
  'scope_range',
  'none',
]);
const COMPLETION_TARGET_KINDS = new Set(['all', 'latest_n_years', 'up_to_reachable', 'year_range']);
const RATE_SOURCES = new Set<PlanningIntakeState['unitRates'][number]['source']>([
  'user',
  'assumption',
  'default',
]);
const RATE_UNCERTAINTIES = new Set(['low', 'medium', 'high']);
const CONSTRAINT_KINDS = new Set<PlanningIntakeState['constraints'][number]['kind']>([
  'sleep',
  'meal',
  'bath',
  'commute',
  'club',
  'cram_school',
  'fixed_event',
  'unavailable',
  'buffer',
]);
const HARDNESS_VALUES = new Set<PlanningIntakeState['constraints'][number]['hardness']>([
  'hard',
  'soft',
]);
const PRIORITY_KINDS = new Set<PlanningIntakeState['priorityPolicy']['kind']>([
  'field_first',
  'deadline_first',
  'weakness_first',
  'score_weight_first',
  'balanced',
  'unknown',
]);
const CONSTRAINT_SOURCE_KINDS = new Set(['timetable', 'existing_plans', 'calendar']);
const DRAFT_INTENTS = new Set(['not_requested', 'assistant_suggested', 'user_authorized']);
const QUESTION_CONTEXT_KINDS = new Set([
  'missing',
  'feasibility_adjustment',
  'options',
  'preview',
  'approval',
  'ambiguity',
]);

function getStorageKey(userId: string, weekStartDate: string): string {
  return `${STORAGE_PREFIX}:${userId}:${weekStartDate}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isOptionalFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function isOptionalPositiveInteger(value: unknown): value is number | undefined {
  return value === undefined || (Number.isInteger(value) && Number(value) > 0);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isSessionTime(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (/^([01]?\d|2[0-3]):[0-5]\d$/.test(value)) return true;
  const match = value.match(/^24:([0-5]\d)$/);
  return Boolean(match && Number(match[1]) === 0);
}

function isSessionWindow(value: unknown): boolean {
  return isRecord(value)
    && isSessionTime(value.start)
    && isSessionTime(value.end);
}

function isQuestionContext(value: unknown): boolean {
  return isRecord(value)
    && QUESTION_CONTEXT_KINDS.has(String(value.kind))
    && isOptionalString(value.targetSlot)
    && isOptionalString(value.intent)
    && isOptionalString(value.topicId)
    && isOptionalString(value.actionId);
}

function isMessage(value: unknown): value is WeeklyPlanningMessage {
  return isRecord(value)
    && typeof value.id === 'string'
    && MESSAGE_ROLES.has(String(value.role) as WeeklyPlanningMessage['role'])
    && typeof value.content === 'string'
    && isTimestamp(value.createdAt);
}

function isDraftBlock(value: unknown): value is WeeklyPlanDraftBlock {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.summary === 'string'
    && DRAFT_BLOCK_STATUSES.has(String(value.status) as WeeklyPlanDraftBlock['status'])
    && isTimestamp(value.createdAt)
    && (value.payload === undefined || isRecord(value.payload));
}

function isPreviewCandidate(value: unknown): value is WeeklyDraftCandidate {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.sourceRef === 'string'
    && typeof value.title === 'string'
    && typeof value.startDateTime === 'string'
    && typeof value.endDateTime === 'string'
    && typeof value.estimatedMinutes === 'number'
    && Number.isFinite(value.estimatedMinutes)
    && typeof value.ordinal === 'number'
    && Number.isInteger(value.ordinal)
    && typeof value.field === 'string'
    && typeof value.year === 'number'
    && Number.isInteger(value.year)
    && typeof value.status === 'string'
    && value.status === 'preview';
}

function isPendingPlanningRange(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.scope)) return false;
  const scope = value.scope;
  if ((scope.kind !== 'next_week' && scope.kind !== 'named_future_period')
    || typeof scope.label !== 'string'
    || !isOptionalString(scope.windowStartDate)
    || !isOptionalString(scope.windowEndDate)
    || !isValidDateWindow(scope)
    || !isOptionalString(value.planningStartDate)
    || (value.durationDays !== undefined && !isValidPlanningDurationDays(value.durationDays))
    || typeof value.sourceText !== 'string') {
    return false;
  }
  if (scope.kind === 'next_week'
    && (!scope.windowStartDate || !scope.windowEndDate)) {
    return false;
  }
  if (value.planningStartDate !== undefined
    && (!isIsoCalendarDate(value.planningStartDate)
      || !isDateWithinWindow(value.planningStartDate, scope))) {
    return false;
  }
  return !(value.planningStartDate !== undefined
    && value.durationDays !== undefined);
}

function isCompletionTarget(value: unknown): boolean {
  if (!isRecord(value) || !COMPLETION_TARGET_KINDS.has(String(value.kind))) return false;
  if ((value.kind === 'all' || value.kind === 'up_to_reachable') && typeof value.rawText === 'string') {
    return true;
  }
  if (value.kind === 'latest_n_years') {
    return Number.isInteger(value.count) && Number(value.count) > 0 && typeof value.rawText === 'string';
  }
  return value.kind === 'year_range'
    && Number.isInteger(value.startYear)
    && Number.isInteger(value.endYear)
    && typeof value.rawText === 'string';
}

function isTask(value: unknown): boolean {
  return isRecord(value)
    && typeof value.title === 'string'
    && isOptionalString(value.subject)
    && isOptionalString(value.examType)
    && isOptionalString(value.field)
    && (value.year === undefined || Number.isInteger(value.year))
    && TASK_UNITS.has(String(value.unit) as PlanningIntakeState['tasks'][number]['unit'])
    && isOptionalFiniteNumber(value.amount)
    && typeof value.rawText === 'string'
    && typeof value.requiresTimeEstimate === 'boolean'
    && TASK_SOURCES.has(String(value.source) as PlanningIntakeState['tasks'][number]['source']);
}

function isProgress(value: unknown): boolean {
  return isRecord(value)
    && isOptionalString(value.field)
    && (value.completedYears === undefined || isNumberArray(value.completedYears))
    && (value.completionTarget === undefined || isCompletionTarget(value.completionTarget))
    && (value.completionBoundaryYear === undefined || Number.isInteger(value.completionBoundaryYear))
    && isOptionalString(value.current)
    && (value.incomplete === undefined || isStringArray(value.incomplete))
    && PROGRESS_AMBIGUITIES.has(String(value.ambiguity) as PlanningIntakeState['progress'][number]['ambiguity'])
    && typeof value.rawText === 'string';
}

function isUnitRate(value: unknown): boolean {
  return isRecord(value)
    && TASK_UNITS.has(String(value.unit) as PlanningIntakeState['unitRates'][number]['unit'])
    && isOptionalFiniteNumber(value.minutesPerUnit)
    && RATE_SOURCES.has(String(value.source) as PlanningIntakeState['unitRates'][number]['source'])
    && (value.uncertainty === undefined || RATE_UNCERTAINTIES.has(String(value.uncertainty)))
    && isOptionalString(value.rawText);
}

function isConstraint(value: unknown): boolean {
  return isRecord(value)
    && CONSTRAINT_KINDS.has(String(value.kind) as PlanningIntakeState['constraints'][number]['kind'])
    && isOptionalString(value.date)
    && isOptionalString(value.start)
    && isOptionalString(value.end)
    && isOptionalFiniteNumber(value.durationMinutes)
    && isOptionalString(value.studyAvailableStart)
    && HARDNESS_VALUES.has(String(value.hardness) as PlanningIntakeState['constraints'][number]['hardness'])
    && isOptionalString(value.rawText);
}

function isPriorityPolicy(value: unknown): boolean {
  if (!isRecord(value) || !PRIORITY_KINDS.has(String(value.kind) as PlanningIntakeState['priorityPolicy']['kind'])) {
    return false;
  }
  return value.kind !== 'field_first' || isStringArray(value.order);
}

function isExamScope(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.fields) || !value.fields.every((field) => typeof field === 'string')) {
    return false;
  }
  if (!isOptionalString(value.examType)
    || !isOptionalPositiveInteger(value.totalFields)
    || !isOptionalPositiveInteger(value.totalYears)
    || !isOptionalPositiveInteger(value.unitCountHint)
    || !isStringArray(value.rawText)) {
    return false;
  }
  if (value.yearRange !== undefined) {
    if (!isRecord(value.yearRange)
      || !Number.isInteger(value.yearRange.startYear)
      || !Number.isInteger(value.yearRange.endYear)
      || typeof value.yearRange.sourceText !== 'string') {
      return false;
    }
  }
  return value.strategyHint === undefined
    || value.strategyHint === 'field_first'
    || value.strategyHint === 'year_first'
    || value.strategyHint === 'unknown';
}

function isPlanningRange(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isOptionalString(value.startDateTime)
    && isOptionalString(value.endDateTime)
    && ((value.startDateTime === undefined && value.endDateTime === undefined)
      || isOrderedPlanningDateTimeRange(value))
    && isOptionalString(value.sourceText)
    && isOptionalPositiveInteger(value.calendarDayCount)
    && (value.confidence === 'explicit' || value.confidence === 'inferred' || value.confidence === 'missing');
}

function isPlanningIntakeState(value: unknown): value is PlanningIntakeState {
  if (!isRecord(value)) return false;
  return INTAKE_STATUSES.has(String(value.status) as PlanningIntakeState['status'])
    && INTAKE_INTENTS.has(String(value.intent) as PlanningIntakeState['intent'])
    && (value.range === undefined || isPlanningRange(value.range))
    && (value.pendingPlanningRange === undefined || isPendingPlanningRange(value.pendingPlanningRange))
    && (value.examPrepScope === undefined || isExamScope(value.examPrepScope))
    && Array.isArray(value.tasks) && value.tasks.every(isTask)
    && Array.isArray(value.progress) && value.progress.every(isProgress)
    && Array.isArray(value.unitRates) && value.unitRates.every(isUnitRate)
    && Array.isArray(value.constraints) && value.constraints.every(isConstraint)
    && (value.constraintSourcesInUse === undefined
      || (Array.isArray(value.constraintSourcesInUse)
        && value.constraintSourcesInUse.every((source) =>
          isRecord(source)
          && CONSTRAINT_SOURCE_KINDS.has(String(source.kind))
          && source.selector === 'active')))
    && (value.fixedEventsDeclaredNone === undefined || value.fixedEventsDeclaredNone === true)
    && isPriorityPolicy(value.priorityPolicy)
    && (value.priorityPolicySource === undefined
      || value.priorityPolicySource === 'user'
      || value.priorityPolicySource === 'derived_single_field')
    && Array.isArray(value.missing)
    && value.missing.every((slot) => MISSING_SLOTS.has(slot as PlanningIntakeState['missing'][number]))
    && isStringArray(value.assumptions)
    && Array.isArray(value.uncertainties)
    && value.uncertainties.every((uncertainty) =>
      UNCERTAINTIES.has(uncertainty as PlanningIntakeState['uncertainties'][number]))
    && isStringArray(value.questions)
    && (value.lastQuestionContext === undefined || isQuestionContext(value.lastQuestionContext))
    && typeof value.shouldCreateDraft === 'boolean'
    && value.shouldSavePlan === false
    && (value.draftGenerationIntent === undefined || DRAFT_INTENTS.has(String(value.draftGenerationIntent)))
    && (value.draftGenerationAuthorizedAtRevision === undefined
      || isNonNegativeInteger(value.draftGenerationAuthorizedAtRevision))
    && isStringArray(value.sourceTurns);
}

function sanitizeStoredIntakeState(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const sanitized = { ...value };
  delete sanitized.assumptionProposalRecords;
  return sanitized;
}

function sanitizeStoredPlanningState(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const sanitized = { ...value };
  delete sanitized.pendingTurn;
  delete sanitized.pendingApproval;
  sanitized.intakeState = sanitizeStoredIntakeState(sanitized.intakeState);
  return sanitized;
}

function isPlanningState(value: unknown): value is PlanningState {
  if (!isRecord(value)) return false;
  return typeof value.weekStartDate === 'string'
    && isNonNegativeInteger(value.revision)
    && MODES.has(String(value.mode) as PlanningState['mode'])
    && Array.isArray(value.draftBlocks)
    && value.draftBlocks.every(isDraftBlock)
    && Array.isArray(value.previewCandidates)
    && value.previewCandidates.every(isPreviewCandidate)
    && Array.isArray(value.messages)
    && value.messages.every(isMessage)
    && (value.intakeState === undefined || isPlanningIntakeState(value.intakeState))
    && isOptionalString(value.lastAssistantMessage)
    && isTimestamp(value.updatedAt);
}

function parseStoredPlanningState(value: unknown): PlanningState | null {
  const sanitized = sanitizeStoredPlanningState(value);
  return isPlanningState(sanitized) ? sanitized : null;
}

function migrateLegacyPlanningState(value: unknown): PlanningState | null {
  if (!isRecord(value)) return null;
  return parseStoredPlanningState({
    ...value,
    revision: isNonNegativeInteger(value.revision) ? value.revision : 0,
    previewCandidates: value.previewCandidates ?? [],
  });
}

function serializableIntakeState(
  intakeState: PlanningState['intakeState'],
): PlanningState['intakeState'] {
  if (!intakeState) return undefined;
  const { assumptionProposalRecords: _sessionOnlyRecords, ...serializable } = intakeState;
  return serializable;
}

function serializablePlanningState(state: PlanningState): PlanningState {
  const { pendingTurn: _pendingTurn, pendingApproval: _pendingApproval, ...serializable } = state;
  return {
    ...serializable,
    draftBlocks: state.draftBlocks.filter((block) => block.status === 'draft'),
    previewCandidates: state.previewCandidates ?? [],
    intakeState: serializableIntakeState(state.intakeState),
  };
}

export function loadWeeklyPlanningState(
  userId: string,
  weekStartDate: string,
): PlanningState {
  if (typeof window === 'undefined') return createInitialPlanningState(weekStartDate);

  try {
    const rawValue = window.localStorage.getItem(getStorageKey(userId, weekStartDate));
    if (!rawValue) return createInitialPlanningState(weekStartDate);
    const parsedValue: unknown = JSON.parse(rawValue);
    const storedState = isRecord(parsedValue) && 'version' in parsedValue
      ? parsedValue.version === STORAGE_VERSION
        ? parseStoredPlanningState(parsedValue.state)
        : null
      : migrateLegacyPlanningState(parsedValue);
    if (!storedState) return createInitialPlanningState(weekStartDate);
    return {
      ...storedState,
      weekStartDate,
      pendingTurn: undefined,
      pendingApproval: undefined,
      draftBlocks: storedState.draftBlocks.filter((block) => block.status === 'draft'),
      previewCandidates: storedState.previewCandidates ?? [],
      intakeState: storedState.intakeState
        ? sanitizeStoredIntakeState(storedState.intakeState) as PlanningIntakeState
        : undefined,
    };
  } catch {
    return createInitialPlanningState(weekStartDate);
  }
}

export function saveWeeklyPlanningState(userId: string, state: PlanningState): void {
  if (typeof window === 'undefined') return;
  const serializableState = serializablePlanningState(state);

  try {
    const key = getStorageKey(userId, state.weekStartDate);
    if (
      serializableState.draftBlocks.length === 0
      && (serializableState.previewCandidates?.length ?? 0) === 0
      && serializableState.messages.length === 0
      && !serializableState.intakeState
    ) {
      window.localStorage.removeItem(key);
      return;
    }
    const envelope: StoredPlanningStateV2 = { version: STORAGE_VERSION, state: serializableState };
    window.localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // localStorage is best effort; the in-memory session remains authoritative.
  }
}
