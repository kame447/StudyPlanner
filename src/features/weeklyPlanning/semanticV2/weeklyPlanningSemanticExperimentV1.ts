export const SEMANTIC_PLANNING_V1_SCHEMA_VERSION = 'planning-semantic-v1' as const;

export interface SemanticWorkloadV1 {
  kind: 'total' | 'remaining' | 'completed' | 'target';
  amount: number;
  unitCode:
    | 'minute'
    | 'hour'
    | 'page'
    | 'problem'
    | 'word'
    | 'lesson'
    | 'chapter'
    | 'section'
    | 'exam_year'
    | 'mock_exam'
    | 'session'
    | 'custom';
  unitLabel: string;
  rangeStart: string | null;
  rangeEnd: string | null;
  perOccurrence: boolean;
  periodExpression: string | null;
  sourceText: string;
}

export interface SemanticStudyComponentV1 {
  localId: string;
  parentLocalId: string | null;
  role: 'subject' | 'field' | 'material' | 'topic' | 'chapter' | 'section' | 'skill' | 'custom';
  label: string;
  workloads: SemanticWorkloadV1[];
  sourceText: string;
}

export interface SemanticStudyDetailsV1 {
  purpose:
    | 'exam'
    | 'course'
    | 'homework'
    | 'self_study'
    | 'review'
    | 'practice'
    | 'habit'
    | 'research'
    | 'other'
    | 'unknown';
  contextLabel: string | null;
  components: SemanticStudyComponentV1[];
}

export interface SemanticEffortEstimateV1 {
  targetLocalId: string;
  kind: 'total_duration' | 'duration_per_unit' | 'session_duration';
  minutes: number;
  unitCode: SemanticWorkloadV1['unitCode'] | null;
  precision: 'exact' | 'approximate';
  sourceText: string;
}

export interface SemanticTemporalConstraintV1 {
  targetLocalId: string;
  kind:
    | 'earliest_start'
    | 'latest_end'
    | 'fixed_interval'
    | 'deadline'
    | 'preferred_window'
    | 'avoid_window';
  dateExpression: string | null;
  startTime: string | null;
  endTime: string | null;
  precision: 'exact' | 'approximate' | 'unspecified';
  sourceText: string;
}

export interface SemanticRecurrenceV1 {
  targetLocalId: string;
  kind: 'daily' | 'weekly' | 'weekdays' | 'weekends' | 'times_per_week' | 'custom';
  count: number | null;
  days: string[];
  sourceText: string;
}

export interface SemanticTaskV1 {
  localId: string;
  category: 'study' | 'non_study' | 'unknown';
  title: string;
  study: SemanticStudyDetailsV1 | null;
  workloads: SemanticWorkloadV1[];
  effortEstimates: SemanticEffortEstimateV1[];
  temporalConstraints: SemanticTemporalConstraintV1[];
  recurrence: SemanticRecurrenceV1[];
  sourceText: string;
}

export interface SemanticPlanningDocumentV1 {
  schemaVersion: typeof SEMANTIC_PLANNING_V1_SCHEMA_VERSION;
  planningIntent: 'create_plan' | 'update_plan' | 'discuss' | 'unknown';
  planningWindow: {
    kind: 'absolute' | 'relative_day' | 'relative_week' | 'named_period';
    value: string;
    start: string | null;
    end: string | null;
    sourceText: string;
  } | null;
  tasks: SemanticTaskV1[];
  relations: Array<{
    kind: 'before' | 'after' | 'depends_on' | 'priority_over' | 'sequence';
    fromLocalId: string;
    toLocalId: string;
    sourceText: string;
  }>;
  uncertainties: Array<{
    targetLocalId: string;
    field: string;
    reason: string;
  }>;
}

const nullableString = { type: ['string', 'null'] } as const;
const nullableNumber = { type: ['number', 'null'] } as const;
const workloadUnitCodes = [
  'minute', 'hour', 'page', 'problem', 'word', 'lesson', 'chapter',
  'section', 'exam_year', 'mock_exam', 'session', 'custom',
] as const;

const workloadSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'kind', 'amount', 'unitCode', 'unitLabel', 'rangeStart', 'rangeEnd',
    'perOccurrence', 'periodExpression', 'sourceText',
  ],
  properties: {
    kind: { type: 'string', enum: ['total', 'remaining', 'completed', 'target'] },
    amount: { type: 'number' },
    unitCode: { type: 'string', enum: workloadUnitCodes },
    unitLabel: { type: 'string' },
    rangeStart: nullableString,
    rangeEnd: nullableString,
    perOccurrence: { type: 'boolean' },
    periodExpression: nullableString,
    sourceText: { type: 'string' },
  },
} as const;

const componentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['localId', 'parentLocalId', 'role', 'label', 'workloads', 'sourceText'],
  properties: {
    localId: { type: 'string' },
    parentLocalId: nullableString,
    role: {
      type: 'string',
      enum: ['subject', 'field', 'material', 'topic', 'chapter', 'section', 'skill', 'custom'],
    },
    label: { type: 'string' },
    workloads: { type: 'array', items: workloadSchema },
    sourceText: { type: 'string' },
  },
} as const;

const studySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['purpose', 'contextLabel', 'components'],
  properties: {
    purpose: {
      type: 'string',
      enum: [
        'exam', 'course', 'homework', 'self_study', 'review', 'practice',
        'habit', 'research', 'other', 'unknown',
      ],
    },
    contextLabel: nullableString,
    components: { type: 'array', items: componentSchema },
  },
} as const;

const effortEstimateSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['targetLocalId', 'kind', 'minutes', 'unitCode', 'precision', 'sourceText'],
  properties: {
    targetLocalId: { type: 'string' },
    kind: {
      type: 'string',
      enum: ['total_duration', 'duration_per_unit', 'session_duration'],
    },
    minutes: { type: 'number' },
    unitCode: { anyOf: [{ type: 'string', enum: workloadUnitCodes }, { type: 'null' }] },
    precision: { type: 'string', enum: ['exact', 'approximate'] },
    sourceText: { type: 'string' },
  },
} as const;

const temporalConstraintSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'targetLocalId', 'kind', 'dateExpression', 'startTime', 'endTime',
    'precision', 'sourceText',
  ],
  properties: {
    targetLocalId: { type: 'string' },
    kind: {
      type: 'string',
      enum: [
        'earliest_start', 'latest_end', 'fixed_interval', 'deadline',
        'preferred_window', 'avoid_window',
      ],
    },
    dateExpression: nullableString,
    startTime: nullableString,
    endTime: nullableString,
    precision: { type: 'string', enum: ['exact', 'approximate', 'unspecified'] },
    sourceText: { type: 'string' },
  },
} as const;

const recurrenceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['targetLocalId', 'kind', 'count', 'days', 'sourceText'],
  properties: {
    targetLocalId: { type: 'string' },
    kind: {
      type: 'string',
      enum: ['daily', 'weekly', 'weekdays', 'weekends', 'times_per_week', 'custom'],
    },
    count: nullableNumber,
    days: { type: 'array', items: { type: 'string' } },
    sourceText: { type: 'string' },
  },
} as const;

const taskSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'localId', 'category', 'title', 'study', 'workloads', 'effortEstimates',
    'temporalConstraints', 'recurrence', 'sourceText',
  ],
  properties: {
    localId: { type: 'string' },
    category: { type: 'string', enum: ['study', 'non_study', 'unknown'] },
    title: { type: 'string' },
    study: { anyOf: [studySchema, { type: 'null' }] },
    workloads: { type: 'array', items: workloadSchema },
    effortEstimates: { type: 'array', items: effortEstimateSchema },
    temporalConstraints: { type: 'array', items: temporalConstraintSchema },
    recurrence: { type: 'array', items: recurrenceSchema },
    sourceText: { type: 'string' },
  },
} as const;

export const SEMANTIC_PLANNING_V1_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'weekly_planning_semantic_document_v1',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'schemaVersion', 'planningIntent', 'planningWindow',
        'tasks', 'relations', 'uncertainties',
      ],
      properties: {
        schemaVersion: { type: 'string', const: SEMANTIC_PLANNING_V1_SCHEMA_VERSION },
        planningIntent: {
          type: 'string',
          enum: ['create_plan', 'update_plan', 'discuss', 'unknown'],
        },
        planningWindow: {
          anyOf: [
            {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'value', 'start', 'end', 'sourceText'],
              properties: {
                kind: {
                  type: 'string',
                  enum: ['absolute', 'relative_day', 'relative_week', 'named_period'],
                },
                value: { type: 'string' },
                start: nullableString,
                end: nullableString,
                sourceText: { type: 'string' },
              },
            },
            { type: 'null' },
          ],
        },
        tasks: { type: 'array', items: taskSchema },
        relations: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'fromLocalId', 'toLocalId', 'sourceText'],
            properties: {
              kind: {
                type: 'string',
                enum: ['before', 'after', 'depends_on', 'priority_over', 'sequence'],
              },
              fromLocalId: { type: 'string' },
              toLocalId: { type: 'string' },
              sourceText: { type: 'string' },
            },
          },
        },
        uncertainties: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['targetLocalId', 'field', 'reason'],
            properties: {
              targetLocalId: { type: 'string' },
              field: { type: 'string' },
              reason: { type: 'string' },
            },
          },
        },
      },
    },
  },
} as const;

