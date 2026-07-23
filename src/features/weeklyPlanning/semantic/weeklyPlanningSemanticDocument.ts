import type { JsonSchemaResponseFormat } from '../../../services/ai/openAiCompatibleClient';

export const WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION = 'weekly-planning-semantic-v5-alpha1' as const;

export const SEMANTIC_TASK_CATEGORIES = ['study', 'non_study', 'unknown'] as const;
export type SemanticTaskCategory = (typeof SEMANTIC_TASK_CATEGORIES)[number];

export const SEMANTIC_STUDY_PURPOSES = [
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
export type SemanticStudyPurpose = (typeof SEMANTIC_STUDY_PURPOSES)[number];

export const SEMANTIC_COMPONENT_ROLES = [
  'subject',
  'field',
  'material',
  'topic',
  'chapter',
  'section',
  'skill',
  'custom',
] as const;
export type SemanticComponentRole = (typeof SEMANTIC_COMPONENT_ROLES)[number];

export const SEMANTIC_QUANTITY_ROLES = [
  'declared',
  'target',
  'remaining',
  'completed',
  'unknown',
] as const;
export type SemanticQuantityRole = (typeof SEMANTIC_QUANTITY_ROLES)[number];

export const SEMANTIC_WORKLOAD_UNIT_CODES = [
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
export type SemanticWorkloadUnitCode = (typeof SEMANTIC_WORKLOAD_UNIT_CODES)[number];

export const SEMANTIC_TEMPORAL_CONSTRAINT_KINDS = [
  'earliest_start',
  'latest_end',
  'fixed_interval',
  'deadline',
  'preferred_window',
  'avoid_window',
] as const;
export type SemanticTemporalConstraintKind =
  (typeof SEMANTIC_TEMPORAL_CONSTRAINT_KINDS)[number];

export const SEMANTIC_RECURRENCE_KINDS = [
  'daily',
  'weekly',
  'weekdays',
  'weekends',
  'times_per_week',
  'custom',
] as const;
export type SemanticRecurrenceKind = (typeof SEMANTIC_RECURRENCE_KINDS)[number];

export interface SemanticSourceEvidence {
  sourceText: string;
}

export interface SemanticWorkload extends SemanticSourceEvidence {
  localId: string;
  quantityRole: SemanticQuantityRole;
  amount: number;
  unitCode: SemanticWorkloadUnitCode;
  unitLabel: string;
  rangeStart: string | null;
  rangeEnd: string | null;
  perOccurrence: boolean;
  periodExpression: string | null;
}

export interface SemanticStudyComponent extends SemanticSourceEvidence {
  localId: string;
  parentLocalId: string | null;
  role: SemanticComponentRole;
  label: string;
  workloads: SemanticWorkload[];
}

export interface SemanticStudyDetails {
  purpose: SemanticStudyPurpose;
  contextLabel: string | null;
  components: SemanticStudyComponent[];
}

export interface SemanticEffortEstimate extends SemanticSourceEvidence {
  localId: string;
  targetLocalId: string;
  kind: 'total_duration' | 'duration_per_unit' | 'session_duration';
  minutes: number;
  unitCode: SemanticWorkloadUnitCode | null;
  precision: 'exact' | 'approximate' | 'unspecified';
}

export interface SemanticTemporalConstraint extends SemanticSourceEvidence {
  localId: string;
  targetLocalId: string;
  kind: SemanticTemporalConstraintKind;
  dateExpression: string | null;
  startTime: string | null;
  endTime: string | null;
  precision: 'exact' | 'approximate' | 'unspecified';
}

export interface SemanticRecurrence extends SemanticSourceEvidence {
  localId: string;
  targetLocalId: string;
  kind: SemanticRecurrenceKind;
  count: number | null;
  days: string[];
}

export interface SemanticTask extends SemanticSourceEvidence {
  localId: string;
  category: SemanticTaskCategory;
  title: string;
  study: SemanticStudyDetails | null;
  workloads: SemanticWorkload[];
  effortEstimates: SemanticEffortEstimate[];
  temporalConstraints: SemanticTemporalConstraint[];
  recurrence: SemanticRecurrence[];
}

export interface SemanticPlanningWindow extends SemanticSourceEvidence {
  localId: string;
  kind: 'absolute' | 'relative_day' | 'relative_week' | 'named_period';
  value: string;
  start: string | null;
  end: string | null;
}

export interface SemanticRelation extends SemanticSourceEvidence {
  localId: string;
  kind: 'before' | 'after' | 'depends_on' | 'priority_over' | 'sequence';
  fromLocalId: string;
  toLocalId: string;
}

export interface SemanticUncertainty extends SemanticSourceEvidence {
  localId: string;
  targetLocalId: string;
  field: string;
  reason: string;
}

export interface SemanticReference {
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

export interface SemanticCorrection extends SemanticSourceEvidence {
  localId: string;
  target: SemanticReference;
  operation: 'remove' | 'replace' | 'modify';
  replacementLocalId: string | null;
}

export interface SemanticDecision extends SemanticSourceEvidence {
  localId: string;
  target: SemanticReference;
  decision: 'accept' | 'reject' | 'modify';
}

export interface WeeklyPlanningSemanticDocument {
  schemaVersion: typeof WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION;
  planningIntent: 'create_plan' | 'update_plan' | 'discuss' | 'unknown';
  planningWindow: SemanticPlanningWindow | null;
  tasks: SemanticTask[];
  relations: SemanticRelation[];
  uncertainties: SemanticUncertainty[];
  corrections: SemanticCorrection[];
  decisions: SemanticDecision[];
}

const nullableStringSchema = { type: ['string', 'null'] } as const;
const nullableNumberSchema = { type: ['number', 'null'] } as const;

const sourceTextProperty = { sourceText: { type: 'string' } } as const;

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
    quantityRole: { type: 'string', enum: SEMANTIC_QUANTITY_ROLES },
    amount: { type: 'number' },
    unitCode: { type: 'string', enum: SEMANTIC_WORKLOAD_UNIT_CODES },
    unitLabel: { type: 'string' },
    rangeStart: nullableStringSchema,
    rangeEnd: nullableStringSchema,
    perOccurrence: { type: 'boolean' },
    periodExpression: nullableStringSchema,
    ...sourceTextProperty,
  },
} as const;

const componentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['localId', 'parentLocalId', 'role', 'label', 'workloads', 'sourceText'],
  properties: {
    localId: { type: 'string' },
    parentLocalId: nullableStringSchema,
    role: { type: 'string', enum: SEMANTIC_COMPONENT_ROLES },
    label: { type: 'string' },
    workloads: { type: 'array', items: workloadSchema },
    ...sourceTextProperty,
  },
} as const;

const studySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['purpose', 'contextLabel', 'components'],
  properties: {
    purpose: { type: 'string', enum: SEMANTIC_STUDY_PURPOSES },
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
        { type: 'string', enum: SEMANTIC_WORKLOAD_UNIT_CODES },
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
    'dateExpression',
    'startTime',
    'endTime',
    'precision',
    'sourceText',
  ],
  properties: {
    localId: { type: 'string' },
    targetLocalId: { type: 'string' },
    kind: { type: 'string', enum: SEMANTIC_TEMPORAL_CONSTRAINT_KINDS },
    dateExpression: nullableStringSchema,
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
    kind: { type: 'string', enum: SEMANTIC_RECURRENCE_KINDS },
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
    'category',
    'title',
    'study',
    'workloads',
    'effortEstimates',
    'temporalConstraints',
    'recurrence',
    'sourceText',
  ],
  properties: {
    localId: { type: 'string' },
    category: { type: 'string', enum: SEMANTIC_TASK_CATEGORIES },
    title: { type: 'string' },
    study: { anyOf: [studySchema, { type: 'null' }] },
    workloads: { type: 'array', items: workloadSchema },
    effortEstimates: { type: 'array', items: effortEstimateSchema },
    temporalConstraints: { type: 'array', items: temporalConstraintSchema },
    recurrence: { type: 'array', items: recurrenceSchema },
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

export const WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'weekly_planning_semantic_document_v5_alpha1',
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
        'uncertainties',
        'corrections',
        'decisions',
      ],
      properties: {
        schemaVersion: {
          type: 'string',
          const: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION,
        },
        planningIntent: {
          type: 'string',
          enum: ['create_plan', 'update_plan', 'discuss', 'unknown'],
        },
        planningWindow: {
          anyOf: [planningWindowSchema, { type: 'null' }],
        },
        tasks: { type: 'array', items: taskSchema },
        relations: { type: 'array', items: relationSchema },
        uncertainties: { type: 'array', items: uncertaintySchema },
        corrections: { type: 'array', items: correctionSchema },
        decisions: { type: 'array', items: decisionSchema },
      },
    },
  },
};

