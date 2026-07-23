export const SEMANTIC_PLANNING_SCHEMA_VERSION = 'planning-semantic-v0' as const;

export type SemanticTaskCategory = 'study' | 'non_study' | 'unknown';
export type SemanticStudyPurpose =
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

export type SemanticComponentRole =
  | 'subject'
  | 'field'
  | 'material'
  | 'topic'
  | 'chapter'
  | 'section'
  | 'skill'
  | 'custom';

export type SemanticWorkloadUnitCode =
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

export interface SemanticWorkload {
  kind: 'total' | 'remaining' | 'completed' | 'target';
  amount: number;
  unitCode: SemanticWorkloadUnitCode;
  unitLabel: string;
  rangeStart: string | null;
  rangeEnd: string | null;
  perOccurrence: boolean;
  sourceText: string;
}

export interface SemanticStudyComponent {
  localId: string;
  parentLocalId: string | null;
  role: SemanticComponentRole;
  label: string;
  workloads: SemanticWorkload[];
  sourceText: string;
}

export interface SemanticStudyDetails {
  purpose: SemanticStudyPurpose;
  contextLabel: string | null;
  components: SemanticStudyComponent[];
}

export interface SemanticScheduleConstraint {
  targetLocalId: string;
  kind:
    | 'start_time'
    | 'end_time'
    | 'time_range'
    | 'duration'
    | 'deadline'
    | 'preferred_time'
    | 'avoid_time';
  dateExpression: string | null;
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number | null;
  precision: 'exact' | 'approximate' | 'unspecified';
  sourceText: string;
}

export interface SemanticRecurrence {
  targetLocalId: string;
  kind: 'daily' | 'weekly' | 'weekdays' | 'weekends' | 'times_per_week' | 'custom';
  count: number | null;
  days: string[];
  sourceText: string;
}

export interface SemanticTask {
  localId: string;
  category: SemanticTaskCategory;
  title: string;
  study: SemanticStudyDetails | null;
  workloads: SemanticWorkload[];
  scheduleConstraints: SemanticScheduleConstraint[];
  recurrence: SemanticRecurrence[];
  sourceText: string;
}

export interface SemanticTaskRelation {
  kind: 'before' | 'after' | 'depends_on' | 'priority_over' | 'sequence';
  fromLocalId: string;
  toLocalId: string;
  sourceText: string;
}

export interface SemanticPlanningWindow {
  kind: 'absolute' | 'relative_day' | 'relative_week' | 'named_period';
  value: string;
  start: string | null;
  end: string | null;
  sourceText: string;
}

export interface SemanticUncertainty {
  targetLocalId: string;
  field: string;
  reason: string;
}

export interface SemanticPlanningDocument {
  schemaVersion: typeof SEMANTIC_PLANNING_SCHEMA_VERSION;
  planningIntent: 'create_plan' | 'update_plan' | 'discuss' | 'unknown';
  planningWindow: SemanticPlanningWindow | null;
  tasks: SemanticTask[];
  relations: SemanticTaskRelation[];
  uncertainties: SemanticUncertainty[];
}

const nullableStringSchema = { type: ['string', 'null'] } as const;
const nullableNumberSchema = { type: ['number', 'null'] } as const;

const WORKLOAD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'kind', 'amount', 'unitCode', 'unitLabel', 'rangeStart', 'rangeEnd',
    'perOccurrence', 'sourceText',
  ],
  properties: {
    kind: { type: 'string', enum: ['total', 'remaining', 'completed', 'target'] },
    amount: { type: 'number' },
    unitCode: {
      type: 'string',
      enum: [
        'minute', 'hour', 'page', 'problem', 'word', 'lesson', 'chapter',
        'section', 'exam_year', 'mock_exam', 'session', 'custom',
      ],
    },
    unitLabel: { type: 'string' },
    rangeStart: nullableStringSchema,
    rangeEnd: nullableStringSchema,
    perOccurrence: { type: 'boolean' },
    sourceText: { type: 'string' },
  },
} as const;

const COMPONENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['localId', 'parentLocalId', 'role', 'label', 'workloads', 'sourceText'],
  properties: {
    localId: { type: 'string' },
    parentLocalId: nullableStringSchema,
    role: {
      type: 'string',
      enum: ['subject', 'field', 'material', 'topic', 'chapter', 'section', 'skill', 'custom'],
    },
    label: { type: 'string' },
    workloads: { type: 'array', items: WORKLOAD_SCHEMA },
    sourceText: { type: 'string' },
  },
} as const;

const STUDY_SCHEMA = {
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
    contextLabel: nullableStringSchema,
    components: { type: 'array', items: COMPONENT_SCHEMA },
  },
} as const;

