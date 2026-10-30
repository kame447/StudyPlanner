import type { JsonSchemaResponseFormat } from '../../../../services/ai/openAiCompatibleClientTypes';
import {
  SEMANTIC_BASE_TEMPORAL_CONSTRAINT_KINDS_V5, SEMANTIC_COMPONENT_ROLES_V5,
  SEMANTIC_CONSTRAINT_LEVELS_V5, SEMANTIC_QUANTITY_ROLES_V5,
  SEMANTIC_TASK_CATEGORIES_V5, SEMANTIC_WORKLOAD_UNIT_CODES_V5,
  SEMANTIC_RECURRENCE_KINDS_V5, SEMANTIC_TASK_DATE_RULE_KINDS_V5,
  SEMANTIC_AVAILABILITY_KINDS_V5, SEMANTIC_AVAILABILITY_RECURRENCE_KINDS_V5,
  SEMANTIC_STUDY_PURPOSES_V5, SEMANTIC_STUDY_ACTIVITY_KINDS_V5,
} from '../../semantic/weeklyPlanningSemanticTypesV5';
import { CANONICAL_WEEKDAY_DATE_EXPRESSIONS } from '../../semantic/weeklyPlanningCalendarResolver';
import { WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5 } from '../../semantic/weeklyPlanningSemanticSchemaV5';
import { isWeeklyPlanningNamedTimePeriodV5 } from '../../semantic/weeklyPlanningTemporalValueValidatorV5';
import type { VNextPatch, VNextRemove, VNextTurnError } from '../weeklyPlanningVNextTypes';

interface FieldRule {
  schema: Record<string, unknown>;
  accepts: (value: unknown) => boolean;
}
const nullable = (schema: Record<string, unknown>, accepts: FieldRule['accepts']): FieldRule => ({
  schema: { anyOf: [schema, { type: 'null' }] }, accepts: value => value === null || accepts(value),
});
const text = nullable({ type: 'string' }, value => typeof value === 'string');
const number = nullable({ type: 'number' }, value => typeof value === 'number' && Number.isFinite(value));
const boolean = nullable({ type: 'boolean' }, value => typeof value === 'boolean');
const enumeration = (values: readonly string[]) => nullable({ type: 'string', enum: [...values] },
  value => typeof value === 'string' && values.includes(value));
const precision = enumeration(['exact', 'approximate', 'unspecified']);
const unit = enumeration(SEMANTIC_WORKLOAD_UNIT_CODES_V5);
const strings = nullable({ type: 'array', items: { type: 'string' } },
  value => Array.isArray(value) && value.every(item => typeof item === 'string'));

// These two vocabularies already live in V5's provider schema. Reuse their
// fragments instead of creating another literal list or semantic parser.
const v5 = WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5.json_schema.schema as {
  properties: {
    planningWindow: { anyOf: { properties: { kind: { enum: readonly string[] } } }[] };
    relations: { items: { properties: { kind: { enum: readonly string[] } } } };
  };
};
export const VNEXT_PLANNING_WINDOW_KINDS = v5.properties.planningWindow.anyOf[0].properties.kind.enum;
export const VNEXT_TASK_RELATION_KINDS = v5.properties.relations.items.properties.kind.enum;

