import type { JsonSchemaResponseFormat } from '../../../services/ai/openAiCompatibleClient';
import {
  USER_PLANNING_CONTEXT_SEMANTIC_KINDS_V1,
  type UserPlanningContextSemanticFactV1,
} from '../../userPlanningContext/userPlanningContextTypes';

export const WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5 =
  'weekly-planning-semantic-v5' as const;

export const SEMANTIC_TASK_CATEGORIES_V5 = ['study', 'non_study', 'unknown'] as const;
export type SemanticTaskCategoryV5 = (typeof SEMANTIC_TASK_CATEGORIES_V5)[number];

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

export interface SemanticDurableContextSignalV5 extends SemanticSourceEvidenceV5 {
  localId: string;
  kind: 'concern';
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

const nullableStringSchema = { type: ['string', 'null'] } as const;
const nullableNumberSchema = { type: ['number', 'null'] } as const;
const sourceTextProperty = { sourceText: { type: 'string' } } as const;

const nullableNamedTimePeriodSchema = {
  anyOf: [
    { type: 'string', enum: SEMANTIC_NAMED_TIME_PERIODS_V5 },
    { type: 'string', pattern: '^custom:.+$' },
    { type: 'null' },
  ],
} as const;

const workloadSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'localId',
    'quantityRole',
    'amount',
    'unitCode',
    'unitLabel',
    'rangeStart',
    'rangeEnd',
    'perOccurrence',
    'periodExpression',
    'sourceText',
  ],
  properties: {
    localId: { type: 'string' },
    quantityRole: { type: 'string', enum: SEMANTIC_QUANTITY_ROLES_V5 },
    amount: { type: 'number' },
    unitCode: { type: 'string', enum: SEMANTIC_WORKLOAD_UNIT_CODES_V5 },
    unitLabel: { type: 'string' },
    rangeStart: nullableStringSchema,
    rangeEnd: nullableStringSchema,
    perOccurrence: { type: 'boolean' },
    periodExpression: nullableStringSchema,
    ...sourceTextProperty,
  },
} as const;

const durableContextSignalSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['localId', 'kind', 'value', 'sourceText'],
  properties: {
    localId: { type: 'string' },
    kind: { type: 'string', enum: ['concern'] },
    value: nullableStringSchema,
    ...sourceTextProperty,
  },
} as const;

const componentSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'localId',
    'existingPublicId',
    'parentLocalId',
    'role',
    'label',
    'workloads',
    'durableContextSignals',
    'sourceText',
  ],
  properties: {
    localId: { type: 'string' },
    existingPublicId: nullableStringSchema,
    parentLocalId: nullableStringSchema,
    role: { type: 'string', enum: SEMANTIC_COMPONENT_ROLES_V5 },
    label: { type: 'string' },
    workloads: { type: 'array', items: workloadSchema },
    durableContextSignals: { type: 'array', items: durableContextSignalSchema },
    ...sourceTextProperty,
  },
} as const;

const studySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['purpose', 'contextLabel', 'components'],
  properties: {
    purpose: { type: 'string', enum: SEMANTIC_STUDY_PURPOSES_V5 },
    contextLabel: nullableStringSchema,
    components: { type: 'array', items: componentSchema },
  },
} as const;

const effortEstimateSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'localId',
    'targetLocalId',
    'kind',
    'minutes',
    'unitCode',
    'precision',
    'sourceText',
  ],
  properties: {
    localId: { type: 'string' },
    targetLocalId: { type: 'string' },
    kind: {
      type: 'string',
      enum: ['total_duration', 'duration_per_unit', 'session_duration'],
    },
    minutes: { type: 'number' },
    unitCode: {
      anyOf: [
        { type: 'string', enum: SEMANTIC_WORKLOAD_UNIT_CODES_V5 },
        { type: 'null' },
      ],
    },
    precision: { type: 'string', enum: ['exact', 'approximate', 'unspecified'] },
    ...sourceTextProperty,
  },
} as const;

const temporalConstraintSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'localId',
    'targetLocalId',
    'kind',
    'constraintLevel',
    'dateExpression',
    'namedTimePeriod',
    'startTime',
    'endTime',
    'precision',
    'sourceText',
  ],
  properties: {
    localId: { type: 'string' },
    targetLocalId: { type: 'string' },
    kind: { type: 'string', enum: SEMANTIC_TEMPORAL_CONSTRAINT_KINDS_V5 },
    constraintLevel: { type: 'string', enum: SEMANTIC_CONSTRAINT_LEVELS_V5 },
    dateExpression: nullableStringSchema,
    namedTimePeriod: nullableNamedTimePeriodSchema,
    startTime: nullableStringSchema,
    endTime: nullableStringSchema,
    precision: { type: 'string', enum: ['exact', 'approximate', 'unspecified'] },
    ...sourceTextProperty,
  },
} as const;

const recurrenceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['localId', 'targetLocalId', 'kind', 'count', 'days', 'sourceText'],
  properties: {
    localId: { type: 'string' },
    targetLocalId: { type: 'string' },
    kind: { type: 'string', enum: SEMANTIC_RECURRENCE_KINDS_V5 },
    count: nullableNumberSchema,
    days: { type: 'array', items: { type: 'string' } },
    ...sourceTextProperty,
  },
} as const;

const taskSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'localId',
    'existingPublicId',
    'category',
    'title',
    'study',
    'workloads',
    'effortEstimates',
    'temporalConstraints',
    'recurrence',
    'durableContextSignals',
    'sourceText',
  ],
  properties: {
    localId: { type: 'string' },
    existingPublicId: nullableStringSchema,
    category: { type: 'string', enum: SEMANTIC_TASK_CATEGORIES_V5 },
    title: { type: 'string' },
    study: { anyOf: [studySchema, { type: 'null' }] },
    workloads: { type: 'array', items: workloadSchema },
    effortEstimates: { type: 'array', items: effortEstimateSchema },
    temporalConstraints: { type: 'array', items: temporalConstraintSchema },
    recurrence: { type: 'array', items: recurrenceSchema },
    durableContextSignals: { type: 'array', items: durableContextSignalSchema },
    ...sourceTextProperty,
  },
} as const;

const planningWindowSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['localId', 'kind', 'value', 'start', 'end', 'sourceText'],
  properties: {
    localId: { type: 'string' },
    kind: {
      type: 'string',
      enum: ['absolute', 'relative_day', 'relative_week', 'named_period'],
    },
    value: { type: 'string' },
    start: nullableStringSchema,
    end: nullableStringSchema,
    ...sourceTextProperty,
  },
} as const;

const relationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['localId', 'kind', 'fromLocalId', 'toLocalId', 'sourceText'],
  properties: {
    localId: { type: 'string' },
    kind: {
      type: 'string',
      enum: ['before', 'after', 'depends_on', 'priority_over', 'sequence'],
    },
    fromLocalId: { type: 'string' },
    toLocalId: { type: 'string' },
    ...sourceTextProperty,
  },
} as const;

const uncertaintySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['localId', 'targetLocalId', 'field', 'reason', 'sourceText'],
  properties: {
    localId: { type: 'string' },
    targetLocalId: { type: 'string' },
    field: { type: 'string' },
    reason: { type: 'string' },
    ...sourceTextProperty,
  },
} as const;

const semanticReferenceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'publicId', 'localId', 'mention'],
  properties: {
    kind: {
      type: 'string',
      enum: [
        'planning_window',
        'task',
        'component',
        'workload',
        'effort_estimate',
        'temporal_constraint',
        'recurrence',
        'relation',
        'proposal',
      ],
    },
    publicId: nullableStringSchema,
    localId: nullableStringSchema,
    mention: nullableStringSchema,
  },
} as const;

const correctionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['localId', 'target', 'operation', 'replacementLocalId', 'sourceText'],
  properties: {
    localId: { type: 'string' },
    target: semanticReferenceSchema,
    operation: { type: 'string', enum: ['remove', 'replace', 'modify'] },
    replacementLocalId: nullableStringSchema,
    ...sourceTextProperty,
  },
} as const;

const decisionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['localId', 'target', 'decision', 'sourceText'],
  properties: {
    localId: { type: 'string' },
    target: semanticReferenceSchema,
    decision: { type: 'string', enum: ['accept', 'reject', 'modify'] },
    ...sourceTextProperty,
  },
} as const;

const availabilityDeclarationSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'localId',
    'kind',
    'dateExpression',
    'namedTimePeriod',
    'startTime',
    'endTime',
    'recurrenceKind',
    'days',
    'constraintLevel',
    'sourceText',
  ],
  properties: {
    localId: { type: 'string' },
    kind: { type: 'string', enum: SEMANTIC_AVAILABILITY_KINDS_V5 },
    dateExpression: nullableStringSchema,
    namedTimePeriod: nullableNamedTimePeriodSchema,
    startTime: nullableStringSchema,
    endTime: nullableStringSchema,
    recurrenceKind: {
      anyOf: [
        { type: 'string', enum: SEMANTIC_AVAILABILITY_RECURRENCE_KINDS_V5 },
        { type: 'null' },
      ],
    },
    days: { type: 'array', items: { type: 'string' } },
    constraintLevel: { type: 'string', enum: SEMANTIC_CONSTRAINT_LEVELS_V5 },
    ...sourceTextProperty,
  },
} as const;

const constraintSourceRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['localId', 'kind', 'selector', 'requestedAction', 'sourceText'],
  properties: {
    localId: { type: 'string' },
    kind: { type: 'string', enum: SEMANTIC_CONSTRAINT_SOURCE_KINDS_V5 },
    selector: { type: 'string', enum: ['active'] },
    requestedAction: { type: 'string', enum: ['use', 'stop_using'] },
    ...sourceTextProperty,
  },
} as const;

const userContextFactSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'localId',
    'kind',
    'label',
    'value',
    'dateExpression',
    'sourceText',
  ],
  properties: {
    localId: { type: 'string' },
    kind: { type: 'string', enum: USER_PLANNING_CONTEXT_SEMANTIC_KINDS_V1 },
    label: { type: 'string' },
    value: nullableStringSchema,
    dateExpression: nullableStringSchema,
    ...sourceTextProperty,
  },
} as const;

export const WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'weekly_planning_semantic_document_v5',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'schemaVersion',
        'planningIntent',
        'planningWindow',
        'tasks',
        'relations',
        'availabilityDeclarations',
        'constraintSourceRequests',
        'userContextFacts',
        'uncertainties',
        'corrections',
        'decisions',
      ],
      properties: {
        schemaVersion: {
          type: 'string',
          const: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
        },
        planningIntent: {
          type: 'string',
          enum: ['create_plan', 'update_plan', 'discuss', 'unknown'],
        },
        planningWindow: { anyOf: [planningWindowSchema, { type: 'null' }] },
        tasks: { type: 'array', items: taskSchema },
        relations: { type: 'array', items: relationSchema },
        availabilityDeclarations: {
          type: 'array',
          items: availabilityDeclarationSchema,
        },
        constraintSourceRequests: {
          type: 'array',
          items: constraintSourceRequestSchema,
        },
        userContextFacts: {
          type: 'array',
          items: userContextFactSchema,
        },
        uncertainties: { type: 'array', items: uncertaintySchema },
        corrections: { type: 'array', items: correctionSchema },
        decisions: { type: 'array', items: decisionSchema },
      },
    },
  },
};

