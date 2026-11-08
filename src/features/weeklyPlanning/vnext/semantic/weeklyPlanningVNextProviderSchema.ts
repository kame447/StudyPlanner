import { WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5 } from '../weeklyPlanningVNextV5Boundary';
import type { JsonSchemaResponseFormat } from '../../../../services/ai/openAiCompatibleClientTypes';
import { WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5 } from '../../semantic/weeklyPlanningSemanticSchemaV5';
import { SEMANTIC_CONSTRAINT_SOURCE_KINDS_V5 } from '../../semantic/weeklyPlanningSemanticTypesV5';
import { VNEXT_CONSTRAINT_SOURCE_REQUIREMENT } from './weeklyPlanningVNextCorrectionSchema';
import { VNEXT_PLANNING_YEAR_BASIS_SCHEMA } from './weeklyPlanningVNextCorrectionSchema';
export { VNEXT_CONSTRAINT_SOURCE_REQUIREMENT } from './weeklyPlanningVNextCorrectionSchema';
import { SEMANTIC_BASE_TEMPORAL_CONSTRAINT_KINDS_V5, SEMANTIC_COMPONENT_ROLES_V5,
  SEMANTIC_CONSTRAINT_LEVELS_V5, SEMANTIC_NAMED_TIME_PERIODS_V5, SEMANTIC_QUANTITY_ROLES_V5, SEMANTIC_TASK_CATEGORIES_V5,
  SEMANTIC_WORKLOAD_UNIT_CODES_V5, SEMANTIC_STUDY_PURPOSES_V5, SEMANTIC_STUDY_ACTIVITY_KINDS_V5 } from '../../semantic/weeklyPlanningSemanticTypesV5';
import { SEMANTIC_RECURRENCE_KINDS_V5, SEMANTIC_TASK_DATE_RULE_KINDS_V5, SEMANTIC_AVAILABILITY_KINDS_V5,
  SEMANTIC_AVAILABILITY_RECURRENCE_KINDS_V5 } from '../../semantic/weeklyPlanningSemanticTypesV5';
import type { VNextEventRegistrationAct, VNextPlanningRequestEvidence, WeeklyPlanningVNextInterpretedAnswer } from '../weeklyPlanningVNextInterpretationContract';
import type { VNextPlanningIntent, VNextTurnDelta, VNextTurnError } from '../weeklyPlanningVNextTypes';
import type { VNextTitleQuotation } from './weeklyPlanningVNextProviderLabelEvidence';
import { VNEXT_STUDY_RECORD_QUESTION_REASONS, type VNextStudyRecordQuestion, type VNextStudyRecordReading } from '../weeklyPlanningVNextStudyRecords';
import { VNEXT_CORRECTION_RESPONSE_FORMAT, VNEXT_STUDY_CONTEXT_REQUIREMENT, VNEXT_WORKLOAD_PERIOD_REQUIREMENT, VNEXT_PLANNING_WINDOW_KINDS, VNEXT_TASK_RELATION_KINDS, VNEXT_PLANNING_WINDOW_REQUIREMENT, VNEXT_RECURRENCE_REQUIREMENT, VNEXT_TASK_DATE_RULE_REQUIREMENT, VNEXT_AVAILABILITY_REQUIREMENT, VNEXT_TASK_RELATION_REQUIREMENT } from './weeklyPlanningVNextCorrectionSchema';

export { VNEXT_STUDY_CONTEXT_REQUIREMENT, VNEXT_WORKLOAD_PERIOD_REQUIREMENT, VNEXT_PLANNING_WINDOW_REQUIREMENT, VNEXT_RECURRENCE_REQUIREMENT, VNEXT_TASK_DATE_RULE_REQUIREMENT, VNEXT_AVAILABILITY_REQUIREMENT, VNEXT_TASK_RELATION_REQUIREMENT } from './weeklyPlanningVNextCorrectionSchema';

