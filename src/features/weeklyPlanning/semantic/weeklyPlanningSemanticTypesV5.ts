import type { UserPlanningContextSemanticFactV1 } from '../../userPlanningContext/userPlanningContextTypes';

export const WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5 =
  'weekly-planning-semantic-v5' as const;

export const SEMANTIC_TASK_CATEGORIES_V5 = ['study', 'non_study', 'unknown'] as const;
export type SemanticTaskCategoryV5 = (typeof SEMANTIC_TASK_CATEGORIES_V5)[number];

export const SEMANTIC_TASK_DECOMPOSITION_STATUSES_V5 = [
  'atomic',
  'decomposed',
  'needs_breakdown',
] as const;
export type SemanticTaskDecompositionStatusV5 =
  (typeof SEMANTIC_TASK_DECOMPOSITION_STATUSES_V5)[number];

export const SEMANTIC_STUDY_PURPOSES_V5 = [
  'exam',
  'course',
  'homework',
  'self_study',
  'practice',
  'review',
  'habit',
  'research',
  'other',
  'unknown',
] as const;
export type SemanticStudyPurposeV5 = (typeof SEMANTIC_STUDY_PURPOSES_V5)[number];

export const SEMANTIC_STUDY_ACTIVITY_KINDS_V5 = [
  'memorization_retrieval',
  'problem_solving',
  'reading',
  'writing',
  'mixed',
  'other',
  'unknown',
] as const;
export type SemanticStudyActivityKindV5 =
  (typeof SEMANTIC_STUDY_ACTIVITY_KINDS_V5)[number];

export const SEMANTIC_COMPONENT_ROLES_V5 = [
  'subject',
  'field',
  'material',
  'topic',
  'chapter',
  'section',
  'skill',
  'custom',
] as const;
export type SemanticComponentRoleV5 = (typeof SEMANTIC_COMPONENT_ROLES_V5)[number];

export const SEMANTIC_QUANTITY_ROLES_V5 = [
  'declared',
  'scope_total',
  'target',
  'remaining',
  'completed',
  'unknown',
] as const;
export type SemanticQuantityRoleV5 = (typeof SEMANTIC_QUANTITY_ROLES_V5)[number];

export const SEMANTIC_WORKLOAD_UNIT_CODES_V5 = [
  'minute',
  'hour',
  'page',
  'problem',
  'word',
  'lesson',
  'chapter',
  'section',
  'exam_year',
  'mock_exam',
  'session',
  'custom',
] as const;
export type SemanticWorkloadUnitCodeV5 =
  (typeof SEMANTIC_WORKLOAD_UNIT_CODES_V5)[number];

export const SEMANTIC_BASE_TEMPORAL_CONSTRAINT_KINDS_V5 = [
  'earliest_start',
  'latest_end',
  'fixed_interval',
  'deadline',
  'preferred_window',
  'avoid_window',
] as const;
export type SemanticBaseTemporalConstraintKindV5 =
  (typeof SEMANTIC_BASE_TEMPORAL_CONSTRAINT_KINDS_V5)[number];

export const SEMANTIC_TASK_DATE_RULE_KINDS_V5 = [
  'allowed_date',
  'excluded_date',
] as const;
export type SemanticTaskDateRuleKindV5 =
  (typeof SEMANTIC_TASK_DATE_RULE_KINDS_V5)[number];

export const SEMANTIC_TEMPORAL_CONSTRAINT_KINDS_V5 = [
  ...SEMANTIC_BASE_TEMPORAL_CONSTRAINT_KINDS_V5,
  ...SEMANTIC_TASK_DATE_RULE_KINDS_V5,
] as const;
export type SemanticTemporalConstraintKindV5 =
  (typeof SEMANTIC_TEMPORAL_CONSTRAINT_KINDS_V5)[number];

export const SEMANTIC_RECURRENCE_KINDS_V5 = [
  'daily',
  'weekly',
  'weekdays',
  'weekends',
  'times_per_week',
  'custom',
] as const;
export type SemanticRecurrenceKindV5 =
  (typeof SEMANTIC_RECURRENCE_KINDS_V5)[number];