export function createWeeklyPlanningSemanticSystemPromptV5(): string {
  return [
    'You normalize Japanese planning utterances into a generic semantic document.',
    'Return JSON only and follow the response schema exactly.',
    'Describe user meaning only. Never emit application commands, reducer operations, database IDs, questions, missing-slot decisions, readiness decisions, preview decisions, schedule placements, approval decisions, or save decisions.',
    'The only top-level task categories are study, non_study, and unknown.',
    'Entrance exams, qualification exams, school exams, courses, homework, self-study, review, practice, learning habits, and research-as-learning are ordinary study tasks. Put the specific context in study.purpose and study.contextLabel, never in a special top-level task type.',
    'Represent subjects, fields, materials, topics, chapters, sections, and skills as components. parentLocalId is only for component-to-component hierarchy inside the same task: top-level components use null, child components use another component localId, and a task localId must never be used as parentLocalId.',
    'Assign a globally unique response-local localId to every planning window, task, component, workload, effort estimate, temporal constraint, recurrence, relation, availability declaration, source request, user context fact, uncertainty, correction, and decision.',
    'Attach each workload to the deepest task or component that it directly modifies. Never store labels and quantities in parallel arrays.',
    'Use quantityRole declared when an amount is stated but the utterance does not establish whether it is a target, remaining amount, or completed amount. Do not guess a stronger role.',
    'A time amount that states how much work exists, such as 30分勉強する or 掃除を1時間する, is a workload with unitCode minute or hour.',
    'A statement about expected effort, such as 1問10分かかる or 全部で3時間くらい, is an effortEstimate. Use duration_per_unit only when an explicit unit basis exists.',
    'Temporal constraints express when work may or must happen, not how much work exists.',
    'Every temporal constraint must include constraintLevel hard, soft, or unknown and namedTimePeriod.',
    'Use hard only when the user clearly states an immovable, mandatory, unavailable, or deadline constraint. Use soft for preferences. Use unknown when the strength is not established.',
    'Use deadline for completion-by expressions, latest_end for まで進める or まで作業する, earliest_start for から始める, and preferred_window for preferences.',
    'A date when an exam, presentation, competition, appointment, or other event itself occurs is not a work deadline. Put a durable event occurrence in userContextFacts with kind goal_event. Emit a task deadline only when the user explicitly states completion-by meaning for the work.',
    'Every task and study component must return durableContextSignals, using an empty array when none apply. When current userText explicitly describes that entity as difficult, weak, worrying, behind, or otherwise an ongoing concern relevant to later plans, emit a concern signal on that entity. Preserve the concern wording in value or use null; do not invent a diagnosis or stronger priority.',
    'Entity-local concern signals may coexist with the same task/component weekly facts. Do not omit a concern merely because the entity label already appears elsewhere in the document.',
    'Use top-level userContextFacts for owner-level context not naturally represented as an entity annotation, especially dated future goal_event occurrences. userContextFacts and durableContextSignals are current-turn deltas, never copies of stored user context.',
    'A task-specific time belongs in that task temporalConstraints. A plan-wide statement with no task target belongs in availabilityDeclarations.',
    'Use allowed_date when a task may be scheduled only on the specified date. Use excluded_date when that task must not be scheduled on the specified date. Both require dateExpression and null namedTimePeriod, startTime, and endTime.',
    'For a plan that covers only one specific day, use an absolute planningWindow whose start and end are the same date. For a whole day with no planning, use a hard unavailable availability declaration with that dateExpression and no clock bounds.',
    'planningWindow is only the period for the whole requested plan. A period modifying one workload belongs in that workload periodExpression.',
    'Use dateExpression only for today, tomorrow, day_after_tomorrow, this_week, next_week, an explicit YYYY-MM-DD date, or custom:<original phrase>. Never put a Japanese time-of-day phrase in dateExpression.',
    'Use namedTimePeriod morning, afternoon, evening, night, before_sleep, before_meal, after_meal, or custom:<original phrase>. Use null when exact startTime/endTime are supplied or no named time period exists.',
    'Keep relative date expressions symbolic. Do not calculate ISO dates. Normalize explicit clock times to HH:mm when certain.',
    'Use unitCode exam_year for 1年分 or 2年分 of past questions. Specific calendar years belong only in rangeStart and rangeEnd.',
    'Keep unrelated activities as separate tasks. Preserve before, after, dependency, priority, and sequence relations with response-local task IDs.',
    'Every task/component must set existingPublicId: use the exact publicId from publicStateSummary when current userText continues the same accepted entity, otherwise null. Do not create a duplicate task/component merely to add workload, effort, time, recurrence, or detail. If identity is ambiguous, emit uncertainty instead of guessing.',
    'External timetable, existing plan, and calendar contents are authoritative application data. Never reproduce, summarize, or invent their events.',
    'Create a constraintSourceRequest only when the user explicitly asks to use or stop using timetable, existing plans, or calendar. selector must be active.',
    'For an ambiguous source request, return an uncertainty targeting document field constraintSource instead of choosing a source.',
    'Use corrections and decisions only for explicit user corrections or explicit decisions about a previously presented public item. Otherwise return empty arrays.',
    'Do not invent facts. Preserve a short supporting excerpt in every sourceText.',
    'Return empty availabilityDeclarations, constraintSourceRequests, and userContextFacts arrays when none are explicitly present.',
  ].join('\n');
}

export function createWeeklyPlanningSemanticUserPromptV5(params: {
  userText: string;
  recentConversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  publicStateSummary?: Record<string, unknown>;
}): string {
  return JSON.stringify({
    userText: params.userText,
    recentConversation: params.recentConversation ?? [],
    publicStateSummary: params.publicStateSummary ?? {},
  });
}
