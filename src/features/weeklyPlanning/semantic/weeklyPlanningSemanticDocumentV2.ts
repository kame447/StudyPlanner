import type { JsonSchemaResponseFormat } from '../../../services/ai/openAiCompatibleClient';
import {
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT,
  createWeeklyPlanningSemanticSystemPrompt,
  createWeeklyPlanningSemanticUserPrompt,
  type SemanticCorrection,
  type SemanticDecision,
  type SemanticTask,
  type SemanticTemporalConstraint,
  type WeeklyPlanningSemanticDocument,
} from './weeklyPlanningSemanticDocument';

export const WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V2 =
  'weekly-planning-semantic-v5-alpha2' as const;

export const SEMANTIC_CONSTRAINT_LEVELS = ['hard', 'soft', 'unknown'] as const;
export type SemanticConstraintLevel = (typeof SEMANTIC_CONSTRAINT_LEVELS)[number];

export const SEMANTIC_AVAILABILITY_KINDS = [
  'available',
  'unavailable',
  'preferred',
  'avoided',
] as const;
export type SemanticAvailabilityKind = (typeof SEMANTIC_AVAILABILITY_KINDS)[number];

export const SEMANTIC_AVAILABILITY_RECURRENCE_KINDS = [
  'daily',
  'weekly',
  'weekdays',
  'weekends',
  'custom',
] as const;
export type SemanticAvailabilityRecurrenceKind =
  (typeof SEMANTIC_AVAILABILITY_RECURRENCE_KINDS)[number];

export const SEMANTIC_CONSTRAINT_SOURCE_KINDS = [
  'timetable',
  'existing_plans',
  'calendar',
] as const;
export type SemanticConstraintSourceKind =
  (typeof SEMANTIC_CONSTRAINT_SOURCE_KINDS)[number];

export const SEMANTIC_NAMED_TIME_PERIODS = [
  'morning',
  'afternoon',
  'evening',
  'night',
  'before_sleep',
  'before_meal',
  'after_meal',
] as const;
export type SemanticNamedTimePeriod =
  | (typeof SEMANTIC_NAMED_TIME_PERIODS)[number]
  | `custom:${string}`;

export interface SemanticTemporalConstraintV2
  extends Omit<SemanticTemporalConstraint, 'constraintLevel'> {
  constraintLevel: SemanticConstraintLevel;
  namedTimePeriod: SemanticNamedTimePeriod | null;
}

export interface SemanticTaskV2 extends Omit<SemanticTask, 'temporalConstraints'> {
  temporalConstraints: SemanticTemporalConstraintV2[];
}

export interface SemanticAvailabilityDeclaration {
  localId: string;
  kind: SemanticAvailabilityKind;
  dateExpression: string | null;
  namedTimePeriod: SemanticNamedTimePeriod | null;
  startTime: string | null;
  endTime: string | null;
  recurrenceKind: SemanticAvailabilityRecurrenceKind | null;
  days: string[];
  constraintLevel: SemanticConstraintLevel;
  sourceText: string;
}

export interface SemanticConstraintSourceRequest {
  localId: string;
  kind: SemanticConstraintSourceKind;
  selector: 'active';
  requestedAction: 'use' | 'stop_using';
  sourceText: string;
}

export interface WeeklyPlanningSemanticDocumentV2
  extends Omit<
    WeeklyPlanningSemanticDocument,
    'schemaVersion' | 'tasks' | 'corrections' | 'decisions'
  > {
  schemaVersion: typeof WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V2;
  tasks: SemanticTaskV2[];
  availabilityDeclarations: SemanticAvailabilityDeclaration[];
  constraintSourceRequests: SemanticConstraintSourceRequest[];
  corrections: SemanticCorrection[];
  decisions: SemanticDecision[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(
  value: unknown,
  path: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Semantic alpha2 schema base changed at ${path}.`);
  }
  return value;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Semantic alpha2 schema base changed at ${path}.`);
  }
  return value;
}

function cloneBaseSchema(): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT.json_schema.schema),
  ) as Record<string, unknown>;
}

const nullableNamedTimePeriodSchema = {
  anyOf: [
    { type: 'string', enum: SEMANTIC_NAMED_TIME_PERIODS },
    { type: 'string', pattern: '^custom:.+$' },
    { type: 'null' },
  ],
} as const;