const SCHEDULE_CONSTRAINT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'targetLocalId', 'kind', 'dateExpression', 'startTime', 'endTime',
    'durationMinutes', 'precision', 'sourceText',
  ],
  properties: {
    targetLocalId: { type: 'string' },
    kind: {
      type: 'string',
      enum: [
        'start_time', 'end_time', 'time_range', 'duration', 'deadline',
        'preferred_time', 'avoid_time',
      ],
    },
    dateExpression: nullableStringSchema,
    startTime: nullableStringSchema,
    endTime: nullableStringSchema,
    durationMinutes: nullableNumberSchema,
    precision: { type: 'string', enum: ['exact', 'approximate', 'unspecified'] },
    sourceText: { type: 'string' },
  },
} as const;

const RECURRENCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['targetLocalId', 'kind', 'count', 'days', 'sourceText'],
  properties: {
    targetLocalId: { type: 'string' },
    kind: {
      type: 'string',
      enum: ['daily', 'weekly', 'weekdays', 'weekends', 'times_per_week', 'custom'],
    },
    count: nullableNumberSchema,
    days: { type: 'array', items: { type: 'string' } },
    sourceText: { type: 'string' },
  },
} as const;

const TASK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'localId', 'category', 'title', 'study', 'workloads',
    'scheduleConstraints', 'recurrence', 'sourceText',
  ],
  properties: {
    localId: { type: 'string' },
    category: { type: 'string', enum: ['study', 'non_study', 'unknown'] },
    title: { type: 'string' },
    study: { anyOf: [STUDY_SCHEMA, { type: 'null' }] },
    workloads: { type: 'array', items: WORKLOAD_SCHEMA },
    scheduleConstraints: { type: 'array', items: SCHEDULE_CONSTRAINT_SCHEMA },
    recurrence: { type: 'array', items: RECURRENCE_SCHEMA },
    sourceText: { type: 'string' },
  },
} as const;

export const WEEKLY_PLANNING_SEMANTIC_EXPERIMENT_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'weekly_planning_semantic_document_v0',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'schemaVersion', 'planningIntent', 'planningWindow',
        'tasks', 'relations', 'uncertainties',
      ],
      properties: {
        schemaVersion: { const: SEMANTIC_PLANNING_SCHEMA_VERSION },
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
                start: nullableStringSchema,
                end: nullableStringSchema,
                sourceText: { type: 'string' },
              },
            },
            { type: 'null' },
          ],
        },
        tasks: { type: 'array', items: TASK_SCHEMA },
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

export function createSemanticExperimentSystemPrompt(): string {
  return [
    'You normalize Japanese planning utterances into a generic task semantic document.',
    'Return JSON only and follow the response schema exactly.',
    'Describe what the user said. Do not emit application commands, reducer operations, database IDs, readiness decisions, questions, or schedule placements.',
    'The only top-level task categories are study, non_study, and unknown.',
    'Entrance exams, qualification exams, school exams, courses, homework, self-study, review, practice, and study habits are all ordinary study tasks. An exam is study context, not a special top-level task type.',
    'Use study.purpose and study.contextLabel to express why the user studies. Keep specific subjects, fields, materials, topics, chapters, sections, and skills as flat study components linked by parentLocalId.',
    'Attach every workload to the exact task or component it modifies. Never place parallel labels and quantities in separate arrays that depend on ordering.',
    'Use unitCode exam_year for expressions such as 1年分 or 2年分 of past questions. Put specific calendar exam years only in rangeStart and rangeEnd.',
    'Use workload kind remaining when the user describes work still to do, target when they state a desired amount, completed for finished work, and total only for a stated total independent of progress.',
    'Keep unrelated activities as separate tasks even when they occur in one sentence.',
    'A time expression attached to an activity is a schedule constraint for that task or component, not the overall planning window.',
    'Use targetLocalId on constraints and recurrence so component-specific timing remains attached to the correct component.',
    'Represent before, after, dependency, priority, and sequence statements in relations using local IDs from this response.',
    'Classify research, work, chores, errands, appointments, and personal projects as non_study unless the user explicitly frames them as learning. Use unknown when the distinction is genuinely unresolved.',
    'Do not invent missing subjects, units, dates, times, task categories, hierarchy, or relations. Record unresolved information in uncertainties only when it matters to the expressed meaning.',
    'Preserve short source excerpts in sourceText for traceability.',
  ].join('\n');
}