export function createWeeklyPlanningSemanticSystemPrompt(): string {
  return [
    'You normalize Japanese planning utterances into a generic semantic document.',
    'Return JSON only and follow the response schema exactly.',
    'Describe user meaning only. Never emit application commands, reducer operations, database IDs, questions, missing-slot decisions, readiness decisions, preview decisions, or schedule placements.',
    'The only top-level task categories are study, non_study, and unknown.',
    'Entrance exams, qualification exams, school exams, courses, homework, self-study, review, practice, learning habits, and research-as-learning are ordinary study tasks. Put the specific context in study.purpose and study.contextLabel, never in a special top-level task type.',
    'Represent subjects, fields, materials, topics, chapters, sections, and skills as components. Use parentLocalId for hierarchy.',
    'Assign a globally unique response-local localId to every task, component, workload, effort estimate, temporal constraint, recurrence, relation, uncertainty, correction, and decision.',
    'Attach each workload to the deepest task or component that it directly modifies. Never store labels and quantities in parallel arrays.',
    'Use quantityRole declared when an amount is stated but the utterance does not establish whether it is a target, remaining amount, or completed amount. Do not guess a stronger role.',
    'A time amount that states how much work exists, such as 30分勉強する or 掃除を1時間する, is a workload with unitCode minute or hour.',
    'A statement about expected effort, such as 1問10分かかる or 全部で3時間くらい, is an effortEstimate. Use duration_per_unit only when an explicit unit basis exists.',
    'Temporal constraints express when work may or must happen, not how much work exists.',
    'Use deadline for completion-by expressions, latest_end for まで進める or まで作業する, earliest_start for から始める, and preferred_window for preferences such as 週末にまとめる.',
    'planningWindow is only the period for the whole requested plan, such as 今日の計画 or 来週の予定. A period modifying one workload, such as 今週合計300語, belongs in that workload periodExpression and must not become planningWindow.',
    'Keep relative date expressions such as 今日, 明日, 今週, and 来週 as semantic expressions. Do not calculate ISO dates. Normalize explicit clock times to HH:mm when certain.',
    'Use unitCode exam_year for 1年分 or 2年分 of past questions. Specific calendar years belong only in rangeStart and rangeEnd.',
    'Keep unrelated activities as separate tasks. Preserve before, after, dependency, priority, and sequence relations with response-local task IDs.',
    'Classify work, chores, errands, appointments, thesis work, laboratory work, and personal projects as non_study unless explicitly framed as learning. Use unknown only when classification is genuinely unresolved.',
    'Use corrections and decisions only for explicit user corrections or explicit decisions about a previously presented public item. Otherwise return empty arrays.',
    'Do not invent facts. Preserve a short supporting excerpt in every sourceText.',
  ].join('\n');
}

export function createWeeklyPlanningSemanticUserPrompt(params: {
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