export const VNEXT_STUDY_CONTEXT_REQUIREMENT = `study_context records the user's stated study meaning for taskRef. purpose uses ${SEMANTIC_STUDY_PURPOSES_V5.join(', ')}; activityKind uses ${SEMANTIC_STUDY_ACTIVITY_KINDS_V5.join(', ')}. memorization_retrieval means the user intends to memorize or retrieve learned items; use the other activity kinds when the stated activity has that meaning, and unknown when it is not stated. A title, contextLabel or quantity unit alone does not establish the activity: never infer memorization from them. contextLabel is a stated descriptive label or null. This fact states activity, not a learned pace or permission for a calibration/learning-strategy proposal.`;
export const VNEXT_WORKLOAD_PERIOD_REQUIREMENT = 'periodExpression is the measurement interval or frequency that defines the stated amount (for example per day, per week, or an explicitly period-scoped target). It is part of the quantity basis, not a history timestamp or deadline. When reporting progress on an accepted whole, keep that whole\'s period basis, null when unscoped, unless the user explicitly changes what the amount measures. When work was completed or is due does not create a new quantity period. Keep historical timing as source evidence; use temporal facts for stated scheduling constraints, and do not invent a completion-date fact. Preserve genuinely stated daily, weekly or other measurement scopes.';
export const VNEXT_PLANNING_WINDOW_REQUIREMENT = `planning_window uses windowKind ${VNEXT_PLANNING_WINDOW_KINDS.join(', ')}. For an absolute window state start/end; for a relative or named window state its canonical date value and null start/end. Code freezes its range when accepted. A patch stating a new value changes the effective window; do not copy old bounds into that correction.`;
export const VNEXT_RECURRENCE_REQUIREMENT = `recurrenceKind is ${SEMANTIC_RECURRENCE_KINDS_V5.join(', ')}; count is positive for times_per_week, otherwise null unless stated. days uses canonical weekday tokens (${CANONICAL_WEEKDAY_DATE_EXPRESSIONS.join(', ')}); use [] when no specific weekdays were stated. One occurrence's amount belongs in a workload with perOccurrence true, plus this recurrence fact targeting that workload's task or component in the same task. The target is never a workload fact; V5 pairs the perOccurrence workload with its task/component owner. Never emit multiplied or expanded occurrence workloads.`;
export const VNEXT_TASK_DATE_RULE_REQUIREMENT = `task_date_rule uses ruleKind ${SEMANTIC_TASK_DATE_RULE_KINDS_V5.join(', ')} and a hard constraintLevel. targetRef must name the same task as taskRef (not a workload or component). dateExpression is required. Keep weekday tokens symbolic; the existing scheduler applies every matching day inside the planning horizon.`;
export const VNEXT_AVAILABILITY_REQUIREMENT = `availability_declaration has no task reference. availabilityKind is ${SEMANTIC_AVAILABILITY_KINDS_V5.join(', ')}; recurrenceKind is null or ${SEMANTIC_AVAILABILITY_RECURRENCE_KINDS_V5.join(', ')}. State the date, named period, clocks or recurrence that scopes it. capacityMinutes is positive only for capacity; no_additional_constraint has no positive clocks/period/recurrence/days/capacity. Resolution status is assigned by code.`;
export const VNEXT_TASK_RELATION_REQUIREMENT = `relation orders tasks using relationKind ${VNEXT_TASK_RELATION_KINDS.join(', ')} and fromTaskRef/toTaskRef. It is separate from relate, which decides whether two workloads are the same or distinct.`;

const described = (rule: FieldRule, description: string): FieldRule => ({ ...rule, schema: { ...rule.schema, description } });

/** The same field owner supplies standalone corrections and native provider patches. */
const changesByKind = {
  task: { category: enumeration(SEMANTIC_TASK_CATEGORIES_V5), title: text },
  study_context: { purpose: described(enumeration(SEMANTIC_STUDY_PURPOSES_V5), VNEXT_STUDY_CONTEXT_REQUIREMENT),
    contextLabel: described(text, VNEXT_STUDY_CONTEXT_REQUIREMENT), activityKind: described(enumeration(SEMANTIC_STUDY_ACTIVITY_KINDS_V5), VNEXT_STUDY_CONTEXT_REQUIREMENT) },
  component: { role: enumeration(SEMANTIC_COMPONENT_ROLES_V5), label: text },
  workload: { amount: number, unitCode: unit, unitLabel: text,
    quantityRole: enumeration(SEMANTIC_QUANTITY_ROLES_V5), rangeStart: text, rangeEnd: text,
    perOccurrence: boolean, periodExpression: described(text, VNEXT_WORKLOAD_PERIOD_REQUIREMENT) },
  effort_estimate: { minutes: number, effortKind: enumeration(['total_duration', 'duration_per_unit', 'session_duration']),
    unitCode: unit, unitLabel: text, precision },
  temporal_constraint: { constraintKind: enumeration(SEMANTIC_BASE_TEMPORAL_CONSTRAINT_KINDS_V5),
    constraintLevel: enumeration(SEMANTIC_CONSTRAINT_LEVELS_V5), dateExpression: text,
    namedTimePeriod: nullable({ type: 'string' }, isWeeklyPlanningNamedTimePeriodV5),
    startTime: text, endTime: text, precision },
  planning_window: { windowKind: described(enumeration(VNEXT_PLANNING_WINDOW_KINDS), VNEXT_PLANNING_WINDOW_REQUIREMENT),
    value: described(text, VNEXT_PLANNING_WINDOW_REQUIREMENT), start: described(text, VNEXT_PLANNING_WINDOW_REQUIREMENT), end: described(text, VNEXT_PLANNING_WINDOW_REQUIREMENT) },
  recurrence: { recurrenceKind: described(enumeration(SEMANTIC_RECURRENCE_KINDS_V5), VNEXT_RECURRENCE_REQUIREMENT),
    count: described(number, VNEXT_RECURRENCE_REQUIREMENT), days: described(strings, VNEXT_RECURRENCE_REQUIREMENT) },
  task_date_rule: { ruleKind: described(enumeration(SEMANTIC_TASK_DATE_RULE_KINDS_V5), VNEXT_TASK_DATE_RULE_REQUIREMENT),
    dateExpression: described(text, VNEXT_TASK_DATE_RULE_REQUIREMENT), constraintLevel: described(enumeration(SEMANTIC_CONSTRAINT_LEVELS_V5), VNEXT_TASK_DATE_RULE_REQUIREMENT) },
  availability_declaration: { availabilityKind: described(enumeration(SEMANTIC_AVAILABILITY_KINDS_V5), VNEXT_AVAILABILITY_REQUIREMENT), dateExpression: text,
    namedTimePeriod: nullable({ type: 'string' }, isWeeklyPlanningNamedTimePeriodV5), startTime: text, endTime: text,
    recurrenceKind: described(enumeration(SEMANTIC_AVAILABILITY_RECURRENCE_KINDS_V5), VNEXT_AVAILABILITY_REQUIREMENT),
    days: described(strings, VNEXT_AVAILABILITY_REQUIREMENT), capacityMinutes: described(number, VNEXT_AVAILABILITY_REQUIREMENT),
    constraintLevel: enumeration(SEMANTIC_CONSTRAINT_LEVELS_V5) },
  relation: { relationKind: described(enumeration(VNEXT_TASK_RELATION_KINDS), VNEXT_TASK_RELATION_REQUIREMENT) },
} satisfies Record<VNextPatch['kind'], Record<string, FieldRule>>;

