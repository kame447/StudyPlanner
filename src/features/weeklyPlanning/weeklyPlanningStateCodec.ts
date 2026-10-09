import { isWeeklyPlanningApprovalRecovery } from './planning/weeklyPlanningApprovalRecovery';
import {
  isDateWithinWindow,
  isOrderedPlanningDateTimeRange,
  isValidDateWindow,
  isValidPlanningDateTime,
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
  WeeklyPlanningReasoningKey,
} from './types';
import { decodeWeeklyPlanningQuestionPresentation } from './intake/weeklyPlanningQuestionPresentation';
import { readWeeklyPlanningProvisionalTimeboxStateV5 } from './intake/weeklyPlanningProvisionalTimeboxStateV5';
import { validC5SessionRecords } from './application/c5LocalSelection/basis';


export type WeeklyPlanningPersistedStateFormat =
  | { kind: 'compat_v2' }
  | {
      kind: 'stable_v5_session_v1';
      ownerId: string;
      weekStartDate: string;
      conversationId: string;
      graphRevision: number;
    };

export const MAX_WEEKLY_PLANNING_STORED_MESSAGES = 200;
const MAX_MESSAGE_CONTENT_LENGTH = 20_000;
const MAX_DRAFT_BLOCKS = 500;
const MAX_PREVIEW_CANDIDATES = 500;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

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
const STUDY_TIME_PREFERENCE_KINDS = new Set(['avoid_morning', 'prefer_before_sleep']);
const STUDY_ACTIVITY_KINDS = new Set([
  'memorization', 'drill', 'reading', 'writing', 'problem_solving', 'project', 'review', 'unknown',
]);
const TASK_DISTRIBUTION_POLICIES = new Set([
  'single_block', 'contiguous', 'splittable', 'spaced', 'sequential_units',
]);
const STUDY_COGNITIVE_LOADS = new Set(['light', 'medium', 'heavy', 'unknown']);
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
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
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
    && (typeof value.approvalEligibility === 'string' && PREVIEW_ELIGIBILITY.has(value.approvalEligibility))
    && typeof value.stale === 'boolean'
    && typeof value.authorizedUserId === 'string';
}

function isReasoningKey(value: unknown): value is WeeklyPlanningReasoningKey {
  return value === 'explicit-duration'
    || value === 'explicit-unit-rate'
    || value === 'accepted-assumption-duration';
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
    && isReasoningKey(value.reasoningKey)
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
    && isReasoningKey(value.reasoningKey);
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
    && (typeof value.type === 'string' && PLAN_TYPES.has(value.type))
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
    || !hasOnlyKeys(value, [
      'scope', 'planningStartDate', 'planningStartDateTime', 'durationDays',
      'planningEndDateTime', 'sourceText',
    ])
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
    || !isOptionalString(value.planningStartDateTime)
    || !isOptionalString(value.planningEndDateTime)
    || (value.durationDays !== undefined && !isValidPlanningDurationDays(value.durationDays))
    || typeof value.sourceText !== 'string') {
    return false;
  }
  if (scope.kind === 'next_week'
    && (!scope.windowStartDate || !scope.windowEndDate)) {
    return false;
  }
  if (value.planningStartDate !== undefined
    && !isIsoCalendarDate(value.planningStartDate)) {
    return false;
  }
  if (value.planningStartDateTime !== undefined
    && (!isValidPlanningDateTime(value.planningStartDateTime)
      || value.planningStartDate === undefined
      || value.planningStartDateTime.slice(0, 10) !== value.planningStartDate)) {
    return false;
  }
  if (value.planningEndDateTime !== undefined
    && (!isValidPlanningDateTime(value.planningEndDateTime)
      || scope.windowEndDate === undefined
      || value.planningEndDateTime.slice(0, 10) !== scope.windowEndDate)) {
    return false;
  }
  if (value.durationDays !== undefined && value.planningEndDateTime !== undefined) {
    return false;
  }
  const planningStartDate = value.planningStartDateTime?.slice(0, 10)
    ?? value.planningStartDate;
  if (planningStartDate !== undefined
    && !isDateWithinWindow(planningStartDate, scope)) {
    return false;
  }
  return !(planningStartDate !== undefined
    && (value.durationDays !== undefined || value.planningEndDateTime !== undefined));
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
    && (value.unitModel === undefined || (typeof value.unitModel === 'string' && STUDY_SCOPE_UNITS.has(value.unitModel)))
    && isOptionalPositiveInteger(value.unitCountHint)
    && isStringArray(value.rawText);
}