type Schema = { type?: string; properties?: Record<string, Schema>; required?: string[];
  additionalProperties?: boolean; enum?: readonly unknown[]; anyOf?: Schema[]; items?: Schema; description?: string };
// Pure construction reads shared vocabularies and creates only local data; do not add I/O or
// mutate shared inputs here. Export comparison and disabled-build module proof guard this boundary.
const {
  root, VNEXT_PLANNING_INTENT_REQUIREMENT, VNEXT_EVENT_REGISTRATION_REQUIREMENT, VNEXT_LEARNING_STRATEGY_ANSWER_REQUIREMENT, VNEXT_QUANTITY_ROLE_REQUIREMENT,
  VNEXT_WORKLOAD_UNIT_LABEL_REQUIREMENT, VNEXT_CONSTRAINT_LEVEL_REQUIREMENT, VNEXT_TEMPORAL_TARGET_REQUIREMENT,
  VNEXT_NAMED_TIME_PERIOD_REQUIREMENT, VNEXT_RELATE_REFERENCE_REQUIREMENT, VNEXT_DEFER_ALLOCATION_REQUIREMENT,
  VNEXT_ESTIMATE_ANSWER_REQUIREMENT, VNEXT_STUDY_RECORD_REQUIREMENT, VNEXT_PROVIDER_RESPONSE_FORMAT,
} = /*#__PURE__*/ (() => {
  const VNEXT_PLANNING_INTENT_REQUIREMENT = 'planningIntent uses the existing V5 meaning: create_plan for an explicit request to create a plan or preview, including a contextual acceptance of the actual request to create one; update_plan for a requested change to an existing plan or preview; discuss for stating facts or discussing the conditions without asking to create one; unknown when intent is not established. Complete facts, a quantity of work, or an answer to a machine question alone are not a new creation request. Recent conversation is language context only and never creates facts by itself. State intent, never permission: the application owns the authorization gate and retained permission.';
  const VNEXT_EVENT_REGISTRATION_REQUIREMENT = 'conversationActs is additive current-turn meaning, limited to decline_additional_work and request_event_registration. decline_additional_work follows V5: decline the optional invitation for additional work, never dismiss a required question, authorize planning, or save. It is read from what the user says (no more work to add) whichever question is presented, and the application alone decides what it closes. A presentedQuestion with an optionalInvitation field is that invitation: an answer saying there is no work to add (for example no other or no further work) or otherwise declining the offer is decline_additional_work with an empty delta, while naming work to do is ordinary delta facts and not a decline. Its targetRef is null unless the user explicitly names an existing task/component. Keep independent facts and simultaneous registration requests. request_event_registration: an explicit request to put a fixed event on the user calendar, including contextual acceptance. It requests a reviewable candidate, never save or study-plan permission. With neither act return []. targetRef is an existing task/component F alias as factId or a new task/component localId; null selects tasks stated or updated in this turn, never every historical task. Preserve selective targets and independent study work. A fixed time alone is busy information, not a registration request. When the user tells you a fixed time and says it need not be registered or put on the calendar (they only want planning to avoid it), that time is still busy: state it as an unavailable availability_declaration (hard) with its date and clock interval, with no task for it and no request_event_registration. An explicit registration request is a task with fixed_interval plus request_event_registration. Keep fixed_interval hard bounds at their stated times, never invent movable work or an estimate for registration.';
  const v5ActMeaning = WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5.find(rule => rule.id === 'conversation_act')!.instruction;
  const VNEXT_LEARNING_STRATEGY_ANSWER_REQUIREMENT = 'When presentedQuestion.code is learning_strategy_proposal, answer an explicit acceptance or rejection with kind proposal_decision, its exact proposal.id as proposalId, and decision accept or reject. The application owns the proposal and its effect; never add workloads or estimates to implement it. When a presented effort question has effortMeasurement session_duration, answer kind session_minutes with the stated minutes per sitting. This is not total time or a rate. Do not answer these questions with estimate_minutes or repeat their answer in delta. Independent facts still belong in delta.';
  const VNEXT_QUANTITY_ROLE_REQUIREMENT = 'remaining = an amount stated as what is left of a bounded whole, even when the user also intends to do it in this planning period; target = an amount intended for this planning period that is not stated as a remainder; scope_total = the whole size of a bounded task or material; completed = an amount already done. declared/unknown are only for a stated quantity whose role the words do not establish; they are not the default for an explicit planned amount. Roles are meanings, not calculations.';
  const VNEXT_WORKLOAD_UNIT_LABEL_REQUIREMENT = 'A workload unitLabel is a required non-empty unit word for its amount, even when unitCode is a standard code. Preserve the user-language unit wording (for example 分, 時間, ページ). It is never null or an empty string. This requirement is separate from nullable effort-estimate units.';
  const VNEXT_CONSTRAINT_LEVEL_REQUIREMENT = 'hard = a constraint that must be met, including a deadline or fixed commitment; soft = a preference; unknown = the words do not establish the level. Do not use unknown merely because a required deadline was not explicitly called hard.';
  const VNEXT_TEMPORAL_TARGET_REQUIREMENT = 'A temporal_constraint targetRef must name its task or a component in that same task, using a supplied fact alias or a new localId. It cannot target a workload, estimate or projected work.';
  const VNEXT_NAMED_TIME_PERIOD_REQUIREMENT = `namedTimePeriod is null when no named period within a day is stated; otherwise use one of ${SEMANTIC_NAMED_TIME_PERIODS_V5.join(', ')} or custom:<label> with a non-empty label for another named period. Calendar days, weeks and dates belong in dateExpression, never namedTimePeriod.`;
  const VNEXT_RELATE_REFERENCE_REQUIREMENT = 'relate a/b reference workload facts: an existing workload uses its supplied F alias in factId; a workload added in this delta uses its localId. For derived work use the F alias of its total workload fact (definingFactId). W aliases and workLineageId are not valid relation references; never put a W alias in localId.';
  const VNEXT_DEFER_ALLOCATION_REQUIREMENT = 'allocation none for an ordinary deferral. provisional_timebox only for a missing_effort_estimate or missing_schedulable_work question, when the user explicitly says the effort is unknown or must not become an estimate and explicitly asks to proceed by provisionally placing the work anyway. It is scheduler permission only: never an amount, estimate, completion or new fact, so add no workload or effort_estimate for it. A stated or approximate time is an estimate answer, not provisional_timebox.';
  const VNEXT_ESTIMATE_ANSWER_REQUIREMENT = 'A whole-work or per-unit estimate about the work in a presented missing_effort_estimate question answers that question regardless of its displayed wording, including a question phrased as total time. Use answer for that work, not a new workload or effort_estimate fact. Choose per whole_work or unit from what the user states; the question\'s wording does not require conversion to a total. This answer rule takes precedence over the time-only workload rule. whole_work = minutes for all of the asked work; unit = minutes for one unit in the unitCode/unitLabel shown in presentedQuestion.forWork. Return the stated minutes without multiplying or computing a total. The application binds that answer to the asked work and its quantity basis. Time already spent on completed work or time for another task is not an answer to this work question; represent it as an ordinary delta fact. State the asked work\'s estimate once in answer; do not repeat it in delta. An option answer already carries that option\'s change; do not restate it in delta. For an option answer, per is null.';
  const VNEXT_STUDY_RECORD_REQUIREMENT = 'studyRecords: only what the user says they actually studied (past or today), one entry per day and subject. dateExpression is the absolute date YYYY-MM-DD resolved from the clock, never future; subject as the user said it; minutes exactly as stated (hours converted), never estimated, split or computed. A rest day (a day the user did not study) is never an entry: put its absolute date in studyRestDays. A plan or intention is never a record (it belongs in delta). Restating a day and subject with other minutes is a correction: emit that same date and subject again. No clock times. If a part is unclear (vague minutes, a total over several days, no date, no subject), leave it out and set studyRecordQuestion to that one thing: reason missing_minutes, missing_date, missing_subject or split_needed, label in the user\'s words; clear entries are still emitted. When pendingStudyRecordQuestion is supplied and the user answers it, emit the completed entry.';
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
      value: { ...text, description: VNEXT_PLANNING_WINDOW_REQUIREMENT }, start: nullable(text), end: nullable(text),
      yearBasis: { ...VNEXT_PLANNING_YEAR_BASIS_SCHEMA, description: VNEXT_PLANNING_WINDOW_REQUIREMENT } }),
    object({ kind: enumeration(['uncertainty']), localId: text, targetRef: ref,
      field: enumeration(['planning_window']), reason: text }),
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
  const v5 = WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5.json_schema.schema as { properties: { planningIntent: Schema } };
  const root = object({ planningIntent: { ...v5.properties.planningIntent, description: VNEXT_PLANNING_INTENT_REQUIREMENT },
    planningRequestEvidence: { ...nullable(object({ quote: text, questionKey: text })),
      description: 'Only when answering presentedQuestion AND independently requesting a plan or preview of the current planning scope, set planningIntent create_plan and provide planningRequestEvidence: quote the exact independent request clause from current userText, with presentedQuestion.key (the supplied Q alias). Otherwise null, including a bare answer, a negated/withdrawn request, quoted or hypothetical requests, supplementalContext and past conversation. Evidence is turn-local meaning, not permission or save approval. Do not quote just the numeric answer or infer a request from complete facts.' },
    conversationActs: { ...array(object({ kind: enumeration(['request_event_registration', 'decline_additional_work']), targetRef: nullable(ref) })), description: `${VNEXT_EVENT_REGISTRATION_REQUIREMENT} V5 meaning (only the two supported kinds above are allowed here): ${v5ActMeaning}` },
    delta: object({ add: array(add), patch: correction.properties!.patch,
    remove: correction.properties!.remove,
    relate: array({ ...object({ kind: enumeration(['same', 'distinct']),
      a: { ...ref, description: VNEXT_RELATE_REFERENCE_REQUIREMENT }, b: { ...ref, description: VNEXT_RELATE_REFERENCE_REQUIREMENT } }),
      description: VNEXT_RELATE_REFERENCE_REQUIREMENT }),
    defer: array(object({ questionKey: text,
      allocation: { ...enumeration(['none', 'provisional_timebox']), description: VNEXT_DEFER_ALLOCATION_REQUIREMENT } })),
  }),
    studyRecords: { ...array(object({ dateExpression: text, subject: text, minutes: number })), description: VNEXT_STUDY_RECORD_REQUIREMENT },
    studyRestDays: { ...array(text), description: 'Absolute dates YYYY-MM-DD the user says were rest days or days without study (not in the future); no subject and no minutes. Empty when none.' },
    studyRecordQuestion: { ...nullable(object({ reason: enumeration(VNEXT_STUDY_RECORD_QUESTION_REASONS), label: nullable(text) })), description: 'The one unclear part of a study record (see studyRecords), or null.' },
    answer: { anyOf: [object({ kind: enumeration(['option', 'estimate_minutes']), optionId: nullable(text), minutes: nullable(number),
    per: { ...nullable(enumeration(['whole_work', 'unit'])), description: VNEXT_ESTIMATE_ANSWER_REQUIREMENT } }),
    object({ kind: enumeration(['proposal_decision']), proposalId: { ...text, description: VNEXT_LEARNING_STRATEGY_ANSWER_REQUIREMENT },
      decision: { ...enumeration(['accept', 'reject']), description: VNEXT_LEARNING_STRATEGY_ANSWER_REQUIREMENT } }),
    object({ kind: enumeration(['session_minutes']), minutes: { ...number, description: VNEXT_LEARNING_STRATEGY_ANSWER_REQUIREMENT } }), { type: 'null' }] } });

  const VNEXT_PROVIDER_RESPONSE_FORMAT: JsonSchemaResponseFormat = { type: 'json_schema',
    json_schema: { name: 'weekly_planning_vnext_native_v1', strict: true, schema: root as Record<string, unknown> } };
  return {
    root, VNEXT_PLANNING_INTENT_REQUIREMENT, VNEXT_EVENT_REGISTRATION_REQUIREMENT, VNEXT_LEARNING_STRATEGY_ANSWER_REQUIREMENT, VNEXT_QUANTITY_ROLE_REQUIREMENT,
    VNEXT_WORKLOAD_UNIT_LABEL_REQUIREMENT, VNEXT_CONSTRAINT_LEVEL_REQUIREMENT, VNEXT_TEMPORAL_TARGET_REQUIREMENT,
    VNEXT_NAMED_TIME_PERIOD_REQUIREMENT, VNEXT_RELATE_REFERENCE_REQUIREMENT, VNEXT_DEFER_ALLOCATION_REQUIREMENT,
    VNEXT_ESTIMATE_ANSWER_REQUIREMENT, VNEXT_STUDY_RECORD_REQUIREMENT, VNEXT_PROVIDER_RESPONSE_FORMAT,
  };
})();

