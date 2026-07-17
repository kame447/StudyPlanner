import {
  isDateWithinWindow,
  isOrderedPlanningDateTimeRange,
  isValidDateWindow,
  isValidPlanningDurationDays,
  isIsoCalendarDate,
} from './intake/weeklyPlanningDateValidation';
import type { PlanningIntakeState } from './intake/weeklyPlanningIntakeTypes';
import type { WeeklyDraftCandidate } from './scheduling/weeklyDraftCandidateGenerator';
import type {
  PlanningState,
  WeeklyPlanDraftBlock,
  WeeklyPlanningBehaviorMetadata,
  WeeklyPlanningMessage,
} from './types';
import { createInitialPlanningState } from './weeklyPlanningReducer';

const STORAGE_VERSION = 2;
const MODES = new Set(['idle', 'collecting_tasks', 'draft_created', 'awaiting_approval', 'confirmed']);
const PLAN_TYPES = new Set(['study', 'mock-exam', 'school-event', 'cram-school', 'deadline', 'other']);
const INTAKE_STATUSES = new Set([
  'idle', 'needs_scope', 'range_collected', 'scope_collected', 'needs_exam_info',
  'needs_year_range', 'needs_progress_clarification', 'needs_unit_rate',
  'needs_priority_policy', 'needs_life_constraints', 'draft_ready',
  'revision_pending', 'approved',
]);
const INTAKE_INTENTS = new Set([
  'weekly_study_planning', 'exam_prep_planning', 'regular_schedule', 'study_advice', 'unknown',
]);
const STUDY_SCOPE_UNITS = new Set([
  'minutes', 'hours', 'pages', 'problems', 'words', 'lessons', 'chapters',
  'year_field_chunk', 'topic', 'unknown',
]);
const MISSING_SLOTS = new Set([
  'planning_period', 'planning_start_date', 'planning_duration', 'tasks_or_goals',
  'fixed_events', 'sleep_cycle', 'meal_bath_constraints', 'year_range', 'progress',
  'completion_direction', 'unit_duration_estimate', 'priority_policy',
  'next_field_after_math', 'life_constraints',
]);
const LIFE_CONSTRAINT_KINDS = new Set([
  'sleep', 'meal', 'bath', 'commute', 'club', 'cram_school', 'fixed_event',
  'unavailable', 'buffer',
]);
const QUESTION_CONTEXT_KINDS = new Set([
  'missing', 'feasibility_adjustment', 'options', 'preview', 'approval', 'ambiguity',
]);
const PREVIEW_ELIGIBILITY = new Set([
  'eligible', 'blocked_pending_assumption', 'blocked_stale', 'blocked_invalid', 'unsupported',
]);
const PLANNING_OPPORTUNITY_TAGS = new Set([
  'before_meal', 'after_meal', 'after_school', 'after_work', 'after_commute',
  'before_sleep', 'after_rest', 'long_contiguous_window', 'short_transition_window',
  'low_activation', 'high_continuity',
]);

interface StoredPlanningStateV2 {
  version: 2;
  state: PlanningState;
}