export function createSemanticExperimentUserPrompt(params: {
  userText: string;
  currentDateTime?: string;
  selectedDate?: string;
}): string {
  return JSON.stringify({
    userText: params.userText,
    context: {
      currentDateTime: params.currentDateTime ?? null,
      selectedDate: params.selectedDate ?? null,
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

export function validateSemanticPlanningDocument(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ['document:not-object'];
  if (value.schemaVersion !== SEMANTIC_PLANNING_SCHEMA_VERSION) errors.push('schemaVersion');
  if (!['create_plan', 'update_plan', 'discuss', 'unknown'].includes(String(value.planningIntent))) {
    errors.push('planningIntent');
  }
  if (!Array.isArray(value.tasks)) return [...errors, 'tasks:not-array'];
  const taskIds = new Set<string>();
  const targetIds = new Set<string>();

  value.tasks.forEach((rawTask, taskIndex) => {
    if (!isRecord(rawTask)) {
      errors.push(`tasks[${taskIndex}]:not-object`);
      return;
    }
    const localId = rawTask.localId;
    if (typeof localId !== 'string' || !localId) errors.push(`tasks[${taskIndex}].localId`);
    else {
      if (taskIds.has(localId)) errors.push(`tasks[${taskIndex}].localId:duplicate`);
      taskIds.add(localId);
      targetIds.add(localId);
    }
    const category = String(rawTask.category);
    if (!['study', 'non_study', 'unknown'].includes(category)) {
      errors.push(`tasks[${taskIndex}].category`);
    }
    if (category === 'study' && !isRecord(rawTask.study)) {
      errors.push(`tasks[${taskIndex}].study:required`);
    }
    if (category === 'non_study' && rawTask.study !== null) {
      errors.push(`tasks[${taskIndex}].study:must-be-null`);
    }
    if (isRecord(rawTask.study)) {
      const components = rawTask.study.components;
      if (!Array.isArray(components)) {
        errors.push(`tasks[${taskIndex}].study.components`);
      } else {
        const componentIds = new Set<string>();
        components.forEach((rawComponent, componentIndex) => {
          if (!isRecord(rawComponent) || typeof rawComponent.localId !== 'string') {
            errors.push(`tasks[${taskIndex}].components[${componentIndex}].localId`);
            return;
          }
          if (componentIds.has(rawComponent.localId)) {
            errors.push(`tasks[${taskIndex}].components[${componentIndex}].localId:duplicate`);
          }
          componentIds.add(rawComponent.localId);
          targetIds.add(rawComponent.localId);
          if (!isStringOrNull(rawComponent.parentLocalId)) {
            errors.push(`tasks[${taskIndex}].components[${componentIndex}].parentLocalId`);
          }
        });
        components.forEach((rawComponent, componentIndex) => {
          if (!isRecord(rawComponent)) return;
          if (typeof rawComponent.parentLocalId === 'string'
            && !componentIds.has(rawComponent.parentLocalId)) {
            errors.push(`tasks[${taskIndex}].components[${componentIndex}].parentLocalId:unknown`);
          }
        });
      }
    }
    if (!Array.isArray(rawTask.scheduleConstraints)) {
      errors.push(`tasks[${taskIndex}].scheduleConstraints`);
    } else {
      rawTask.scheduleConstraints.forEach((rawConstraint, constraintIndex) => {
        if (!isRecord(rawConstraint)) {
          errors.push(`tasks[${taskIndex}].scheduleConstraints[${constraintIndex}]`);
          return;
        }
        if (!isStringOrNull(rawConstraint.dateExpression)
          || !isStringOrNull(rawConstraint.startTime)
          || !isStringOrNull(rawConstraint.endTime)
          || !isNumberOrNull(rawConstraint.durationMinutes)) {
          errors.push(`tasks[${taskIndex}].scheduleConstraints[${constraintIndex}]:value`);
        }
      });
    }
  });

  if (!Array.isArray(value.relations)) {
    errors.push('relations:not-array');
  } else {
    value.relations.forEach((rawRelation, index) => {
      if (!isRecord(rawRelation)) {
        errors.push(`relations[${index}]:not-object`);
        return;
      }
      if (!targetIds.has(String(rawRelation.fromLocalId))) errors.push(`relations[${index}].fromLocalId`);
      if (!targetIds.has(String(rawRelation.toLocalId))) errors.push(`relations[${index}].toLocalId`);
    });
  }
  if (!Array.isArray(value.uncertainties)) errors.push('uncertainties:not-array');
  return errors;
}

export function parseSemanticPlanningDocument(content: string): {
  document: SemanticPlanningDocument | null;
  errors: string[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { document: null, errors: ['invalid-json'] };
  }
  const errors = validateSemanticPlanningDocument(parsed);
  return {
    document: errors.length === 0 ? parsed as SemanticPlanningDocument : null,
    errors,
  };
}