export {
  VNEXT_PLANNING_INTENT_REQUIREMENT, VNEXT_EVENT_REGISTRATION_REQUIREMENT,
  VNEXT_LEARNING_STRATEGY_ANSWER_REQUIREMENT, VNEXT_QUANTITY_ROLE_REQUIREMENT, VNEXT_WORKLOAD_UNIT_LABEL_REQUIREMENT,
  VNEXT_CONSTRAINT_LEVEL_REQUIREMENT, VNEXT_TEMPORAL_TARGET_REQUIREMENT, VNEXT_NAMED_TIME_PERIOD_REQUIREMENT,
  VNEXT_RELATE_REFERENCE_REQUIREMENT, VNEXT_DEFER_ALLOCATION_REQUIREMENT, VNEXT_ESTIMATE_ANSWER_REQUIREMENT,
  VNEXT_STUDY_RECORD_REQUIREMENT, VNEXT_PROVIDER_RESPONSE_FORMAT,
};

/**
 * #977: the same requirement sentence sits on up to 8 fields (the wire schema was 41% repeats). Keep each
 * distinct description once, in document order, and leave structure untouched. Only the first-call wire
 * schema uses this; `root` keeps every description because describeVNextProviderField reads repair text from it.
 */
export function dedupeRepeatedSchemaDescriptions<T>(node: T, seen: Set<string> = new Set()): T {
  if (Array.isArray(node)) return node.map(item => dedupeRepeatedSchemaDescriptions(item, seen)) as T;
  if (node === null || typeof node !== 'object') return node;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'description' && typeof value === 'string') {
      if (seen.has(value)) continue;
      seen.add(value);
      copy[key] = value;
    } else copy[key] = dedupeRepeatedSchemaDescriptions(value, seen);
  }
  return copy as T;
}