function isTaskExecutionProfile(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['activityKind', 'distributionPolicy', 'cognitiveLoad'])
    && (typeof value.activityKind === 'string' && STUDY_ACTIVITY_KINDS.has(value.activityKind))
    && (typeof value.distributionPolicy === 'string' && TASK_DISTRIBUTION_POLICIES.has(value.distributionPolicy))
    && (typeof value.cognitiveLoad === 'string' && STUDY_COGNITIVE_LOADS.has(value.cognitiveLoad));
}

function isTask(value: unknown): boolean {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      'title', 'subject', 'examType', 'field', 'year', 'unit', 'amount', 'deadlineDeclared',
      'deadlineDate', 'deadlineTime', 'executionProfile', 'rawText', 'requiresTimeEstimate', 'source',
    ])) {
    return false;
  }
  return typeof value.title === 'string'
    && isOptionalString(value.subject)
    && isOptionalString(value.examType)
    && isOptionalString(value.field)
    && (value.year === undefined || isInteger(value.year))
    && (typeof value.unit === 'string' && STUDY_SCOPE_UNITS.has(value.unit))
    && isOptionalFiniteNumber(value.amount)
    && (value.deadlineDeclared === undefined || value.deadlineDeclared === true)
    && (value.deadlineDate === undefined || isDate(value.deadlineDate))
    && (value.deadlineTime === undefined || isTime(value.deadlineTime))
    && (value.executionProfile === undefined || isTaskExecutionProfile(value.executionProfile))
    && ((value.deadlineDate === undefined && value.deadlineTime === undefined)
      || value.deadlineDeclared === true)
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
  return (typeof value.unit === 'string' && STUDY_SCOPE_UNITS.has(value.unit))
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
  return (typeof value.kind === 'string' && LIFE_CONSTRAINT_KINDS.has(value.kind))
    && isOptionalString(value.date)
    && isOptionalString(value.start)
    && isOptionalString(value.end)
    && isOptionalFiniteNumber(value.durationMinutes)
    && isOptionalString(value.studyAvailableStart)
    && (value.hardness === 'hard' || value.hardness === 'soft')
    && isOptionalString(value.rawText);
}

function isStudyTimePreference(value: unknown): boolean {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['kind', 'taskRef', 'rawText', 'confidence'])) {
    return false;
  }
  return (typeof value.kind === 'string' && STUDY_TIME_PREFERENCE_KINDS.has(value.kind))
    && isOptionalString(value.taskRef)
    && typeof value.rawText === 'string'
    && (value.confidence === 'high' || value.confidence === 'medium');
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

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isGroundingRecord(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['id', 'targetFactId', 'interpretationKind', 'status', 'sourceExpression',
      'startDate', 'endDate', 'proposedAtTurnId', 'acceptedAtTurnId'])
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.targetFactId)
    && value.interpretationKind === 'relative_date_resolution'
    && typeof value.status === 'string'
    && ['proposed', 'continuation_accepted', 'explicitly_accepted', 'contested', 'rejected'].includes(value.status)
    && typeof value.sourceExpression === 'string'
    && isDate(value.startDate)
    && isDate(value.endDate)
    && isNonEmptyString(value.proposedAtTurnId)
    && (value.acceptedAtTurnId === null || isNonEmptyString(value.acceptedAtTurnId));
}

