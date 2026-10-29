import type { JsonSchemaResponseFormat } from '../../../../services/ai/openAiCompatibleClientTypes';
import {
  SEMANTIC_BASE_TEMPORAL_CONSTRAINT_KINDS_V5, SEMANTIC_COMPONENT_ROLES_V5,
  SEMANTIC_CONSTRAINT_LEVELS_V5, SEMANTIC_QUANTITY_ROLES_V5,
  SEMANTIC_TASK_CATEGORIES_V5, SEMANTIC_WORKLOAD_UNIT_CODES_V5,
} from '../../semantic/weeklyPlanningSemanticTypesV5';
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

/** Only the five currently executable patch kinds are sent to a provider. */
const changesByKind = {
  task: { category: enumeration(SEMANTIC_TASK_CATEGORIES_V5), title: text },
  component: { role: enumeration(SEMANTIC_COMPONENT_ROLES_V5), label: text },
  workload: { amount: number, unitCode: unit, unitLabel: text,
    quantityRole: enumeration(SEMANTIC_QUANTITY_ROLES_V5), rangeStart: text, rangeEnd: text,
    perOccurrence: boolean, periodExpression: text },
  effort_estimate: { minutes: number, effortKind: enumeration(['total_duration', 'duration_per_unit', 'session_duration']),
    unitCode: unit, unitLabel: text, precision },
  temporal_constraint: { constraintKind: enumeration(SEMANTIC_BASE_TEMPORAL_CONSTRAINT_KINDS_V5),
    constraintLevel: enumeration(SEMANTIC_CONSTRAINT_LEVELS_V5), dateExpression: text,
    namedTimePeriod: nullable({ type: 'string' }, isWeeklyPlanningNamedTimePeriodV5),
    startTime: text, endTime: text, precision },
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