export function createSemanticPlanningV1SystemPrompt(): string {
  return [
    'You normalize Japanese planning utterances into a generic semantic task document.',
    'Return JSON only and follow the response schema exactly.',
    'Describe user meaning only. Never emit application commands, reducer operations, database IDs, questions, readiness decisions, or schedule placements.',
    'The only top-level task categories are study, non_study, and unknown.',
    'Entrance exams, qualification exams, school exams, courses, homework, self-study, review, practice, research-as-learning, and habits are ordinary study tasks. Exam identity belongs in study.purpose and study.contextLabel, never in a special top-level type.',
    'Represent subjects, fields, materials, topics, chapters, sections, and skills as components. Use parentLocalId for hierarchy.',
    'Attach each workload to the deepest task or component that it directly modifies. Do not store labels and quantities in parallel arrays.',
    'A time amount that states how much the user will do, such as 30分勉強する or 掃除を1時間する, is a workload with unitCode minute or hour.',
    'A statement about expected effort, such as 1問10分かかる or 全部で3時間くらい, is an effortEstimate. Use duration_per_unit only when an explicit unit basis exists.',
    'Temporal constraints express when work may or must happen, not how much work exists.',
    'Use deadline for までに終える, 提出, 締切, or completion-by expressions. Use latest_end for まで進める or まで作業する. Use earliest_start for から始める.',
    'planningWindow is only the period for the whole requested plan, such as 今日の計画 or 来週の予定. A period modifying one workload, such as 今週合計300語, belongs in that workload periodExpression and must not become planningWindow.',
    'Keep relative date expressions such as 今日, 明日, 今週, and 来週 as semantic expressions. Do not calculate ISO dates. Normalize explicit clock times to HH:mm when certain.',
    'Use unitCode exam_year for 1年分 or 2年分 of past questions. Specific calendar years belong only in rangeStart and rangeEnd.',
    'Use targetLocalId for effort estimates, temporal constraints, and recurrence. A target may be a task or one of its components.',
    'Keep unrelated activities as separate tasks. Preserve before, after, dependency, priority, and sequence relations with response-local IDs.',
    'Classify work, chores, errands, appointments, and personal projects as non_study unless explicitly framed as learning. Use unknown only when classification is genuinely unresolved.',
    'Do not invent facts. Preserve short source excerpts in sourceText.',
  ].join('\n');
}

export function createSemanticPlanningV1UserPrompt(userText: string): string {
  return JSON.stringify({ userText });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseSemanticPlanningV1(content: string): {
  document: SemanticPlanningDocumentV1 | null;
  errors: string[];
} {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return { document: null, errors: ['invalid-json'] };
  }
  if (!isRecord(value)) return { document: null, errors: ['not-object'] };
  const errors: string[] = [];
  if (value.schemaVersion !== SEMANTIC_PLANNING_V1_SCHEMA_VERSION) errors.push('schemaVersion');
  if (!Array.isArray(value.tasks)) errors.push('tasks');
  if (!Array.isArray(value.relations)) errors.push('relations');
  if (!Array.isArray(value.uncertainties)) errors.push('uncertainties');
  if (errors.length > 0) return { document: null, errors };

  const document = value as unknown as SemanticPlanningDocumentV1;
  const taskIds = new Set(document.tasks.map((task) => task.localId));
  const targetIds = new Set(taskIds);
  for (const task of document.tasks) {
    for (const component of task.study?.components ?? []) targetIds.add(component.localId);
    if (task.category === 'study' && !task.study) errors.push(`study-required:${task.localId}`);
    if (task.category === 'non_study' && task.study !== null) errors.push(`study-forbidden:${task.localId}`);
    for (const estimate of task.effortEstimates) {
      if (!targetIds.has(estimate.targetLocalId)) errors.push(`estimate-target:${estimate.targetLocalId}`);
    }
    for (const constraint of task.temporalConstraints) {
      if (!targetIds.has(constraint.targetLocalId)) errors.push(`constraint-target:${constraint.targetLocalId}`);
    }
    for (const recurrence of task.recurrence) {
      if (!targetIds.has(recurrence.targetLocalId)) errors.push(`recurrence-target:${recurrence.targetLocalId}`);
    }
  }
  for (const relation of document.relations) {
    if (!taskIds.has(relation.fromLocalId)) errors.push(`relation-from:${relation.fromLocalId}`);
    if (!taskIds.has(relation.toLocalId)) errors.push(`relation-to:${relation.toLocalId}`);
  }
  return {
    document: errors.length === 0 ? document : null,
    errors,
  };
}