export const SEMANTIC_CONSTRAINT_LEVELS_V5 = ['hard', 'soft', 'unknown'] as const;
export type SemanticConstraintLevelV5 =
  (typeof SEMANTIC_CONSTRAINT_LEVELS_V5)[number];

export const SEMANTIC_AVAILABILITY_KINDS_V5 = [
  'available',
  'unavailable',
  'preferred',
  'avoided',
  'capacity',
  'no_additional_constraint',
] as const;
export type SemanticAvailabilityKindV5 =
  (typeof SEMANTIC_AVAILABILITY_KINDS_V5)[number];

export const SEMANTIC_AVAILABILITY_RECURRENCE_KINDS_V5 = [
  'daily',
  'weekly',
  'weekdays',
  'weekends',
  'custom',
] as const;
export type SemanticAvailabilityRecurrenceKindV5 =
  (typeof SEMANTIC_AVAILABILITY_RECURRENCE_KINDS_V5)[number];

export const SEMANTIC_CONSTRAINT_SOURCE_KINDS_V5 = [
  'timetable',
  'existing_plans',
  'calendar',
] as const;
export type SemanticConstraintSourceKindV5 =
  (typeof SEMANTIC_CONSTRAINT_SOURCE_KINDS_V5)[number];

export const SEMANTIC_NAMED_TIME_PERIODS_V5 = [
  'morning',
  'afternoon',
  'evening',
  'night',
  'before_sleep',
  'before_meal',
  'after_meal',
] as const;
export type SemanticNamedTimePeriodV5 =
  | (typeof SEMANTIC_NAMED_TIME_PERIODS_V5)[number]
  | `custom:${string}`;

export interface SemanticSourceEvidenceV5 {
  sourceText: string;
}

export const SEMANTIC_DURABLE_CONCERN_BASES_V5 = [
  'difficulty',
  'weakness',
  'worry',
  'low_confidence',
  'behind',
  'motivation_problem',
] as const;
export type SemanticDurableConcernBasisV5 =
  (typeof SEMANTIC_DURABLE_CONCERN_BASES_V5)[number];

export interface SemanticDurableContextSignalV5 extends SemanticSourceEvidenceV5 {
  localId: string;
  kind: 'concern';
  basis?: SemanticDurableConcernBasisV5;
  value: string | null;
}

export interface SemanticWorkloadV5 extends SemanticSourceEvidenceV5 {
  localId: string;
  quantityRole: SemanticQuantityRoleV5;
  amount: number;
  unitCode: SemanticWorkloadUnitCodeV5;
  unitLabel: string;
  rangeStart: string | null;
  rangeEnd: string | null;
  perOccurrence: boolean;
  periodExpression: string | null;
}

export interface SemanticStudyComponentV5 extends SemanticSourceEvidenceV5 {
  localId: string;
  existingPublicId?: string | null;
  parentLocalId: string | null;
  role: SemanticComponentRoleV5;
  label: string;
  workloads: SemanticWorkloadV5[];
  durableContextSignals?: SemanticDurableContextSignalV5[];
}

export interface SemanticStudyDetailsV5 {
  purpose: SemanticStudyPurposeV5;
  activityKind?: SemanticStudyActivityKindV5;
  contextLabel: string | null;
  components: SemanticStudyComponentV5[];
}

export interface SemanticEffortEstimateV5 extends SemanticSourceEvidenceV5 {
  localId: string;
  targetLocalId: string;
  kind: 'total_duration' | 'duration_per_unit' | 'session_duration';
  minutes: number;
  unitCode: SemanticWorkloadUnitCodeV5 | null;
  precision: 'exact' | 'approximate' | 'unspecified';
}

export interface SemanticTemporalConstraintV5 extends SemanticSourceEvidenceV5 {
  localId: string;
  targetLocalId: string;
  kind: SemanticTemporalConstraintKindV5;
  constraintLevel: SemanticConstraintLevelV5;
  dateExpression: string | null;
  namedTimePeriod: SemanticNamedTimePeriodV5 | null;
  startTime: string | null;
  endTime: string | null;
  precision: 'exact' | 'approximate' | 'unspecified';
}

