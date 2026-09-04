import type {
  JsonSchemaResponseFormat,
} from '../../../services/ai/openAiCompatibleClient';
import {
  CANONICAL_RELATIVE_DAY_EXPRESSIONS,
  CANONICAL_RELATIVE_WEEK_EXPRESSIONS,
  CANONICAL_WEEKDAY_DATE_EXPRESSIONS,
} from './weeklyPlanningCalendarResolver';
import {
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5,
} from './weeklyPlanningSemanticSchemaV5';

const ISO_DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';
const AVAILABILITY_REFERENCE_KIND = 'availability_declaration';

const nullableStringSchema = { type: ['string', 'null'] } as const;
const sourceTextProperty = { sourceText: { type: 'string' } } as const;
const planningWindowRequired = [
  'localId',
  'kind',
  'value',
  'start',
  'end',
  'sourceText',
] as const;

const absolutePlanningWindowSchema = {
  type: 'object',
  additionalProperties: false,
  required: planningWindowRequired,
  properties: {
    localId: { type: 'string' },
    kind: { type: 'string', const: 'absolute' },
    value: { type: 'string' },
    start: { type: 'string', pattern: ISO_DATE_PATTERN },
    end: { type: 'string', pattern: ISO_DATE_PATTERN },
    ...sourceTextProperty,
  },
} as const;

const relativeDayPlanningWindowSchema = {
  type: 'object',
  additionalProperties: false,
  required: planningWindowRequired,
  properties: {
    localId: { type: 'string' },
    kind: { type: 'string', const: 'relative_day' },
    value: {
      type: 'string',
      enum: CANONICAL_RELATIVE_DAY_EXPRESSIONS,
    },
    start: nullableStringSchema,
    end: nullableStringSchema,
    ...sourceTextProperty,
  },
} as const;

const relativeWeekPlanningWindowSchema = {
  type: 'object',
  additionalProperties: false,
  required: planningWindowRequired,
  properties: {
    localId: { type: 'string' },
    kind: { type: 'string', const: 'relative_week' },
    value: {
      type: 'string',
      enum: CANONICAL_RELATIVE_WEEK_EXPRESSIONS,
    },
    start: nullableStringSchema,
    end: nullableStringSchema,
    ...sourceTextProperty,
  },
} as const;

const namedPeriodPlanningWindowSchema = {
  type: 'object',
  additionalProperties: false,
  required: planningWindowRequired,
  properties: {
    localId: { type: 'string' },
    kind: { type: 'string', const: 'named_period' },
    value: { type: 'string' },
    start: nullableStringSchema,
    end: nullableStringSchema,
    ...sourceTextProperty,
  },
} as const;

const canonicalWeekdayArraySchema = {
  type: 'array',
  items: {
    type: 'string',
    enum: CANONICAL_WEEKDAY_DATE_EXPRESSIONS,
  },
} as const;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Stable V5 provider schema path is not an object: ${label}`);
  }
  return value as Record<string, unknown>;
}

function appendEnumValue(params: {
  schema: Record<string, unknown>;
  label: string;
  value: string;
}): void {
  const enumValues = params.schema.enum;
  if (!Array.isArray(enumValues) || enumValues.some((entry) => typeof entry !== 'string')) {
    throw new Error(`Stable V5 provider schema enum is invalid: ${params.label}`);
  }
  if (!enumValues.includes(params.value)) {
    params.schema.enum = [...enumValues, params.value];
  }
}

function buildProviderResponseFormatV5(): JsonSchemaResponseFormat {
  const format = structuredClone(
    WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5,
  ) as JsonSchemaResponseFormat;
  const root = record(format.json_schema.schema, 'schema');
  const rootProperties = record(root.properties, 'schema.properties');

  rootProperties.planningWindow = {
    anyOf: [
      absolutePlanningWindowSchema,
      relativeDayPlanningWindowSchema,
      relativeWeekPlanningWindowSchema,
      namedPeriodPlanningWindowSchema,
      { type: 'null' },
    ],
  };

  const tasks = record(rootProperties.tasks, 'schema.properties.tasks');
  const taskItems = record(tasks.items, 'schema.properties.tasks.items');
  const taskProperties = record(
    taskItems.properties,
    'schema.properties.tasks.items.properties',
  );
  const recurrence = record(
    taskProperties.recurrence,
    'schema.properties.tasks.items.properties.recurrence',
  );
  const recurrenceItems = record(
    recurrence.items,
    'schema.properties.tasks.items.properties.recurrence.items',
  );
  const recurrenceProperties = record(
    recurrenceItems.properties,
    'schema.properties.tasks.items.properties.recurrence.items.properties',
  );
  recurrenceProperties.days = canonicalWeekdayArraySchema;

  const availability = record(
    rootProperties.availabilityDeclarations,
    'schema.properties.availabilityDeclarations',
  );
  const availabilityItems = record(
    availability.items,
    'schema.properties.availabilityDeclarations.items',
  );
  const availabilityProperties = record(
    availabilityItems.properties,
    'schema.properties.availabilityDeclarations.items.properties',
  );
  availabilityProperties.days = canonicalWeekdayArraySchema;

  const corrections = record(
    rootProperties.corrections,
    'schema.properties.corrections',
  );
  const correctionItems = record(
    corrections.items,
    'schema.properties.corrections.items',
  );
  const correctionProperties = record(
    correctionItems.properties,
    'schema.properties.corrections.items.properties',
  );
  const correctionTarget = record(
    correctionProperties.target,
    'schema.properties.corrections.items.properties.target',
  );
  const correctionTargetProperties = record(
    correctionTarget.properties,
    'schema.properties.corrections.items.properties.target.properties',
  );
  const correctionTargetKind = record(
    correctionTargetProperties.kind,
    'schema.properties.corrections.items.properties.target.properties.kind',
  );
  appendEnumValue({
    schema: correctionTargetKind,
    label: 'schema.properties.corrections.items.properties.target.properties.kind',
    value: AVAILABILITY_REFERENCE_KIND,
  });

  return format;
}

/*
 * Provider-only representation overlay.
 *
 * The semantic TypeScript model intentionally remains broad enough to decode
 * historical/checkpoint data. New AI responses are stricter: relative date
 * windows select canonical finite values, absolute windows use ISO-shaped
 * start/end values, recurrence days use the canonical weekday:<english-day>
 * vocabulary, and explicit availability corrections may address an existing
 * availability declaration by its public ID. Representation rules therefore
 * live in JSON Schema instead of being repeated in deterministic text parsing.
 */
export const WEEKLY_PLANNING_SEMANTIC_PROVIDER_RESPONSE_FORMAT_V5 =
  buildProviderResponseFormatV5();
