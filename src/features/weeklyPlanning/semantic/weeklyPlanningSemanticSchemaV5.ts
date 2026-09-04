import type { JsonSchemaResponseFormat } from '../../../services/ai/openAiCompatibleClient';
import { USER_PLANNING_CONTEXT_SEMANTIC_KINDS_V1 } from '../../userPlanningContext/userPlanningContextTypes';
import {
  SEMANTIC_AVAILABILITY_KINDS_V5,
  SEMANTIC_AVAILABILITY_RECURRENCE_KINDS_V5,
  SEMANTIC_COMPONENT_ROLES_V5,
  SEMANTIC_CONSTRAINT_LEVELS_V5,
  SEMANTIC_CONSTRAINT_SOURCE_KINDS_V5,
  SEMANTIC_DURABLE_CONCERN_BASES_V5,
  SEMANTIC_NAMED_TIME_PERIODS_V5,
  SEMANTIC_QUANTITY_ROLES_V5,
  SEMANTIC_RECURRENCE_KINDS_V5,
  SEMANTIC_STUDY_ACTIVITY_KINDS_V5,
  SEMANTIC_STUDY_PURPOSES_V5,
  SEMANTIC_TASK_CATEGORIES_V5,
  SEMANTIC_TASK_DECOMPOSITION_STATUSES_V5,
  SEMANTIC_TEMPORAL_CONSTRAINT_KINDS_V5,
  SEMANTIC_WORKLOAD_UNIT_CODES_V5,
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
} from './weeklyPlanningSemanticTypesV5';

type JsonSchema = Record<string, unknown>;

const stringSchema = { type: 'string' } as const;
const numberSchema = { type: 'number' } as const;
const booleanSchema = { type: 'boolean' } as const;
const nullableStringSchema = { type: ['string', 'null'] } as const;
const nullableNumberSchema = { type: ['number', 'null'] } as const;
const sourceTextProperty = { sourceText: stringSchema } as const;

function enumSchema(values: readonly string[]): JsonSchema {
  return { type: 'string', enum: [...values] };
}

function arraySchema(items: JsonSchema | Readonly<Record<string, unknown>>): JsonSchema {
  return { type: 'array', items };
}

function objectSchema(
  required: readonly string[],
  properties: Record<string, unknown>,
): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: [...required],
    properties,
  };
}

const nullableNamedTimePeriodSchema = {
  anyOf: [
    enumSchema(SEMANTIC_NAMED_TIME_PERIODS_V5),
    { type: 'string', pattern: '^custom:.+$' },
    { type: 'null' },
  ],
} as const;

