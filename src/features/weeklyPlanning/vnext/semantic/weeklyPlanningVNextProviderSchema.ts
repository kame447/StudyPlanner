import type { JsonSchemaResponseFormat } from '../../../../services/ai/openAiCompatibleClientTypes';
import { SEMANTIC_CONSTRAINT_SOURCE_KINDS_V5 } from '../../semantic/weeklyPlanningSemanticTypesV5';
import { VNEXT_CONSTRAINT_SOURCE_REQUIREMENT } from './weeklyPlanningVNextCorrectionSchema';
export { VNEXT_CONSTRAINT_SOURCE_REQUIREMENT } from './weeklyPlanningVNextCorrectionSchema';
import { SEMANTIC_BASE_TEMPORAL_CONSTRAINT_KINDS_V5, SEMANTIC_COMPONENT_ROLES_V5,
  SEMANTIC_CONSTRAINT_LEVELS_V5, SEMANTIC_NAMED_TIME_PERIODS_V5, SEMANTIC_QUANTITY_ROLES_V5, SEMANTIC_TASK_CATEGORIES_V5,
  SEMANTIC_WORKLOAD_UNIT_CODES_V5, SEMANTIC_STUDY_PURPOSES_V5, SEMANTIC_STUDY_ACTIVITY_KINDS_V5 } from '../../semantic/weeklyPlanningSemanticTypesV5';
import { SEMANTIC_RECURRENCE_KINDS_V5, SEMANTIC_TASK_DATE_RULE_KINDS_V5, SEMANTIC_AVAILABILITY_KINDS_V5,
  SEMANTIC_AVAILABILITY_RECURRENCE_KINDS_V5 } from '../../semantic/weeklyPlanningSemanticTypesV5';
import type { WeeklyPlanningVNextInterpretedAnswer } from '../weeklyPlanningVNextInterpretationContract';
import type { VNextTurnDelta, VNextTurnError } from '../weeklyPlanningVNextTypes';
import { VNEXT_CORRECTION_RESPONSE_FORMAT, VNEXT_STUDY_CONTEXT_REQUIREMENT, VNEXT_WORKLOAD_PERIOD_REQUIREMENT, VNEXT_PLANNING_WINDOW_KINDS, VNEXT_TASK_RELATION_KINDS, VNEXT_PLANNING_WINDOW_REQUIREMENT, VNEXT_RECURRENCE_REQUIREMENT, VNEXT_TASK_DATE_RULE_REQUIREMENT, VNEXT_AVAILABILITY_REQUIREMENT, VNEXT_TASK_RELATION_REQUIREMENT } from './weeklyPlanningVNextCorrectionSchema';

export { VNEXT_STUDY_CONTEXT_REQUIREMENT, VNEXT_WORKLOAD_PERIOD_REQUIREMENT, VNEXT_PLANNING_WINDOW_REQUIREMENT, VNEXT_RECURRENCE_REQUIREMENT, VNEXT_TASK_DATE_RULE_REQUIREMENT, VNEXT_AVAILABILITY_REQUIREMENT, VNEXT_TASK_RELATION_REQUIREMENT } from './weeklyPlanningVNextCorrectionSchema';

type Schema = { type?: string; properties?: Record<string, Schema>; required?: string[];
  additionalProperties?: boolean; enum?: readonly unknown[]; anyOf?: Schema[]; items?: Schema; description?: string };