/** What the native interpreter actually sends on its first call (and a non-label repair). */
export const VNEXT_PROVIDER_WIRE_RESPONSE_FORMAT: JsonSchemaResponseFormat = { ...VNEXT_PROVIDER_RESPONSE_FORMAT,
  json_schema: { ...VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema,
    schema: dedupeRepeatedSchemaDescriptions(VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema.schema) } };

export const VNEXT_LABEL_EVIDENCE_REQUIREMENT ='Preserve the source wording of task names and custom units; do not translate them. A free custom unitLabel must occur verbatim in the supplied user/context evidence or accepted labels; percentages keep their existing canonical % unit. For a paraphrased task title, labelEvidence names the current add/patch localId and quotes a non-empty naming fragment verbatim from that evidence which also occurs in the title. Keep legitimate generated activity wording around that name. Use [] when every task title is itself verbatim. Keep all independent clauses and registration acts. Quotations verify spelling, never authorize a new fact or action.';
const labelRepairRoot: Schema = { ...root,
  properties: { ...root.properties, labelEvidence: { type: 'array', description: VNEXT_LABEL_EVIDENCE_REQUIREMENT,
    items: { type: 'object', properties: { localId: { type: 'string' }, quote: { type: 'string' } },
      required: ['localId', 'quote'], additionalProperties: false } } },
  required: [...root.required!, 'labelEvidence'],
};
/** Only the existing semantic repair uses this extension; the first-call schema stays byte-identical. */
export const VNEXT_LABEL_REPAIR_RESPONSE_FORMAT: JsonSchemaResponseFormat = { type: 'json_schema',
  json_schema: { name: 'weekly_planning_vnext_label_repair_v1', strict: true, schema: labelRepairRoot as Record<string, unknown> } };