const workloadSchema = objectSchema(
  [
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
  {
    localId: stringSchema,
    quantityRole: enumSchema(SEMANTIC_QUANTITY_ROLES_V5),
    amount: numberSchema,
    unitCode: enumSchema(SEMANTIC_WORKLOAD_UNIT_CODES_V5),
    unitLabel: stringSchema,
    rangeStart: nullableStringSchema,
    rangeEnd: nullableStringSchema,
    perOccurrence: booleanSchema,
    periodExpression: nullableStringSchema,
    ...sourceTextProperty,
  },
);

const durableContextSignalSchema = objectSchema(
  ['localId', 'kind', 'basis', 'value', 'sourceText'],
  {
    localId: stringSchema,
    kind: { type: 'string', enum: ['concern'] },
    basis: enumSchema(SEMANTIC_DURABLE_CONCERN_BASES_V5),
    value: nullableStringSchema,
    ...sourceTextProperty,
  },
);

const componentSchema = objectSchema(
  [
    'localId',
    'existingPublicId',
    'parentLocalId',
    'role',
    'label',
    'workloads',
    'durableContextSignals',
    'sourceText',
  ],
  {
    localId: stringSchema,
    existingPublicId: nullableStringSchema,
    parentLocalId: nullableStringSchema,
    role: enumSchema(SEMANTIC_COMPONENT_ROLES_V5),
    label: stringSchema,
    workloads: arraySchema(workloadSchema),
    durableContextSignals: arraySchema(durableContextSignalSchema),
    ...sourceTextProperty,
  },
);

const studySchema = objectSchema(
  ['purpose', 'activityKind', 'contextLabel', 'components'],
  {
    purpose: enumSchema(SEMANTIC_STUDY_PURPOSES_V5),
    activityKind: enumSchema(SEMANTIC_STUDY_ACTIVITY_KINDS_V5),
    contextLabel: nullableStringSchema,
    components: arraySchema(componentSchema),
  },
);

const effortEstimateSchema = objectSchema(
  [
    'localId',
    'targetLocalId',
    'kind',
    'minutes',
    'unitCode',
    'precision',
    'sourceText',
  ],
  {
    localId: stringSchema,
    targetLocalId: stringSchema,
    kind: enumSchema(['total_duration', 'duration_per_unit', 'session_duration']),
    minutes: numberSchema,
    unitCode: {
      anyOf: [enumSchema(SEMANTIC_WORKLOAD_UNIT_CODES_V5), { type: 'null' }],
    },
    precision: enumSchema(['exact', 'approximate', 'unspecified']),
    ...sourceTextProperty,
  },
);

const temporalConstraintSchema = objectSchema(
  [
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
  {
    localId: stringSchema,
    targetLocalId: stringSchema,
    kind: enumSchema(SEMANTIC_TEMPORAL_CONSTRAINT_KINDS_V5),
    constraintLevel: enumSchema(SEMANTIC_CONSTRAINT_LEVELS_V5),
    dateExpression: nullableStringSchema,
    namedTimePeriod: nullableNamedTimePeriodSchema,
    startTime: nullableStringSchema,
    endTime: nullableStringSchema,
    precision: enumSchema(['exact', 'approximate', 'unspecified']),
    ...sourceTextProperty,
  },
);

const recurrenceSchema = objectSchema(
  ['localId', 'targetLocalId', 'kind', 'count', 'days', 'sourceText'],
  {
    localId: stringSchema,
    targetLocalId: stringSchema,
    kind: enumSchema(SEMANTIC_RECURRENCE_KINDS_V5),
    count: nullableNumberSchema,
    days: arraySchema(stringSchema),
    ...sourceTextProperty,
  },
);

const taskSchema = objectSchema(
  [
    'localId',
    'existingPublicId',
    'decompositionStatus',
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
  {
    localId: stringSchema,
    existingPublicId: nullableStringSchema,
    decompositionStatus: enumSchema(SEMANTIC_TASK_DECOMPOSITION_STATUSES_V5),
    category: enumSchema(SEMANTIC_TASK_CATEGORIES_V5),
    title: stringSchema,
    study: { anyOf: [studySchema, { type: 'null' }] },
    workloads: arraySchema(workloadSchema),
    effortEstimates: arraySchema(effortEstimateSchema),
    temporalConstraints: arraySchema(temporalConstraintSchema),
    recurrence: arraySchema(recurrenceSchema),
    durableContextSignals: arraySchema(durableContextSignalSchema),
    ...sourceTextProperty,
  },
);

const planningWindowSchema = objectSchema(
  ['localId', 'kind', 'value', 'start', 'end', 'sourceText'],
  {
    localId: stringSchema,
    kind: enumSchema(['absolute', 'relative_day', 'relative_week', 'named_period']),
    value: stringSchema,
    start: nullableStringSchema,
    end: nullableStringSchema,
    ...sourceTextProperty,
  },
);

const relationSchema = objectSchema(
  ['localId', 'kind', 'fromLocalId', 'toLocalId', 'sourceText'],
  {
    localId: stringSchema,
    kind: enumSchema(['before', 'after', 'depends_on', 'priority_over', 'sequence']),
    fromLocalId: stringSchema,
    toLocalId: stringSchema,
    ...sourceTextProperty,
  },
);

const uncertaintySchema = objectSchema(
  ['localId', 'targetLocalId', 'field', 'reason', 'sourceText'],
  {
    localId: stringSchema,
    targetLocalId: stringSchema,
    field: stringSchema,
    reason: stringSchema,
    ...sourceTextProperty,
  },
);

const semanticReferenceSchema = objectSchema(
  ['kind', 'publicId', 'localId', 'mention'],
  {
    kind: enumSchema([
      'planning_window',
      'task',
      'component',
      'workload',
      'effort_estimate',
      'temporal_constraint',
      'recurrence',
      'relation',
      'availability_declaration',
      'proposal',
    ]),
    publicId: nullableStringSchema,
    localId: nullableStringSchema,
    mention: nullableStringSchema,
  },
);

const correctionSchema = objectSchema(
  ['localId', 'target', 'operation', 'replacementLocalId', 'sourceText'],
  {
    localId: stringSchema,
    target: semanticReferenceSchema,
    operation: enumSchema(['remove', 'replace', 'modify']),
    replacementLocalId: nullableStringSchema,
    ...sourceTextProperty,
  },
);

const decisionSchema = objectSchema(
  ['localId', 'target', 'decision', 'sourceText'],
  {
    localId: stringSchema,
    target: semanticReferenceSchema,
    decision: enumSchema(['accept', 'reject', 'modify']),
    ...sourceTextProperty,
  },
);

const availabilityDeclarationSchema = objectSchema(
  [
    'localId',
    'kind',
    'dateExpression',
    'namedTimePeriod',
    'startTime',
    'endTime',
    'recurrenceKind',
    'days',
    'constraintLevel',
    'capacityMinutes',
    'sourceText',
  ],
  {
    localId: stringSchema,
    kind: enumSchema(SEMANTIC_AVAILABILITY_KINDS_V5),
    dateExpression: nullableStringSchema,
    namedTimePeriod: nullableNamedTimePeriodSchema,
    startTime: nullableStringSchema,
    endTime: nullableStringSchema,
    recurrenceKind: {
      anyOf: [enumSchema(SEMANTIC_AVAILABILITY_RECURRENCE_KINDS_V5), { type: 'null' }],
    },
    days: arraySchema(stringSchema),
    constraintLevel: enumSchema(SEMANTIC_CONSTRAINT_LEVELS_V5),
    capacityMinutes: nullableNumberSchema,
    ...sourceTextProperty,
  },
);

const constraintSourceRequestSchema = objectSchema(
  ['localId', 'kind', 'selector', 'requestedAction', 'sourceText'],
  {
    localId: stringSchema,
    kind: enumSchema(SEMANTIC_CONSTRAINT_SOURCE_KINDS_V1),
    selector: { type: 'string', enum: ['active'] },
    requestedAction: enumSchema(['use', 'stop_using']),
    ...sourceTextProperty,
  },
);

const userContextFactSchema = objectSchema(
  ['localId', 'kind', 'label', 'value', 'dateExpression', 'sourceText'],
  {
    localId: stringSchema,
    kind: enumSchema(USER_PLANNING_CONTEXT_SEMANTIC_KINDS_V1),
    label: stringSchema,
    value: nullableStringSchema,
    dateExpression: nullableStringSchema,
    ...sourceTextProperty,
  },
);

const rootSchema = objectSchema(
  [
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
  {
    schemaVersion: {
      type: 'string',
      const: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    },
    planningIntent: enumSchema(['create_plan', 'update_plan', 'discuss', 'unknown']),
    planningWindow: { anyOf: [planningWindowSchema, { type: 'null' }] },
    tasks: arraySchema(taskSchema),
    relations: arraySchema(relationSchema),
    availabilityDeclarations: arraySchema(availabilityDeclarationSchema),
    constraintSourceRequests: arraySchema(constraintSourceRequestSchema),
    userContextFacts: arraySchema(userContextFactSchema),
    uncertainties: arraySchema(uncertaintySchema),
    corrections: arraySchema(correctionSchema),
    decisions: arraySchema(decisionSchema),
  },
);

export const WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'weekly_planning_semantic_document_v5',
    strict: true,
    schema: rootSchema,
  },
};