function isRepairObligation(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['id', 'issueFactId', 'targetFactId', 'domain', 'code', 'impact',
      'status', 'createdRevision', 'sourceTurnId', 'reopenBefore'])
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.issueFactId)
    && (value.targetFactId === null || isNonEmptyString(value.targetFactId))
    && typeof value.domain === 'string'
    && ['semantic_uncertainty', 'planning_horizon', 'temporal_constraint', 'work_item',
      'commitment', 'task_date_rule', 'availability', 'relation', 'deduplication'].includes(value.domain)
    && typeof value.code === 'string'
    && (value.impact === 'low' || value.impact === 'medium' || value.impact === 'high')
    && (value.status === 'open' || value.status === 'deferred' || value.status === 'resolved' || value.status === 'dropped')
    && isNonNegativeInteger(value.createdRevision)
    && isNonEmptyString(value.sourceTurnId)
    && (value.reopenBefore === 'preview' || value.reopenBefore === 'save');
}

function isCapacityStrategy(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['trigger', 'acquisition', 'review', 'unscheduledWorkItemIds'])
    && value.trigger === 'insufficient_capacity'
    && value.acquisition === 'longer_sessions'
    && value.review === 'short_distributed_sessions'
    && isStringArray(value.unscheduledWorkItemIds);
}

function isLearningStrategyProposal(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['id', 'kind', 'taskId', 'workloadFactId', 'scope', 'status',
      'suggestedSessionMinutes', 'selectedSessionMinutes', 'capacityStrategy', 'createdRevision',
      'proposedAtTurnId', 'decidedAtTurnId'])
    && isNonEmptyString(value.id)
    && (value.kind === 'spaced_memory_practice' || value.kind === 'calibrate_memory_pace'
      || value.kind === 'mixed_acquisition_review')
    && isNonEmptyString(value.taskId)
    && isNonEmptyString(value.workloadFactId)
    && value.scope === 'week'
    && (value.status === 'pending' || value.status === 'accepted' || value.status === 'rejected')
    && isRecord(value.suggestedSessionMinutes)
    && hasOnlyKeys(value.suggestedSessionMinutes, ['min', 'max'])
    && isPositiveFiniteNumber(value.suggestedSessionMinutes.min)
    && isPositiveFiniteNumber(value.suggestedSessionMinutes.max)
    && value.suggestedSessionMinutes.min <= value.suggestedSessionMinutes.max
    && (value.selectedSessionMinutes === undefined || value.selectedSessionMinutes === null
      || isPositiveFiniteNumber(value.selectedSessionMinutes))
    && (value.capacityStrategy === undefined || value.capacityStrategy === null
      || isCapacityStrategy(value.capacityStrategy))
    && isNonNegativeInteger(value.createdRevision)
    && isNonEmptyString(value.proposedAtTurnId)
    && (value.decidedAtTurnId === null || isNonEmptyString(value.decidedAtTurnId));
}

function isQuestionContext(value: unknown, format: WeeklyPlanningPersistedStateFormat): boolean {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['kind', 'targetSlot', 'intent', 'topicId', 'actionId',
      ...(format.kind === 'stable_v5_session_v1'
        ? ['estimateForWorkloadFactId', 'questionBasis', 'presentation', 'c5'] : [])])) {
    return false;
  }
  return (typeof value.kind === 'string' && QUESTION_CONTEXT_KINDS.has(value.kind))
    && isOptionalString(value.targetSlot)
    && isOptionalString(value.intent)
    && isOptionalString(value.topicId)
    && isOptionalString(value.actionId)
    && isOptionalString(value.estimateForWorkloadFactId)
    && (value.questionBasis === undefined || value.questionBasis === 'completed_workload_total')
    && (value.presentation === undefined || decodeWeeklyPlanningQuestionPresentation(value.presentation) !== null);
}