export interface VNextProviderReading {
  planningIntent: VNextPlanningIntent;
  planningRequestEvidence?: VNextPlanningRequestEvidence | null;
  conversationActs: VNextEventRegistrationAct[];
  delta: VNextTurnDelta;
  /** Repair-only, turn-local spelling proof; removed before returning the interpretation. */
  labelEvidence?: readonly VNextTitleQuotation[];
  /** Always set by the decoder; optional so readings built by plan-only callers stay valid. */
  studyRecords?: VNextStudyRecordReading[];
  studyRecordQuestion?: VNextStudyRecordQuestion | null;
  studyRestDays?: string[];
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
  if (path === 'labelEvidence') return VNEXT_LABEL_EVIDENCE_REQUIREMENT;
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

export function decodeVNextProviderOutput(value: unknown, allowLabelEvidence = false):
  | { status: 'decoded'; reading: VNextProviderReading }
  | { status: 'rejected'; errors: VNextTurnError[] } {
  // The model must state both study-record fields (strict schema); a reading recorded before they existed has
  // none, which means no records and no record question, so absence decodes as that rather than as an error.
  // Older readings also lack independent-request evidence; keep accepting them without granting the
  // answer-plus-request permission. Earlier readings lack year provenance. Preserve their data as unverified, never infer proof.
  const withBasis = (items: unknown, patch: boolean) => Array.isArray(items) ? items.map(item => {
    if (!record(item) || item.kind !== 'planning_window') return item;
    if (patch) return record(item.changes) ? { ...item, changes: { yearBasis: null, ...item.changes } } : item;
    return { yearBasis: null, ...item };
  }) : items;
  const complete = record(value) ? { studyRecords: [], studyRecordQuestion: null, studyRestDays: [], planningRequestEvidence: null, ...value,
    ...(record(value.delta) ? { delta: { ...value.delta, add: withBasis(value.delta.add, false), patch: withBasis(value.delta.patch, true) } } : {}),
  } : value;
  const errors = validate(allowLabelEvidence ? labelRepairRoot : root, complete, '', null);
  if (errors.length) return { status: 'rejected', errors };
  const wire = structuredClone(complete) as { planningIntent: VNextPlanningIntent; planningRequestEvidence: VNextPlanningRequestEvidence | null; conversationActs: VNextEventRegistrationAct[]; delta: VNextTurnDelta; labelEvidence?: VNextTitleQuotation[]; studyRecords: VNextStudyRecordReading[]; studyRecordQuestion: VNextStudyRecordQuestion | null; studyRestDays: string[]; answer: Record<string, unknown> | null };
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
  return { status: 'decoded', reading: { planningIntent: wire.planningIntent,
    ...(wire.planningRequestEvidence ? { planningRequestEvidence: wire.planningRequestEvidence } : {}),
    conversationActs: wire.conversationActs, delta: wire.delta,
    ...(allowLabelEvidence ? { labelEvidence: wire.labelEvidence } : {}),
    studyRecords: wire.studyRecords, studyRecordQuestion: wire.studyRecordQuestion, studyRestDays: wire.studyRestDays, answer } };
}
