import type {
  JsonSchemaResponseFormat,
} from '../../../services/ai/openAiCompatibleClient';
import {
  CANONICAL_WEEKDAY_DATE_EXPRESSIONS,
} from './weeklyPlanningCalendarResolver';
import {
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5,
} from './weeklyPlanningSemanticDocumentV5';

const ISO_DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';

const nullableStringSchema = { type: ['string', 'null'] } as const;
const sourceTextProperty = { sourceText: { type: 'string' } } as const;

const absolutePlanningWindowSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['localId', 'kind', 'value', 'start', 'end', 'sourceText'],
  properties: {
    localId: { type: 'string' },
    kind: { type: 'string', const: 'absolute' },
    value: { type: 'string' },
    start: { type: 'string', pattern: ISO_DATE_PATTERN },
    end: { type: 'string', pattern: ISO_DATE_PATTERN },
    ...sourceTextProperty,
  },
} as const;

const nonAbsolutePlanningWindowSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['localId', 'kind', 'value', 'start', 'end', 'sourceText'],
  properties: {
    localId: { type: 'string' },
    kind: {
      type: 'string',
      enum: ['relative_day', 'relative_week', 'named_period'],
    },
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

function buildProviderResponseFormatV5(): JsonSchemaResponseFormat {
  const format = structuredClone(
    WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5,
  ) as JsonSchemaResponseFormat;
  const root = record(format.json_schema.schema, 'schema');
  const rootProperties = record(root.properties, 'schema.properties');

  rootProperties.planningWindow = {
    anyOf: [
      absolutePlanningWindowSchema,
      nonAbsolutePlanningWindowSchema,
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

  return format;
}

/*
 * Provider-only representation overlay.
 *
 * The semantic TypeScript model intentionally remains broad enough to decode
 * historical/checkpoint data. New AI responses are stricter: an absolute
 * planning window must provide ISO-shaped start/end values and recurrence day
 * tokens must already use the canonical weekday:<english-day> vocabulary.
 * This keeps provider formatting rules in JSON Schema instead of repeating the
 * same rule in the semantic prompt and full-document repair prompt.
 */
export const WEEKLY_PLANNING_SEMANTIC_PROVIDER_RESPONSE_FORMAT_V5 =
  buildProviderResponseFormatV5();
