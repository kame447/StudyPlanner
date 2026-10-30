import type { JsonSchemaResponseFormat } from '../../../../services/ai/openAiCompatibleClientTypes';
import { SEMANTIC_BASE_TEMPORAL_CONSTRAINT_KINDS_V5, SEMANTIC_COMPONENT_ROLES_V5,
  SEMANTIC_CONSTRAINT_LEVELS_V5, SEMANTIC_QUANTITY_ROLES_V5, SEMANTIC_TASK_CATEGORIES_V5,
  SEMANTIC_WORKLOAD_UNIT_CODES_V5 } from '../../semantic/weeklyPlanningSemanticTypesV5';
import type { WeeklyPlanningVNextInterpretedAnswer } from '../weeklyPlanningVNextInterpretationContract';
import type { VNextTurnDelta, VNextTurnError } from '../weeklyPlanningVNextTypes';
import { VNEXT_CORRECTION_RESPONSE_FORMAT } from './weeklyPlanningVNextCorrectionSchema';

type Schema = { type?: string; properties?: Record<string, Schema>; required?: string[];
  additionalProperties?: boolean; enum?: readonly unknown[]; anyOf?: Schema[]; items?: Schema; description?: string };
export const VNEXT_QUANTITY_ROLE_REQUIREMENT = 'target = an amount the user intends to do in this planning period; remaining = what is left of a bounded whole; scope_total = the whole size of a bounded task or material; completed = an amount already done. declared/unknown are only for a stated quantity whose role the words do not establish; they are not the default for an explicit planned amount. Roles are meanings, not calculations.';
export const VNEXT_WORKLOAD_UNIT_LABEL_REQUIREMENT = 'A workload unitLabel is a required non-empty unit word for its amount, even when unitCode is a standard code. Preserve the user-language unit wording (for example 分, 時間, ページ). It is never null or an empty string. This requirement is separate from nullable effort-estimate units.';
const text: Schema = { type: 'string' }, number: Schema = { type: 'number' };
const object = (properties: Record<string, Schema>): Schema => ({ type: 'object', properties,
  required: Object.keys(properties), additionalProperties: false });
const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: 'null' }] });
const enumeration = (values: readonly string[]): Schema => ({ type: 'string', enum: values });
const array = (items: Schema): Schema => ({ type: 'array', items });
const ref: Schema = { anyOf: [object({ factId: text }), object({ localId: text })] };
const effortRef: Schema = { anyOf: [...ref.anyOf!, object({ workLineageId: text })] };
const precision = enumeration(['exact', 'approximate', 'unspecified']);
const unit = enumeration(SEMANTIC_WORKLOAD_UNIT_CODES_V5);
const add: Schema = { anyOf: [
  object({ kind: enumeration(['task']), localId: text, category: enumeration(SEMANTIC_TASK_CATEGORIES_V5), title: text }),
  object({ kind: enumeration(['component']), localId: text, taskRef: ref, parentComponentRef: nullable(ref),
    role: enumeration(SEMANTIC_COMPONENT_ROLES_V5), label: text }),
  object({ kind: enumeration(['workload']), localId: text, taskRef: ref, componentRef: nullable(ref),
    quantityRole: { ...enumeration(SEMANTIC_QUANTITY_ROLES_V5), description: VNEXT_QUANTITY_ROLE_REQUIREMENT },
    amount: number, unitCode: unit, unitLabel: { ...text, description: VNEXT_WORKLOAD_UNIT_LABEL_REQUIREMENT },
    rangeStart: nullable(text), rangeEnd: nullable(text), perOccurrence: { type: 'boolean' }, periodExpression: nullable(text) }),
  object({ kind: enumeration(['effort_estimate']), localId: text, taskRef: ref, targetRef: effortRef,
    effortKind: enumeration(['total_duration', 'duration_per_unit', 'session_duration']), minutes: number,
    unitCode: nullable(unit), unitLabel: nullable(text), precision }),
  object({ kind: enumeration(['temporal_constraint']), localId: text, taskRef: ref, targetRef: ref,
    constraintKind: enumeration(SEMANTIC_BASE_TEMPORAL_CONSTRAINT_KINDS_V5),
    constraintLevel: enumeration(SEMANTIC_CONSTRAINT_LEVELS_V5), dateExpression: nullable(text),
    namedTimePeriod: nullable(text), startTime: nullable(text), endTime: nullable(text), precision }),
] };
const correction = VNEXT_CORRECTION_RESPONSE_FORMAT.json_schema.schema as Schema;
const root = object({ delta: object({ add: array(add), patch: correction.properties!.patch,
  remove: correction.properties!.remove,
  relate: array(object({ kind: enumeration(['same', 'distinct']), a: ref, b: ref })),
  defer: array(object({ questionKey: text })),
}), answer: nullable(object({ kind: enumeration(['option', 'estimate_minutes']), optionId: nullable(text), minutes: nullable(number) })) });