function objectSchema(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: 'object', additionalProperties: false, required: Object.keys(properties), properties };
}
const stringSchema = { type: 'string' };
const correctionSchema = objectSchema({
  patch: { type: 'array', items: { anyOf: Object.entries(changesByKind).map(([kind, rules]) => objectSchema({
    kind: { type: 'string', enum: [kind] }, localId: stringSchema, targetFactId: stringSchema,
    changes: objectSchema(Object.fromEntries(Object.entries(rules).map(([key, rule]) => [key, rule.schema]))),
    ...(kind === 'workload' ? { amountDelta: number.schema } : {}),
  })) } },
  remove: { type: 'array', items: objectSchema({ targetFactId: stringSchema }) },
});

/** Experimental fragment only: no provider call, prompt, production route or persisted schema change. */
export const VNEXT_CORRECTION_RESPONSE_FORMAT: JsonSchemaResponseFormat = {
  type: 'json_schema', json_schema: { name: 'weekly_planning_vnext_corrections_v1', strict: true, schema: correctionSchema },
};

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object'
  && value !== null && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** Parse untrusted provider JSON before it reaches the typed transaction. Null always means unchanged. */
export function parseVNextCorrections(value: unknown):
  | { status: 'accepted'; patch: VNextPatch[]; remove: VNextRemove[] }
  | { status: 'rejected'; errors: VNextTurnError[] } {
  const errors: VNextTurnError[] = [];
  const error = (path: string, localId: string | null = null) => errors.push({ code: 'invalid_value' as const,
    path, localId, factId: null });
  const keys = (item: Record<string, unknown>, expected: string[], path: string, localId: string | null) => {
    for (const key of Object.keys(item)) if (!expected.includes(key)) error(`${path}${path ? '.' : ''}${key}`, localId);
    for (const key of expected) if (!(key in item)) error(`${path}${path ? '.' : ''}${key}`, localId);
  };
  if (!record(value)) return { status: 'rejected', errors: [{ code: 'invalid_value', path: 'document', localId: null, factId: null }] };
  keys(value, ['patch', 'remove'], '', null);
  if (!Array.isArray(value.patch)) error('patch');
  else value.patch.forEach((item: unknown, index: number) => {
    const path = `patch[${index}]`;
    if (!record(item)) { error(path); return; }
    const localId = nonempty(item.localId) ? item.localId : null;
    if (!localId) error(`${path}.localId`);
    if (!nonempty(item.targetFactId)) error(`${path}.targetFactId`, localId);
    if (typeof item.kind !== 'string' || !Object.prototype.hasOwnProperty.call(changesByKind, item.kind)) { error(`${path}.kind`, localId); return; }
    const kind = item.kind as VNextPatch['kind'];
    keys(item, ['kind', 'localId', 'targetFactId', 'changes', ...(kind === 'workload' ? ['amountDelta'] : [])], path, localId);
    const rules: Record<string, FieldRule> = changesByKind[kind];
    if (!record(item.changes)) { error(`${path}.changes`, localId); return; }
    keys(item.changes, Object.keys(rules), `${path}.changes`, localId);
    for (const [key, rule] of Object.entries(rules)) if (!rule.accepts(item.changes[key])) error(`${path}.changes.${key}`, localId);
    if (kind === 'workload' && !number.accepts(item.amountDelta)) error(`${path}.amountDelta`, localId);
  });
  if (!Array.isArray(value.remove)) error('remove');
  else value.remove.forEach((item: unknown, index: number) => {
    const path = `remove[${index}]`;
    if (!record(item)) { error(path); return; }
    keys(item, ['targetFactId'], path, null);
    if (!nonempty(item.targetFactId)) error(`${path}.targetFactId`);
  });
  if (errors.length) return { status: 'rejected', errors };
  // Schema structure is checked above; payload invariants/references are checked after merging in the transaction.
  const parsed = structuredClone(value) as unknown as { patch: VNextPatch[]; remove: VNextRemove[] };
  return { status: 'accepted', ...parsed };
}