// Pure construction reads shared vocabularies and creates only local data; do not add I/O or
// mutate shared inputs here. Export comparison and disabled-build module proof guard this boundary.
const {
  root, VNEXT_LEARNING_STRATEGY_ANSWER_REQUIREMENT, VNEXT_QUANTITY_ROLE_REQUIREMENT,
  VNEXT_WORKLOAD_UNIT_LABEL_REQUIREMENT, VNEXT_CONSTRAINT_LEVEL_REQUIREMENT, VNEXT_TEMPORAL_TARGET_REQUIREMENT,
  VNEXT_NAMED_TIME_PERIOD_REQUIREMENT, VNEXT_RELATE_REFERENCE_REQUIREMENT, VNEXT_DEFER_ALLOCATION_REQUIREMENT,
  VNEXT_ESTIMATE_ANSWER_REQUIREMENT, VNEXT_PROVIDER_RESPONSE_FORMAT,
} = /*#__PURE__*/ (() => {
  const VNEXT_LEARNING_STRATEGY_ANSWER_REQUIREMENT = 'When presentedQuestion.code is learning_strategy_proposal, answer an explicit acceptance or rejection with kind proposal_decision, its exact proposal.id as proposalId, and decision accept or reject. The application owns the proposal and its effect; never add workloads or estimates to implement it. When a presented effort question has effortMeasurement session_duration, answer kind session_minutes with the stated minutes per sitting. This is not total time or a rate. Do not answer these questions with estimate_minutes or repeat their answer in delta. Independent facts still belong in delta.';
  const VNEXT_QUANTITY_ROLE_REQUIREMENT = 'remaining = an amount stated as what is left of a bounded whole, even when the user also intends to do it in this planning period; target = an amount intended for this planning period that is not stated as a remainder; scope_total = the whole size of a bounded task or material; completed = an amount already done. declared/unknown are only for a stated quantity whose role the words do not establish; they are not the default for an explicit planned amount. Roles are meanings, not calculations.';
  const VNEXT_WORKLOAD_UNIT_LABEL_REQUIREMENT = 'A workload unitLabel is a required non-empty unit word for its amount, even when unitCode is a standard code. Preserve the user-language unit wording (for example 分, 時間, ページ). It is never null or an empty string. This requirement is separate from nullable effort-estimate units.';
  const VNEXT_CONSTRAINT_LEVEL_REQUIREMENT = 'hard = a constraint that must be met, including a deadline or fixed commitment; soft = a preference; unknown = the words do not establish the level. Do not use unknown merely because a required deadline was not explicitly called hard.';
  const VNEXT_TEMPORAL_TARGET_REQUIREMENT = 'A temporal_constraint targetRef must name its task or a component in that same task, using a supplied fact alias or a new localId. It cannot target a workload, estimate or projected work.';
  const VNEXT_NAMED_TIME_PERIOD_REQUIREMENT = `namedTimePeriod is null when no named period within a day is stated; otherwise use one of ${SEMANTIC_NAMED_TIME_PERIODS_V5.join(', ')} or custom:<label> with a non-empty label for another named period. Calendar days, weeks and dates belong in dateExpression, never namedTimePeriod.`;
  const VNEXT_RELATE_REFERENCE_REQUIREMENT = 'relate a/b reference workload facts: an existing workload uses its supplied F alias in factId; a workload added in this delta uses its localId. For derived work use the F alias of its total workload fact (definingFactId). W aliases and workLineageId are not valid relation references; never put a W alias in localId.';
  const VNEXT_DEFER_ALLOCATION_REQUIREMENT = 'allocation none for an ordinary deferral. provisional_timebox only for a missing_effort_estimate or missing_schedulable_work question, when the user explicitly says the effort is unknown or must not become an estimate and explicitly asks to proceed by provisionally placing the work anyway. It is scheduler permission only: never an amount, estimate, completion or new fact, so add no workload or effort_estimate for it. A stated or approximate time is an estimate answer, not provisional_timebox.';
  const VNEXT_ESTIMATE_ANSWER_REQUIREMENT = 'A whole-work or per-unit estimate about the work in a presented missing_effort_estimate question answers that question regardless of its displayed wording, including a question phrased as total time. Use answer for that work, not a new workload or effort_estimate fact. Choose per whole_work or unit from what the user states; the question\'s wording does not require conversion to a total. This answer rule takes precedence over the time-only workload rule. whole_work = minutes for all of the asked work; unit = minutes for one unit in the unitCode/unitLabel shown in presentedQuestion.forWork. Return the stated minutes without multiplying or computing a total. The application binds that answer to the asked work and its quantity basis. Time already spent on completed work or time for another task is not an answer to this work question; represent it as an ordinary delta fact. State the asked work\'s estimate once in answer; do not repeat it in delta. An option answer already carries that option\'s change; do not restate it in delta. For an option answer, per is null.';
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
    object({ kind: enumeration(['study_context']), localId: text, taskRef: ref,
      purpose: { ...enumeration(SEMANTIC_STUDY_PURPOSES_V5), description: VNEXT_STUDY_CONTEXT_REQUIREMENT },
      contextLabel: { ...nullable(text), description: VNEXT_STUDY_CONTEXT_REQUIREMENT },
      activityKind: { ...enumeration(SEMANTIC_STUDY_ACTIVITY_KINDS_V5), description: VNEXT_STUDY_CONTEXT_REQUIREMENT } }),
    object({ kind: enumeration(['component']), localId: text, taskRef: ref, parentComponentRef: nullable(ref),
      role: enumeration(SEMANTIC_COMPONENT_ROLES_V5), label: text }),
    object({ kind: enumeration(['workload']), localId: text, taskRef: ref, componentRef: nullable(ref),
      quantityRole: { ...enumeration(SEMANTIC_QUANTITY_ROLES_V5), description: VNEXT_QUANTITY_ROLE_REQUIREMENT },
      amount: number, unitCode: unit, unitLabel: { ...text, description: VNEXT_WORKLOAD_UNIT_LABEL_REQUIREMENT },
      rangeStart: nullable(text), rangeEnd: nullable(text), perOccurrence: { type: 'boolean' },
      periodExpression: { ...nullable(text), description: VNEXT_WORKLOAD_PERIOD_REQUIREMENT } }),
    object({ kind: enumeration(['effort_estimate']), localId: text, taskRef: ref, targetRef: effortRef,
      effortKind: enumeration(['total_duration', 'duration_per_unit', 'session_duration']), minutes: number,
      unitCode: nullable(unit), unitLabel: nullable(text), precision }),
    object({ kind: enumeration(['temporal_constraint']), localId: text, taskRef: ref,
      targetRef: { ...ref, description: VNEXT_TEMPORAL_TARGET_REQUIREMENT },
      constraintKind: enumeration(SEMANTIC_BASE_TEMPORAL_CONSTRAINT_KINDS_V5),
      constraintLevel: { ...enumeration(SEMANTIC_CONSTRAINT_LEVELS_V5), description: VNEXT_CONSTRAINT_LEVEL_REQUIREMENT }, dateExpression: nullable(text),
      namedTimePeriod: { ...nullable(text), description: VNEXT_NAMED_TIME_PERIOD_REQUIREMENT },
      startTime: nullable(text), endTime: nullable(text), precision }),
    object({ kind: enumeration(['planning_window']), localId: text,
      windowKind: { ...enumeration(VNEXT_PLANNING_WINDOW_KINDS), description: VNEXT_PLANNING_WINDOW_REQUIREMENT },
      value: { ...text, description: VNEXT_PLANNING_WINDOW_REQUIREMENT }, start: nullable(text), end: nullable(text) }),
    object({ kind: enumeration(['recurrence']), localId: text, taskRef: ref, targetRef: ref,
      recurrenceKind: { ...enumeration(SEMANTIC_RECURRENCE_KINDS_V5), description: VNEXT_RECURRENCE_REQUIREMENT },
      count: { ...nullable(number), description: VNEXT_RECURRENCE_REQUIREMENT },
      days: { ...array(text), description: VNEXT_RECURRENCE_REQUIREMENT } }),
    object({ kind: enumeration(['task_date_rule']), localId: text, taskRef: ref, targetRef: ref,
      ruleKind: { ...enumeration(SEMANTIC_TASK_DATE_RULE_KINDS_V5), description: VNEXT_TASK_DATE_RULE_REQUIREMENT },
      dateExpression: { ...text, description: VNEXT_TASK_DATE_RULE_REQUIREMENT }, constraintLevel: enumeration(SEMANTIC_CONSTRAINT_LEVELS_V5) }),
    object({ kind: enumeration(['availability_declaration']), localId: text,
      availabilityKind: { ...enumeration(SEMANTIC_AVAILABILITY_KINDS_V5), description: VNEXT_AVAILABILITY_REQUIREMENT },
      dateExpression: nullable(text), namedTimePeriod: { ...nullable(text), description: VNEXT_NAMED_TIME_PERIOD_REQUIREMENT },
      startTime: nullable(text), endTime: nullable(text), recurrenceKind: nullable(enumeration(SEMANTIC_AVAILABILITY_RECURRENCE_KINDS_V5)),
      days: array(text), capacityMinutes: { ...nullable(number), description: VNEXT_AVAILABILITY_REQUIREMENT },
      constraintLevel: enumeration(SEMANTIC_CONSTRAINT_LEVELS_V5) }),
    object({ kind: enumeration(['relation']), localId: text,
      relationKind: { ...enumeration(VNEXT_TASK_RELATION_KINDS), description: VNEXT_TASK_RELATION_REQUIREMENT }, fromTaskRef: ref, toTaskRef: ref }),
    object({ kind: enumeration(['constraint_source_request']), localId: text,
      sourceKind: { ...enumeration(SEMANTIC_CONSTRAINT_SOURCE_KINDS_V5), description: VNEXT_CONSTRAINT_SOURCE_REQUIREMENT },
      selector: { ...enumeration(['active']), description: VNEXT_CONSTRAINT_SOURCE_REQUIREMENT },
      requestedAction: { ...enumeration(['use', 'stop_using']), description: VNEXT_CONSTRAINT_SOURCE_REQUIREMENT } }),
  ] };
  const correction = VNEXT_CORRECTION_RESPONSE_FORMAT.json_schema.schema as Schema;
  const root = object({ delta: object({ add: array(add), patch: correction.properties!.patch,
    remove: correction.properties!.remove,
    relate: array({ ...object({ kind: enumeration(['same', 'distinct']),
      a: { ...ref, description: VNEXT_RELATE_REFERENCE_REQUIREMENT }, b: { ...ref, description: VNEXT_RELATE_REFERENCE_REQUIREMENT } }),
      description: VNEXT_RELATE_REFERENCE_REQUIREMENT }),
    defer: array(object({ questionKey: text,
      allocation: { ...enumeration(['none', 'provisional_timebox']), description: VNEXT_DEFER_ALLOCATION_REQUIREMENT } })),
  }), answer: { anyOf: [object({ kind: enumeration(['option', 'estimate_minutes']), optionId: nullable(text), minutes: nullable(number),
    per: { ...nullable(enumeration(['whole_work', 'unit'])), description: VNEXT_ESTIMATE_ANSWER_REQUIREMENT } }),
    object({ kind: enumeration(['proposal_decision']), proposalId: { ...text, description: VNEXT_LEARNING_STRATEGY_ANSWER_REQUIREMENT },
      decision: { ...enumeration(['accept', 'reject']), description: VNEXT_LEARNING_STRATEGY_ANSWER_REQUIREMENT } }),
    object({ kind: enumeration(['session_minutes']), minutes: { ...number, description: VNEXT_LEARNING_STRATEGY_ANSWER_REQUIREMENT } }), { type: 'null' }] } });

  const VNEXT_PROVIDER_RESPONSE_FORMAT: JsonSchemaResponseFormat = { type: 'json_schema',
    json_schema: { name: 'weekly_planning_vnext_native_v1', strict: true, schema: root as Record<string, unknown> } };
  return {
    root, VNEXT_LEARNING_STRATEGY_ANSWER_REQUIREMENT, VNEXT_QUANTITY_ROLE_REQUIREMENT,
    VNEXT_WORKLOAD_UNIT_LABEL_REQUIREMENT, VNEXT_CONSTRAINT_LEVEL_REQUIREMENT, VNEXT_TEMPORAL_TARGET_REQUIREMENT,
    VNEXT_NAMED_TIME_PERIOD_REQUIREMENT, VNEXT_RELATE_REFERENCE_REQUIREMENT, VNEXT_DEFER_ALLOCATION_REQUIREMENT,
    VNEXT_ESTIMATE_ANSWER_REQUIREMENT, VNEXT_PROVIDER_RESPONSE_FORMAT,
  };
})();