export const VNEXT_PROVIDER_RESPONSE_FORMAT: JsonSchemaResponseFormat = { type: 'json_schema',
  json_schema: { name: 'weekly_planning_vnext_native_v1', strict: true, schema: root as Record<string, unknown> } };

export interface VNextProviderReading {
  delta: VNextTurnDelta;
  answer: WeeklyPlanningVNextInterpretedAnswer | null;
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function matchingVariant(variants: Schema[], value: unknown): Schema | undefined {
  const kind = record(value) ? value.kind : undefined;
  return variants.find(variant => variant.properties?.kind?.enum?.includes(kind))
    ?? variants.find(variant => record(value)
      ? variant.properties && Object.keys(value).every(key => Object.prototype.hasOwnProperty.call(variant.properties, key))
      : variant.type === (value === null ? 'null' : typeof value));
}

/** Describe a typed field from the same schema sent to the provider; paths contain no natural-language inference. */
export function describeVNextProviderField(path: string, output: unknown): string | null {
  const normalized = /^(add|patch|remove|relate|defer)\[/.test(path) ? `delta.${path}` : path;
  const tokens = normalized.split(':')[0].match(/[A-Za-z_][A-Za-z0-9_]*|\d+/g) ?? [];
  let schema: Schema | undefined = root;
  let value: unknown = output;
  for (const token of tokens) {
    while (schema?.anyOf) schema = matchingVariant(schema.anyOf, value);
    if (!schema) return null;
    if (schema.type === 'array') {
      schema = schema.items;
      value = Array.isArray(value) ? value[Number(token)] : undefined;
    } else {
      schema = schema.properties?.[token];
      value = record(value) ? value[token] : undefined;
    }
  }
  return schema?.description ?? null;
}

/** Validator for this small schema vocabulary; the wire schema and decoder share one shape. */
function validate(schema: Schema, value: unknown, path: string, localId: string | null): VNextTurnError[] {
  const issue = (at = path): VNextTurnError[] => [{ code: 'invalid_value', path: at, localId, factId: null }];
  if (schema.anyOf) {
    const attempts = schema.anyOf.map(variant => ({ variant, errors: validate(variant, value, path, localId) }));
    if (attempts.some(attempt => !attempt.errors.length)) return [];
    // A discriminant or exact reference key identifies the variant; never reinterpret meaning.
    const selected = matchingVariant(schema.anyOf, value);
    return attempts.find(attempt => attempt.variant === selected)?.errors ?? issue();
  }
  if (schema.enum && !schema.enum.includes(value)) return issue();
  if (schema.type === 'null') return value === null ? [] : issue();
  if (schema.type === 'string') return typeof value === 'string' ? [] : issue();
  if (schema.type === 'number') return typeof value === 'number' && Number.isFinite(value) ? [] : issue();
  if (schema.type === 'boolean') return typeof value === 'boolean' ? [] : issue();
  if (schema.type === 'array') return Array.isArray(value)
    ? value.flatMap((item, index) => validate(schema.items!, item, `${path}[${index}]`, record(item) && typeof item.localId === 'string' ? item.localId : localId)) : issue();
  if (schema.type === 'object') {
    if (!record(value)) return issue();
    const errors: VNextTurnError[] = [];
    for (const key of Object.keys(value)) if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) errors.push(...issue(`${path}.${key}`));
    for (const key of schema.required!) {
      if (!(key in value)) errors.push(...issue(`${path}.${key}`));
      else errors.push(...validate(schema.properties![key], value[key], path ? `${path}.${key}` : key, localId));
    }
    return errors;
  }
  return issue();
}

export function decodeVNextProviderOutput(value: unknown):
  | { status: 'decoded'; reading: VNextProviderReading }
  | { status: 'rejected'; errors: VNextTurnError[] } {
  const errors = validate(root, value, '', null);
  if (errors.length) return { status: 'rejected', errors };
  const wire = structuredClone(value) as { delta: VNextTurnDelta; answer: {
    kind: 'option' | 'estimate_minutes'; optionId: string | null; minutes: number | null;
  } | null };
  let answer: WeeklyPlanningVNextInterpretedAnswer | null = null;
  if (wire.answer) {
    if (wire.answer.kind === 'option' && typeof wire.answer.optionId === 'string' && wire.answer.minutes === null) {
      answer = { kind: 'option', optionId: wire.answer.optionId };
    } else if (wire.answer.kind === 'estimate_minutes' && typeof wire.answer.minutes === 'number' && wire.answer.optionId === null) {
      answer = { kind: 'estimate_minutes', minutes: wire.answer.minutes };
    } else return { status: 'rejected', errors: [{ code: 'invalid_value', path: 'answer', localId: null, factId: null }] };
  }
  return { status: 'decoded', reading: { delta: wire.delta, answer } };
}