function isPlanningIntakeState(value: unknown, format: WeeklyPlanningPersistedStateFormat): value is PlanningIntakeState {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      'status', 'intent', 'range', 'pendingPlanningRange', 'examPrepScope', 'tasks',
      'progress', 'unitRates', 'constraints', 'constraintSourcesInUse',
      'studyTimePreferences', 'fixedEventsDeclaredNone', 'priorityPolicy', 'priorityPolicySource', 'missing',
      'assumptions', 'uncertainties', 'questions', 'lastQuestionContext',
      'shouldCreateDraft', 'shouldSavePlan', 'draftGenerationIntent',
      'draftGenerationAuthorizedAtRevision', 'sourceTurns',
      ...(format.kind === 'stable_v5_session_v1'
        ? ['groundingRecords', 'repairAgenda', 'learningStrategyProposalRecords', 'c5SelectionLedger', 'provisionalTimebox'] : []),
    ])) {
    return false;
  }
  return (typeof value.status === 'string' && INTAKE_STATUSES.has(value.status))
    && (typeof value.intent === 'string' && INTAKE_INTENTS.has(value.intent))
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
    && (value.studyTimePreferences === undefined
      || (Array.isArray(value.studyTimePreferences)
        && value.studyTimePreferences.every(isStudyTimePreference)))
    && (value.fixedEventsDeclaredNone === undefined || value.fixedEventsDeclaredNone === true)
    && isPriorityPolicy(value.priorityPolicy)
    && (value.priorityPolicySource === undefined
      || value.priorityPolicySource === 'user'
      || value.priorityPolicySource === 'derived_single_field')
    && Array.isArray(value.missing)
    && value.missing.every((item) => (typeof item === 'string' && MISSING_SLOTS.has(item)))
    && isStringArray(value.assumptions)
    && Array.isArray(value.uncertainties)
    && value.uncertainties.every((item) => item === 'unknown_fields_may_take_longer')
    && isStringArray(value.questions)
    && (value.lastQuestionContext === undefined || isQuestionContext(value.lastQuestionContext, format))
    && typeof value.shouldCreateDraft === 'boolean'
    && value.shouldSavePlan === false
    && (value.draftGenerationIntent === undefined
      || value.draftGenerationIntent === 'not_requested'
      || value.draftGenerationIntent === 'assistant_suggested'
      || value.draftGenerationIntent === 'user_authorized')
    && (value.draftGenerationAuthorizedAtRevision === undefined
      || isNonNegativeInteger(value.draftGenerationAuthorizedAtRevision))
    && isStringArray(value.sourceTurns)
    && (value.groundingRecords === undefined
      || (Array.isArray(value.groundingRecords) && value.groundingRecords.every(isGroundingRecord)))
    && (value.repairAgenda === undefined
      || (Array.isArray(value.repairAgenda) && value.repairAgenda.every(isRepairObligation)))
    && (value.learningStrategyProposalRecords === undefined
      || (Array.isArray(value.learningStrategyProposalRecords)
        && value.learningStrategyProposalRecords.every(isLearningStrategyProposal)))
    && (value.provisionalTimebox === undefined
      || (isRecord(value.provisionalTimebox)
        && hasOnlyKeys(value.provisionalTimebox, ['version', 'workloadFactIds', 'minutesPerWorkload',
          'authorizedAtGraphRevision', 'authorizedAtTurnId'])
        && isNonNegativeInteger(value.provisionalTimebox.authorizedAtGraphRevision)
        && readWeeklyPlanningProvisionalTimeboxStateV5(value.provisionalTimebox) !== null))
    && (format.kind !== 'stable_v5_session_v1'
      || validC5SessionRecords(value as unknown as PlanningIntakeState, format.ownerId, format.conversationId));
}


function isMessageStableV5(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['id', 'role', 'content', 'createdAt'])
    && isNonEmptyString(value.id)
    && (value.role === 'user' || value.role === 'assistant')
    && typeof value.content === 'string'
    && value.content.length <= MAX_MESSAGE_CONTENT_LENGTH
    && isTimestamp(value.createdAt);
}

function isDraftBlockStableV5(value: unknown, ownerId: string, conversationId: string): boolean {
  if (!isRecord(value)) return false;
  if (
    !isNonEmptyString(value.id)
    || value.userId !== ownerId
    || !isDate(value.date)
    || !isTime(value.startTime)
    || !isTime(value.endTime)
    || typeof value.title !== 'string'
    || typeof value.subject !== 'string'
    || value.source !== 'ai'
    || value.status !== 'draft'
    || typeof value.userEdited !== 'boolean'
    || !isTimestamp(value.createdAt)
    || !isTimestamp(value.updatedAt)
  ) {
    return false;
  }
  if (value.behaviorMetadata === undefined) return true;
  if (!isRecord(value.behaviorMetadata)) return false;
  const metadataConversationId = value.behaviorMetadata.conversationId;
  if (metadataConversationId !== undefined && metadataConversationId !== conversationId) {
    return false;
  }
  const previewMetadata = value.behaviorMetadata.previewMetadata;
  if (previewMetadata !== undefined) {
    if (!isRecord(previewMetadata)) return false;
    if (previewMetadata.authorizedUserId !== ownerId) return false;
    if (
      previewMetadata.conversationId !== undefined
      && previewMetadata.conversationId !== conversationId
    ) {
      return false;
    }
  }
  return true;
}