function createAlpha2Schema(): Record<string, unknown> {
  const root = cloneBaseSchema();
  const rootProperties = requireRecord(root.properties, 'root.properties');
  const rootRequired = requireArray(root.required, 'root.required');

  const schemaVersion = requireRecord(
    rootProperties.schemaVersion,
    'root.properties.schemaVersion',
  );
  schemaVersion.const = WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V2;

  const tasks = requireRecord(rootProperties.tasks, 'root.properties.tasks');
  const taskItems = requireRecord(tasks.items, 'tasks.items');
  const taskProperties = requireRecord(taskItems.properties, 'tasks.items.properties');
  const temporalConstraints = requireRecord(
    taskProperties.temporalConstraints,
    'tasks.items.properties.temporalConstraints',
  );
  const temporalItems = requireRecord(
    temporalConstraints.items,
    'temporalConstraints.items',
  );
  const temporalProperties = requireRecord(
    temporalItems.properties,
    'temporalConstraints.items.properties',
  );
  const temporalRequired = requireArray(
    temporalItems.required,
    'temporalConstraints.items.required',
  );
  if (!temporalRequired.includes('constraintLevel')) {
    temporalRequired.splice(3, 0, 'constraintLevel');
  }
  if (!temporalRequired.includes('namedTimePeriod')) {
    temporalRequired.splice(5, 0, 'namedTimePeriod');
  }
  temporalProperties.constraintLevel = {
    type: 'string',
    enum: SEMANTIC_CONSTRAINT_LEVELS,
  };
  temporalProperties.namedTimePeriod = nullableNamedTimePeriodSchema;

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
      kind: { type: 'string', enum: SEMANTIC_AVAILABILITY_KINDS },
      dateExpression: { type: ['string', 'null'] },
      namedTimePeriod: nullableNamedTimePeriodSchema,
      startTime: { type: ['string', 'null'] },
      endTime: { type: ['string', 'null'] },
      recurrenceKind: {
        anyOf: [
          { type: 'string', enum: SEMANTIC_AVAILABILITY_RECURRENCE_KINDS },
          { type: 'null' },
        ],
      },
      days: { type: 'array', items: { type: 'string' } },
      constraintLevel: { type: 'string', enum: SEMANTIC_CONSTRAINT_LEVELS },
      sourceText: { type: 'string' },
    },
  } as const;

  const sourceRequestSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['localId', 'kind', 'selector', 'requestedAction', 'sourceText'],
    properties: {
      localId: { type: 'string' },
      kind: { type: 'string', enum: SEMANTIC_CONSTRAINT_SOURCE_KINDS },
      selector: { type: 'string', enum: ['active'] },
      requestedAction: { type: 'string', enum: ['use', 'stop_using'] },
      sourceText: { type: 'string' },
    },
  } as const;

  if (!rootRequired.includes('availabilityDeclarations')) {
    rootRequired.push('availabilityDeclarations');
  }
  if (!rootRequired.includes('constraintSourceRequests')) {
    rootRequired.push('constraintSourceRequests');
  }
  rootProperties.availabilityDeclarations = {
    type: 'array',
    items: availabilityDeclarationSchema,
  };
  rootProperties.constraintSourceRequests = {
    type: 'array',
    items: sourceRequestSchema,
  };

  return root;
}

export const WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V2: JsonSchemaResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'weekly_planning_semantic_document_v5_alpha2',
    strict: true,
    schema: createAlpha2Schema(),
  },
};

export function createWeeklyPlanningSemanticSystemPromptV2(): string {
  return [
    createWeeklyPlanningSemanticSystemPrompt(),
    'Every temporal constraint must include constraintLevel hard, soft, or unknown and namedTimePeriod.',
    'Use hard only when the user clearly states an immovable, mandatory, unavailable, or deadline constraint. Use soft for preferences such as できれば, やりやすい, 週末にまとめたい, or 避けたい. Use unknown when the strength is not established.',
    'A task-specific time belongs in that task temporalConstraints. A plan-wide statement with no task target, such as 平日は18時まで勉強できない or 土日の午前中がやりやすい, belongs in availabilityDeclarations.',
    'Use dateExpression only for today, tomorrow, day_after_tomorrow, this_week, next_week, an explicit YYYY-MM-DD date, or custom:<original phrase>. Never put a Japanese time-of-day phrase in dateExpression.',
    'Use namedTimePeriod morning, afternoon, evening, night, before_sleep, before_meal, after_meal, or custom:<original phrase> for a named time period. Use null when exact startTime/endTime are supplied or no named time period exists.',
    'For 寝る前に英単語, attach namedTimePeriod before_sleep to the English-word task or component. For 土日の午前中がやりやすい, create a plan-wide preferred availability declaration with recurrenceKind weekends and namedTimePeriod morning.',
    'availabilityDeclarations describe only user-stated available, unavailable, preferred, or avoided windows. Keep relative dates symbolic and do not calculate concrete dates.',
    'Use recurrenceKind weekdays, weekends, daily, weekly, or custom only when the availability statement itself repeats. Keep days empty when no explicit weekday list is present.',
    'External timetable, existing plan, and calendar contents are authoritative application data. Never reproduce, summarize, or invent their events.',
    'Create a constraintSourceRequest only when the user explicitly asks to use or stop using timetable, existing plans, or calendar. selector must be active.',
    'For an ambiguous phrase such as 予定を見て when the source is not uniquely grounded by public context, return an uncertainty targeting document field constraintSource instead of choosing a source.',
    'Assign globally unique response-local IDs to every availability declaration and constraint source request as well.',
    'Return empty availabilityDeclarations and constraintSourceRequests arrays when none are explicitly present.',
  ].join('\n');
}

export function createWeeklyPlanningSemanticUserPromptV2(params: {
  userText: string;
  recentConversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  publicStateSummary?: Record<string, unknown>;
}): string {
  return createWeeklyPlanningSemanticUserPrompt(params);
}