function getStorageKey(userId: string, weekStartDate: string): string {
  return `studyplanner.weeklyPlanning.${userId}.${weekStartDate}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isPlanningOpportunityTagArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every((item) => typeof item === 'string' && PLANNING_OPPORTUNITY_TAGS.has(item));
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isInteger(value) && value > 0;
}

function isOptionalFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function isOptionalPositiveInteger(value: unknown): value is number | undefined {
  return value === undefined || isPositiveInteger(value);
}

function isOptionalStringOrNull(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string';
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isTime(value: unknown): value is string {
  return typeof value === 'string'
    && (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) || value === '24:00');
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isMessage(value: unknown): value is WeeklyPlanningMessage {
  if (!isRecord(value) || !hasOnlyKeys(value, ['id', 'role', 'content', 'createdAt'])) return false;
  return typeof value.id === 'string'
    && (value.role === 'user' || value.role === 'assistant')
    && typeof value.content === 'string'
    && isTimestamp(value.createdAt);
}

function isAssumptionDependency(value: unknown): boolean {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['proposalId', 'targetRef', 'proposalCreatedFromStateRevision'])) {
    return false;
  }
  return typeof value.proposalId === 'string'
    && typeof value.targetRef === 'string'
    && isNonNegativeInteger(value.proposalCreatedFromStateRevision);
}

function isPreviewMetadata(value: unknown): boolean {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      'previewId', 'conversationId', 'stateRevision', 'assumptionDependencies',
      'approvalEligibility', 'stale', 'authorizedUserId',
    ])) {
    return false;
  }
  return typeof value.previewId === 'string'
    && isOptionalString(value.conversationId)
    && isNonNegativeInteger(value.stateRevision)
    && Array.isArray(value.assumptionDependencies)
    && value.assumptionDependencies.every(isAssumptionDependency)
    && PREVIEW_ELIGIBILITY.has(String(value.approvalEligibility))
    && typeof value.stale === 'boolean'
    && typeof value.authorizedUserId === 'string';
}

function isBehaviorMetadata(value: unknown): value is WeeklyPlanningBehaviorMetadata {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      'conversationId', 'stateRevision', 'sourceFactRefs', 'usedAssumptionProposalRefs',
      'acceptedAssumptionDependencies', 'taskRef', 'opportunityTags', 'reasoningKey',
      'compatibility', 'previewMetadata',
    ])) {
    return false;
  }
  if (!isRecord(value.compatibility)
    || !hasOnlyKeys(value.compatibility, [
      'workItemSemantic', 'schedulerInputSource', 'candidateSource',
    ])) {
    return false;
  }
  return isOptionalString(value.conversationId)
    && isNonNegativeInteger(value.stateRevision)
    && isStringArray(value.sourceFactRefs)
    && isStringArray(value.usedAssumptionProposalRefs)
    && (value.acceptedAssumptionDependencies === undefined
      || (Array.isArray(value.acceptedAssumptionDependencies)
        && value.acceptedAssumptionDependencies.every(isAssumptionDependency)))
    && typeof value.taskRef === 'string'
    && isPlanningOpportunityTagArray(value.opportunityTags)
    && typeof value.reasoningKey === 'string'
    && value.compatibility.workItemSemantic === 'behavior_aware_task'
    && value.compatibility.schedulerInputSource === 'exam_prep_request'
    && value.compatibility.candidateSource === 'weekly_exam_prep'
    && (value.previewMetadata === undefined || isPreviewMetadata(value.previewMetadata));
}

function isBehaviorAwarePreviewMetadata(value: unknown): boolean {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      'conversationId', 'stateRevision', 'sourceFactRefs', 'usedAssumptionProposalRefs',
      'acceptedAssumptionDependencies', 'taskRef', 'opportunityTags', 'reasoningKey',
    ])) {
    return false;
  }
  return isOptionalString(value.conversationId)
    && isNonNegativeInteger(value.stateRevision)
    && isStringArray(value.sourceFactRefs)
    && isStringArray(value.usedAssumptionProposalRefs)
    && (value.acceptedAssumptionDependencies === undefined
      || (Array.isArray(value.acceptedAssumptionDependencies)
        && value.acceptedAssumptionDependencies.every(isAssumptionDependency)))
    && typeof value.taskRef === 'string'
    && isPlanningOpportunityTagArray(value.opportunityTags)
    && (value.reasoningKey === 'explicit-duration'
      || value.reasoningKey === 'explicit-unit-rate'
      || value.reasoningKey === 'accepted-assumption-duration');
}

function isDraftBlock(value: unknown): value is WeeklyPlanDraftBlock {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      'id', 'userId', 'date', 'startTime', 'endTime', 'title', 'subject', 'type', 'label',
      'materialId', 'materialName', 'memo', 'source', 'status', 'userEdited',
      'behaviorMetadata', 'createdAt', 'updatedAt',
    ])) {
    return false;
  }
  return typeof value.id === 'string'
    && typeof value.userId === 'string'
    && isDate(value.date)
    && isTime(value.startTime)
    && isTime(value.endTime)
    && typeof value.title === 'string'
    && typeof value.subject === 'string'
    && PLAN_TYPES.has(String(value.type))
    && typeof value.label === 'string'
    && isOptionalStringOrNull(value.materialId)
    && isOptionalString(value.materialName)
    && isOptionalString(value.memo)
    && value.source === 'ai'
    && value.status === 'draft'
    && typeof value.userEdited === 'boolean'
    && (value.behaviorMetadata === undefined || isBehaviorMetadata(value.behaviorMetadata))
    && isTimestamp(value.createdAt)
    && isTimestamp(value.updatedAt);
}

function isPreviewCandidate(value: unknown): value is WeeklyDraftCandidate {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      'stableKey', 'date', 'startTime', 'endTime', 'durationMinutes', 'title', 'field',
      'year', 'estimatedMinutes', 'source', 'approvalStatus', 'workItemKey', 'behaviorMetadata',
    ])) {
    return false;
  }
  return typeof value.stableKey === 'string'
    && isDate(value.date)
    && isTime(value.startTime)
    && isTime(value.endTime)
    && isPositiveInteger(value.durationMinutes)
    && typeof value.title === 'string'
    && typeof value.field === 'string'
    && isInteger(value.year)
    && isPositiveInteger(value.estimatedMinutes)
    && value.source === 'weekly_exam_prep'
    && value.approvalStatus === 'unapproved'
    && typeof value.workItemKey === 'string'
    && (value.behaviorMetadata === undefined
      || isBehaviorAwarePreviewMetadata(value.behaviorMetadata));
}

function isPlanningRange(value: unknown): boolean {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      'startDateTime', 'endDateTime', 'sourceText', 'calendarDayCount', 'confidence',
    ])) {
    return false;
  }
  return isOptionalString(value.startDateTime)
    && isOptionalString(value.endDateTime)
    && ((value.startDateTime === undefined && value.endDateTime === undefined)
      || isOrderedPlanningDateTimeRange(value))
    && isOptionalString(value.sourceText)
    && isOptionalPositiveInteger(value.calendarDayCount)
    && (value.confidence === 'explicit'
      || value.confidence === 'inferred'
      || value.confidence === 'missing');
}

function isPendingPlanningRange(value: unknown): boolean {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['scope', 'planningStartDate', 'durationDays', 'sourceText'])
    || !isRecord(value.scope)
    || !hasOnlyKeys(value.scope, [
      'kind', 'label', 'windowStartDate', 'windowEndDate',
    ])) {
    return false;
  }
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

function isYearRange(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ['startYear', 'endYear', 'sourceText'])) {
    return false;
  }
  return isInteger(value.startYear)
    && isInteger(value.endYear)
    && typeof value.sourceText === 'string';
}

function isExamPrepScope(value: unknown): boolean {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      'examType', 'fields', 'totalFields', 'totalYears', 'yearRange', 'strategyHint',
      'unitModel', 'unitCountHint', 'rawText',
    ])) {
    return false;
  }
  return isOptionalString(value.examType)
    && isStringArray(value.fields)
    && isOptionalPositiveInteger(value.totalFields)
    && isOptionalPositiveInteger(value.totalYears)
    && (value.yearRange === undefined || isYearRange(value.yearRange))
    && (value.strategyHint === undefined
      || value.strategyHint === 'field_first'
      || value.strategyHint === 'year_first'
      || value.strategyHint === 'unknown')
    && (value.unitModel === undefined || STUDY_SCOPE_UNITS.has(String(value.unitModel)))
    && isOptionalPositiveInteger(value.unitCountHint)
    && isStringArray(value.rawText);
}

function isTask(value: unknown): boolean {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      'title', 'subject', 'examType', 'field', 'year', 'unit', 'amount', 'rawText',
      'requiresTimeEstimate', 'source',
    ])) {
    return false;
  }
  return typeof value.title === 'string'
    && isOptionalString(value.subject)
    && isOptionalString(value.examType)
    && isOptionalString(value.field)
    && (value.year === undefined || isInteger(value.year))
    && STUDY_SCOPE_UNITS.has(String(value.unit))
    && isOptionalFiniteNumber(value.amount)
    && typeof value.rawText === 'string'
    && typeof value.requiresTimeEstimate === 'boolean'
    && (value.source === 'command' || value.source === 'legacy_fallback');
}

function isCompletionTarget(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  switch (value.kind) {
    case 'all':
    case 'up_to_reachable':
      return hasOnlyKeys(value, ['kind', 'rawText']) && typeof value.rawText === 'string';
    case 'latest_n_years':
      return hasOnlyKeys(value, ['kind', 'count', 'rawText'])
        && isPositiveInteger(value.count)
        && typeof value.rawText === 'string';
    case 'year_range':
      return hasOnlyKeys(value, ['kind', 'startYear', 'endYear', 'rawText'])
        && isInteger(value.startYear)
        && isInteger(value.endYear)
        && typeof value.rawText === 'string';
    default:
      return false;
  }
}

function isProgress(value: unknown): boolean {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      'field', 'completedYears', 'completionTarget', 'completionBoundaryYear', 'current',
      'incomplete', 'ambiguity', 'rawText',
    ])) {
    return false;
  }
  return isOptionalString(value.field)
    && (value.completedYears === undefined
      || (Array.isArray(value.completedYears) && value.completedYears.every(isInteger)))
    && (value.completionTarget === undefined || isCompletionTarget(value.completionTarget))
    && (value.completionBoundaryYear === undefined || isInteger(value.completionBoundaryYear))
    && isOptionalString(value.current)
    && (value.incomplete === undefined || isStringArray(value.incomplete))
    && (value.ambiguity === 'completion_direction'
      || value.ambiguity === 'year_range'
      || value.ambiguity === 'field_scope'
      || value.ambiguity === 'scope_range'
      || value.ambiguity === 'none')
    && typeof value.rawText === 'string';
}

function isUnitRate(value: unknown): boolean {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['unit', 'minutesPerUnit', 'source', 'uncertainty', 'rawText'])) {
    return false;
  }
  return STUDY_SCOPE_UNITS.has(String(value.unit))
    && isOptionalFiniteNumber(value.minutesPerUnit)
    && (value.source === 'user' || value.source === 'assumption' || value.source === 'default')
    && (value.uncertainty === undefined
      || value.uncertainty === 'low'
      || value.uncertainty === 'medium'
      || value.uncertainty === 'high')
    && isOptionalString(value.rawText);
}

function isLifeConstraint(value: unknown): boolean {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      'kind', 'date', 'start', 'end', 'durationMinutes', 'studyAvailableStart',
      'hardness', 'rawText',
    ])) {
    return false;
  }
  return LIFE_CONSTRAINT_KINDS.has(String(value.kind))
    && isOptionalString(value.date)
    && isOptionalString(value.start)
    && isOptionalString(value.end)
    && isOptionalFiniteNumber(value.durationMinutes)
    && isOptionalString(value.studyAvailableStart)
    && (value.hardness === 'hard' || value.hardness === 'soft')
    && isOptionalString(value.rawText);
}

function isConstraintSource(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ['kind', 'selector'])) return false;
  return (value.kind === 'timetable'
      || value.kind === 'existing_plans'
      || value.kind === 'calendar')
    && value.selector === 'active';
}

function isPriorityPolicy(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'field_first') {
    return hasOnlyKeys(value, ['kind', 'order']) && isStringArray(value.order);
  }
  return hasOnlyKeys(value, ['kind'])
    && (value.kind === 'deadline_first'
      || value.kind === 'weakness_first'
      || value.kind === 'score_weight_first'
      || value.kind === 'balanced'
      || value.kind === 'unknown');
}

function isQuestionContext(value: unknown): boolean {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['kind', 'targetSlot', 'intent', 'topicId', 'actionId'])) {
    return false;
  }
  return QUESTION_CONTEXT_KINDS.has(String(value.kind))
    && isOptionalString(value.targetSlot)
    && isOptionalString(value.intent)
    && isOptionalString(value.topicId)
    && isOptionalString(value.actionId);
}

function isPlanningIntakeState(value: unknown): value is PlanningIntakeState {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      'status', 'intent', 'range', 'pendingPlanningRange', 'examPrepScope', 'tasks',
      'progress', 'unitRates', 'constraints', 'constraintSourcesInUse',
      'fixedEventsDeclaredNone', 'priorityPolicy', 'priorityPolicySource', 'missing',
      'assumptions', 'uncertainties', 'questions', 'lastQuestionContext',
      'shouldCreateDraft', 'shouldSavePlan', 'draftGenerationIntent',
      'draftGenerationAuthorizedAtRevision', 'sourceTurns',
    ])) {
    return false;
  }
  return INTAKE_STATUSES.has(String(value.status))
    && INTAKE_INTENTS.has(String(value.intent))
    && (value.range === undefined || isPlanningRange(value.range))
    && (value.pendingPlanningRange === undefined || isPendingPlanningRange(value.pendingPlanningRange))
    && (value.examPrepScope === undefined || isExamPrepScope(value.examPrepScope))
    && Array.isArray(value.tasks)
    && value.tasks.every(isTask)
    && Array.isArray(value.progress)
    && value.progress.every(isProgress)
    && Array.isArray(value.unitRates)
    && value.unitRates.every(isUnitRate)
    && Array.isArray(value.constraints)
    && value.constraints.every(isLifeConstraint)
    && (value.constraintSourcesInUse === undefined
      || (Array.isArray(value.constraintSourcesInUse)
        && value.constraintSourcesInUse.every(isConstraintSource)))
    && (value.fixedEventsDeclaredNone === undefined || value.fixedEventsDeclaredNone === true)
    && isPriorityPolicy(value.priorityPolicy)
    && (value.priorityPolicySource === undefined
      || value.priorityPolicySource === 'user'
      || value.priorityPolicySource === 'derived_single_field')
    && Array.isArray(value.missing)
    && value.missing.every((item) => MISSING_SLOTS.has(String(item)))
    && isStringArray(value.assumptions)
    && Array.isArray(value.uncertainties)
    && value.uncertainties.every((item) => item === 'unknown_fields_may_take_longer')
    && isStringArray(value.questions)
    && (value.lastQuestionContext === undefined || isQuestionContext(value.lastQuestionContext))
    && typeof value.shouldCreateDraft === 'boolean'
    && value.shouldSavePlan === false
    && (value.draftGenerationIntent === undefined
      || value.draftGenerationIntent === 'not_requested'
      || value.draftGenerationIntent === 'assistant_suggested'
      || value.draftGenerationIntent === 'user_authorized')
    && (value.draftGenerationAuthorizedAtRevision === undefined
      || isNonNegativeInteger(value.draftGenerationAuthorizedAtRevision))
    && isStringArray(value.sourceTurns);
}

function sanitizeStoredIntakeState(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const { assumptionProposalRecords: _sessionOnlyRecords, ...sanitized } = value;
  return sanitized;
}

function sanitizeStoredPlanningState(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const {
    pendingTurn: _pendingTurn,
    pendingApproval: _pendingApproval,
    ...sanitized
  } = value;
  return {
    ...sanitized,
    previewCandidates: sanitized.previewCandidates ?? [],
    intakeState: sanitized.intakeState === undefined
      ? undefined
      : sanitizeStoredIntakeState(sanitized.intakeState),
  };
}

function isPlanningState(value: unknown): value is PlanningState {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      'weekStartDate', 'revision', 'mode', 'draftBlocks', 'previewCandidates', 'messages',
      'intakeState', 'lastAssistantMessage', 'updatedAt',
    ])) {
    return false;
  }
  return typeof value.weekStartDate === 'string'
    && isNonNegativeInteger(value.revision)
    && MODES.has(String(value.mode))
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