function isStableV5Metadata(value: unknown, graphRevision: number): boolean {
  if (!isRecord(value)) return false;
  return value.runtime === 'stable_v5'
    && isNonNegativeInteger(value.graphRevision)
    && value.graphRevision <= graphRevision
    && isNonEmptyString(value.taskId)
    && Array.isArray(value.sourceFactRefs)
    && value.sourceFactRefs.every(isNonEmptyString)
    && (value.planType === 'study' || value.planType === 'other');
}

function isPreviewCandidateStableV5(value: unknown, graphRevision: number): boolean {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.stableKey)
    && !value.stableKey.includes('..')
    && isDate(value.date)
    && isTime(value.startTime)
    && isTime(value.endTime)
    && isPositiveInteger(value.durationMinutes)
    && typeof value.title === 'string'
    && typeof value.field === 'string'
    && typeof value.year === 'number'
    && Number.isInteger(value.year)
    && isPositiveInteger(value.estimatedMinutes)
    && value.source === 'weekly_exam_prep'
    && value.approvalStatus === 'unapproved'
    && isNonEmptyString(value.workItemKey)
    && isStableV5Metadata(value.stableV5Metadata, graphRevision);
}


/** One persisted PlanningState/intake authority, composed by the versioned envelopes. */
export function isPersistedWeeklyPlanningState(
  value: unknown,
  format: WeeklyPlanningPersistedStateFormat,
): value is PlanningState {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      'weekStartDate', 'revision', 'conversationRequestSequence', 'mode',
      'draftBlocks', 'previewCandidates', 'messages', 'approvalRecovery',
      'intakeState', 'lastAssistantMessage', 'updatedAt',
    ])) return false;
  const stable = format.kind === 'stable_v5_session_v1' ? format : undefined;
  const validBlock = (block: unknown) => stable
    ? isDraftBlockStableV5(block, stable.ownerId, stable.conversationId) : isDraftBlock(block);
  return typeof value.weekStartDate === 'string'
    && (!stable || value.weekStartDate === stable.weekStartDate)
    && isNonNegativeInteger(value.revision)
    && ((stable && value.conversationRequestSequence === undefined)
      || isNonNegativeInteger(value.conversationRequestSequence))
    && (typeof value.mode === 'string' && MODES.has(value.mode))
    && Array.isArray(value.draftBlocks)
    && (!stable || value.draftBlocks.length <= MAX_DRAFT_BLOCKS)
    && value.draftBlocks.every(validBlock)
    && (value.approvalRecovery === undefined || (isWeeklyPlanningApprovalRecovery(
      value.approvalRecovery, value.draftBlocks as PlanningState['draftBlocks'], value.weekStartDate, validBlock)
      && (!stable || (value.approvalRecovery.blocks.length <= MAX_DRAFT_BLOCKS
        && value.approvalRecovery.operation.items.length <= MAX_DRAFT_BLOCKS))))
    && Array.isArray(value.previewCandidates)
    && (!stable || value.previewCandidates.length <= MAX_PREVIEW_CANDIDATES)
    && value.previewCandidates.every((candidate) => stable
      ? isPreviewCandidateStableV5(candidate, stable.graphRevision) : isPreviewCandidate(candidate))
    && Array.isArray(value.messages)
    && (!stable || value.messages.length <= MAX_WEEKLY_PLANNING_STORED_MESSAGES)
    && value.messages.every(stable ? isMessageStableV5 : isMessage)
    && (value.intakeState === undefined || isPlanningIntakeState(value.intakeState, format))
    && isOptionalString(value.lastAssistantMessage)
    && isTimestamp(value.updatedAt);
}