export interface SemanticRecurrenceV5 extends SemanticSourceEvidenceV5 {
  localId: string;
  targetLocalId: string;
  kind: SemanticRecurrenceKindV5;
  count: number | null;
  days: string[];
}

export interface SemanticTaskV5 extends SemanticSourceEvidenceV5 {
  localId: string;
  existingPublicId?: string | null;
  decompositionStatus?: SemanticTaskDecompositionStatusV5;
  category: SemanticTaskCategoryV5;
  title: string;
  study: SemanticStudyDetailsV5 | null;
  workloads: SemanticWorkloadV5[];
  effortEstimates: SemanticEffortEstimateV5[];
  temporalConstraints: SemanticTemporalConstraintV5[];
  recurrence: SemanticRecurrenceV5[];
  durableContextSignals?: SemanticDurableContextSignalV5[];
}

export interface SemanticPlanningWindowV5 extends SemanticSourceEvidenceV5 {
  localId: string;
  kind: 'absolute' | 'relative_day' | 'relative_week' | 'named_period';
  value: string;
  start: string | null;
  end: string | null;
}

export interface SemanticRelationV5 extends SemanticSourceEvidenceV5 {
  localId: string;
  kind: 'before' | 'after' | 'depends_on' | 'priority_over' | 'sequence';
  fromLocalId: string;
  toLocalId: string;
}

export interface SemanticUncertaintyV5 extends SemanticSourceEvidenceV5 {
  localId: string;
  targetLocalId: string;
  field: string;
  reason: string;
}

export interface SemanticReferenceV5 {
  kind:
    | 'planning_window'
    | 'task'
    | 'component'
    | 'workload'
    | 'effort_estimate'
    | 'temporal_constraint'
    | 'recurrence'
    | 'relation'
    | 'proposal';
  publicId: string | null;
  localId: string | null;
  mention: string | null;
}

export interface SemanticCorrectionV5 extends SemanticSourceEvidenceV5 {
  localId: string;
  target: SemanticReferenceV5;
  operation: 'remove' | 'replace' | 'modify';
  replacementLocalId: string | null;
}

export interface SemanticDecisionV5 extends SemanticSourceEvidenceV5 {
  localId: string;
  target: SemanticReferenceV5;
  decision: 'accept' | 'reject' | 'modify';
}

export interface SemanticAvailabilityDeclarationV5 extends SemanticSourceEvidenceV5 {
  localId: string;
  kind: SemanticAvailabilityKindV5;
  dateExpression: string | null;
  namedTimePeriod: SemanticNamedTimePeriodV5 | null;
  startTime: string | null;
  endTime: string | null;
  recurrenceKind: SemanticAvailabilityRecurrenceKindV5 | null;
  days: string[];
  constraintLevel: SemanticConstraintLevelV5;
  /**
   * Daily study-allocation ceiling for kind=capacity. New provider responses
   * always include this field; optionality preserves older fixtures/checkpoints.
   */
  capacityMinutes?: number | null;
}

export interface SemanticConstraintSourceRequestV5 extends SemanticSourceEvidenceV5 {
  localId: string;
  kind: SemanticConstraintSourceKindV5;
  selector: 'active';
  requestedAction: 'use' | 'stop_using';
}

export interface WeeklyPlanningSemanticDocumentV5 {
  schemaVersion: typeof WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5;
  planningIntent: 'create_plan' | 'update_plan' | 'discuss' | 'unknown';
  planningWindow: SemanticPlanningWindowV5 | null;
  tasks: SemanticTaskV5[];
  relations: SemanticRelationV5[];
  availabilityDeclarations: SemanticAvailabilityDeclarationV5[];
  constraintSourceRequests: SemanticConstraintSourceRequestV5[];
  userContextFacts?: UserPlanningContextSemanticFactV1[];
  uncertainties: SemanticUncertaintyV5[];
  corrections: SemanticCorrectionV5[];
  decisions: SemanticDecisionV5[];
}