export {
  VNEXT_LEARNING_STRATEGY_ANSWER_REQUIREMENT, VNEXT_QUANTITY_ROLE_REQUIREMENT, VNEXT_WORKLOAD_UNIT_LABEL_REQUIREMENT,
  VNEXT_CONSTRAINT_LEVEL_REQUIREMENT, VNEXT_TEMPORAL_TARGET_REQUIREMENT, VNEXT_NAMED_TIME_PERIOD_REQUIREMENT,
  VNEXT_RELATE_REFERENCE_REQUIREMENT, VNEXT_DEFER_ALLOCATION_REQUIREMENT, VNEXT_ESTIMATE_ANSWER_REQUIREMENT,
  VNEXT_PROVIDER_RESPONSE_FORMAT,
};

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
  const wire = structuredClone(value) as { delta: VNextTurnDelta; answer: Record<string, unknown> | null };
  let answer: WeeklyPlanningVNextInterpretedAnswer | null = null;
  if (wire.answer) {
    if (wire.answer.kind === 'proposal_decision' && typeof wire.answer.proposalId === 'string'
      && (wire.answer.decision === 'accept' || wire.answer.decision === 'reject')) {
      answer = { kind: 'proposal_decision', proposalId: wire.answer.proposalId, decision: wire.answer.decision };
    } else if (wire.answer.kind === 'session_minutes' && typeof wire.answer.minutes === 'number') {
      answer = { kind: 'session_minutes', minutes: wire.answer.minutes };
    } else if (wire.answer.kind === 'option' && typeof wire.answer.optionId === 'string' && wire.answer.minutes === null && wire.answer.per === null) {
      answer = { kind: 'option', optionId: wire.answer.optionId };
    } else if (wire.answer.kind === 'estimate_minutes' && typeof wire.answer.minutes === 'number' && wire.answer.optionId === null
      && (wire.answer.per === 'whole_work' || wire.answer.per === 'unit')) {
      answer = { kind: 'estimate_minutes', minutes: wire.answer.minutes, per: wire.answer.per };
    } else return { status: 'rejected', errors: [{ code: 'invalid_value', path: 'answer', localId: null, factId: null }] };
  }
  return { status: 'decoded', reading: { delta: wire.delta, answer } };
}
