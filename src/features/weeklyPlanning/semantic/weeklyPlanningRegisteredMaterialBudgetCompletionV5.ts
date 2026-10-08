import type { JsonSchemaResponseFormat } from '../../../services/ai/openAiCompatibleClient';
import { normalizeWeeklyPlanningEvidenceTextV5 } from './weeklyPlanningCurrentTurnProvenanceV5';
import { WEEKLY_PLANNING_MAX_SAFE_NUMERIC_VALUE_V5 } from './weeklyPlanningNumericSafetyV5';
import { filterActiveWeeklyPlanningFactsV5 } from './weeklyPlanningFactLifecycleV5';
import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import type { SemanticTaskV5, WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticTypesV5';
import { conversationArchitecturePolicy } from '../weeklyPlanningConversationArchitecture';
import { validateWeeklyPlanningSemanticResponseV5, type WeeklyPlanningSemanticResponseValidationInputV5 } from './weeklyPlanningSemanticResponseValidationV5';

export interface RegisteredMaterialTimeBudgetV5 {
  kind: 'registered_material_timebox';
  omissionIndex: number;
  materialLabel: string;
  amount: number;
  unitCode: 'minute' | 'hour';
  valueText: string;
  /** Derived from the typed amount/unit, never recovered by scanning user language. */
  minutes: number;
  precision: 'exact' | 'approximate' | 'unspecified';
  sourceText: string;
}

export interface RegisteredMaterialBudgetCompletionV5 {
  timeBudgets: RegisteredMaterialTimeBudgetV5[];
  otherMissingFactIndexes: number[];
}

export interface RegisteredMaterialBudgetCompletionTraceV5 {
  omissionIndex: number;
  materialLabel: string;
  sourceText: string;
  valueText: string;
  outcome: 'added' | 'dropped';
  reason: 'audit_authored' | 'invalid_evidence' | 'ambiguous_material' | 'conflicting_complements'
    | 'precedence' | 'reread_already_supplied' | 'accepted_graph_duplicate' | 'span_overlap'
    | 'validation' | 'unsupported_intent' | 'legacy';
  taskLocalId?: string;
  effortLocalId?: string;
}

export interface RegisteredMaterialBudgetCompletionResultV5 {
  document: WeeklyPlanningSemanticDocumentV5;
  acceptedOmissionIndexes: number[];
  decisions: RegisteredMaterialBudgetCompletionTraceV5[];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(record) : [];
}

function materialLabels(material: Record<string, unknown>): string[] {
  return [material.name, material.catalogTitle, ...(Array.isArray(material.aliases) ? material.aliases : [])]
    .filter((label): label is string => typeof label === 'string'
      && normalizeWeeklyPlanningEvidenceTextV5(label).length > 0);
}

/** This is the already owner-scoped application summary, never a global material lookup. */
export function registeredMaterialBudgetAuditLabelsV5(state?: Record<string, unknown>): string[] {
  const materials = records(state?.registeredMaterials);
  return [...new Set(materials.flatMap(materialLabels))]
    .filter(label => materials.filter(material => materialLabels(material).includes(label)).length === 1);
}

export const REGISTERED_MATERIAL_BUDGET_AUDIT_INSTRUCTION_V5 = [
  'In addition to coverage, interpret explicit omitted study-time tasks for the supplied registeredMaterialLabels.',
  'A registered_material_timebox is a NEW current-turn study task with its own stated TOTAL time budget, not a per-session duration, pace, available capacity, past activity, quoted example, or existing content workload cost.',
  'Copy an exact unique registered label and one literal current-user sourceText containing that label and the stated time request. Return its typed amount, minute/hour unit, precision, and literal numeric valueText within that sourceText. Never infer a budget from saved progress or pace.',
  'Do not propose a material already represented by a task/component in candidateDocument or acceptedTasks. Never edit, relabel, replace, split, or add material components/progress.',
  'For incomplete, number missingFacts from zero. Each missingFacts entry must describe one omission and be assigned exactly once: either a timeBudgets omissionIndex, or otherMissingFactIndexes. Put ALL other omitted meaning in otherMissingFactIndexes, including omitted timing attached to a time task.',
  'For complete, timeBudgets and otherMissingFactIndexes must both be empty.',
].join('\n');

/** The caller selects this only for interaction_v1; the legacy format is left intact. */
export function registeredMaterialBudgetAuditFormatV5(base: JsonSchemaResponseFormat): JsonSchemaResponseFormat {
  const schema = base.json_schema.schema;
  return { ...base, json_schema: { ...base.json_schema, schema: {
    ...schema,
    required: [...(Array.isArray(schema.required) ? schema.required : []), 'timeBudgets', 'otherMissingFactIndexes'],
    properties: {
      ...(record(schema.properties) ? schema.properties : {}),
      timeBudgets: { type: 'array', maxItems: 12, items: {
        type: 'object', additionalProperties: false,
        required: ['kind', 'omissionIndex', 'materialLabel', 'amount', 'unitCode', 'valueText', 'precision', 'sourceText'],
        properties: {
          kind: { type: 'string', enum: ['registered_material_timebox'] },
          omissionIndex: { type: 'integer', minimum: 0, maximum: 11 },
          materialLabel: { type: 'string', minLength: 1, maxLength: 240 },
          amount: { type: 'number', minimum: 0, maximum: WEEKLY_PLANNING_MAX_SAFE_NUMERIC_VALUE_V5 },
          unitCode: { type: 'string', enum: ['minute', 'hour'] },
          valueText: { type: 'string', minLength: 1, maxLength: 40 },
          precision: { type: 'string', enum: ['exact', 'approximate', 'unspecified'] },
          sourceText: { type: 'string', minLength: 1, maxLength: 4000 },
        },
      } },
      otherMissingFactIndexes: { type: 'array', maxItems: 12, items: { type: 'integer', minimum: 0, maximum: 11 } },
    },
  } } };
}

/** Strict typed accounting; free-form missingFacts never becomes semantic input here. */
export function parseRegisteredMaterialBudgetCompletionV5(
  rawResponse: string, missingFactCount: number,
): RegisteredMaterialBudgetCompletionV5 | null {
  try {
    const value: unknown = JSON.parse(rawResponse);
    if (!record(value) || value.decision !== 'incomplete'
      || !Array.isArray(value.missingFacts) || value.missingFacts.length !== missingFactCount
      || !Number.isInteger(missingFactCount) || missingFactCount < 1 || missingFactCount > 12
      || !Array.isArray(value.timeBudgets) || value.timeBudgets.length > 12
      || !Array.isArray(value.otherMissingFactIndexes) || value.otherMissingFactIndexes.length > 12) return null;
    const validIndex = (index: unknown): index is number => typeof index === 'number'
      && Number.isInteger(index) && index >= 0 && index < missingFactCount;
    const timeBudgets: RegisteredMaterialTimeBudgetV5[] = [];
    for (const budget of value.timeBudgets) {
      if (!record(budget) || Object.keys(budget).some(key => !['kind', 'omissionIndex', 'materialLabel', 'amount', 'unitCode', 'valueText', 'precision', 'sourceText'].includes(key))
        || budget.kind !== 'registered_material_timebox' || !validIndex(budget.omissionIndex)
        || typeof budget.materialLabel !== 'string' || budget.materialLabel.length > 240
        || !normalizeWeeklyPlanningEvidenceTextV5(budget.materialLabel)
        || typeof budget.sourceText !== 'string' || budget.sourceText.length > 4000
        || !normalizeWeeklyPlanningEvidenceTextV5(budget.sourceText)
        || typedBudgetMinutes(budget) === null
        || !['exact', 'approximate', 'unspecified'].includes(String(budget.precision))) return null;
      timeBudgets.push({ ...budget, minutes: typedBudgetMinutes(budget)! } as unknown as RegisteredMaterialTimeBudgetV5);
    }
    if (!value.otherMissingFactIndexes.every(validIndex)) return null;
    const indexes = [...timeBudgets.map(budget => budget.omissionIndex), ...value.otherMissingFactIndexes];
    if (indexes.length !== missingFactCount || new Set(indexes).size !== missingFactCount) return null;
    return { timeBudgets, otherMissingFactIndexes: value.otherMissingFactIndexes };
  } catch {
    return null;
  }
}

function typedBudgetMinutes(budget: Record<string, unknown>): number | null {
  if (typeof budget.amount !== 'number' || !Number.isFinite(budget.amount) || budget.amount <= 0
    || (budget.unitCode !== 'minute' && budget.unitCode !== 'hour')
    || typeof budget.valueText !== 'string' || budget.valueText.length > 40 || !normalizeWeeklyPlanningEvidenceTextV5(budget.valueText)
    || typeof budget.sourceText !== 'string' || !budget.sourceText.includes(budget.valueText)
    || Number(budget.valueText.normalize('NFKC')) !== budget.amount) return null;
  // Validate the AI-cited numeric span; never find or classify a duration in user language.
  const numericCharacter = (value: string) => value.length > 0
    && Array.from(value.normalize('NFKC')).every(character => '0123456789.+-'.includes(character));
  let cited = false;
  for (let start = budget.sourceText.indexOf(budget.valueText); start >= 0;
    start = budget.sourceText.indexOf(budget.valueText, start + 1)) {
    if (!numericCharacter(budget.sourceText[start - 1] ?? '')
      && !numericCharacter(budget.sourceText[start + budget.valueText.length] ?? '')) { cited = true; break; }
  }
  if (!cited) return null;
  const minutes = budget.amount * (budget.unitCode === 'hour' ? 60 : 1);
  return Number.isSafeInteger(minutes) && minutes > 0 ? minutes : null;
}

/** Literal evidence spans only; no label similarity or language interpretation. */
function sourceSpansOverlap(userText: string, left: string, right: string): boolean {
  if (!normalizeWeeklyPlanningEvidenceTextV5(left) || !normalizeWeeklyPlanningEvidenceTextV5(right)) return false;
  let start = userText.indexOf(left);
  let other = userText.indexOf(right);
  while (start >= 0 && other >= 0) {
    if (start < other + right.length && other < start + left.length) return true;
    if (start + left.length <= other) start = userText.indexOf(left, start + 1);
    else other = userText.indexOf(right, other + 1);
  }
  return false;
}

function represented(material: Record<string, unknown>, task: Record<string, unknown>): boolean {
  const labels = materialLabels(material);
  if (task.existingPublicId === material.materialId || labels.includes(String(task.title ?? ''))) return true;
  const study = record(task.study) ? task.study : null;
  return records(study?.components).some(component => component.role === 'material'
    && (component.existingPublicId === material.materialId || labels.includes(String(component.label ?? ''))));
}

function localIds(value: unknown, result = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach(entry => localIds(entry, result));
  else if (record(value)) {
    if (typeof value.localId === 'string') result.add(value.localId);
    Object.values(value).forEach(entry => localIds(entry, result));
  }
  return result;
}

export function addRegisteredMaterialBudgetCompletionV5(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  completion: RegisteredMaterialBudgetCompletionV5;
  currentUserText: string;
  publicStateSummary?: Record<string, unknown>;
  committedGraph?: WeeklyPlanningFactGraphV5;
  phase?: 'initial' | 'reread' | 'repair';
}): RegisteredMaterialBudgetCompletionResultV5 {
  const { document, completion, currentUserText, publicStateSummary: state, committedGraph: graph } = params;
  if (document.planningIntent !== 'create_plan' && document.planningIntent !== 'update_plan') {
    return { document, acceptedOmissionIndexes: [], decisions: completion.timeBudgets.map(budget => ({
      omissionIndex: budget.omissionIndex, materialLabel: budget.materialLabel, sourceText: budget.sourceText,
      valueText: budget.valueText, outcome: 'dropped', reason: 'unsupported_intent',
    })) };
  }
  const materials = records(state?.registeredMaterials);
  const targets = completion.timeBudgets.map(budget => materials
    .filter(material => typeof material.materialId === 'string' && material.materialId.length > 0
      && materialLabels(material).includes(budget.materialLabel)));
  const tasks: SemanticTaskV5[] = [];
  const acceptedOmissionIndexes: number[] = [];
  const decisions: RegisteredMaterialBudgetCompletionTraceV5[] = [];
  const ids = localIds(document);
  const uniqueId = (prefix: string): string => {
    let value = prefix;
    for (let suffix = 1; ids.has(value); suffix += 1) value = `${prefix}-${suffix}`;
    ids.add(value);
    return value;
  };
  completion.timeBudgets.forEach((budget, index) => {
    const trace: RegisteredMaterialBudgetCompletionTraceV5 = {
      omissionIndex: budget.omissionIndex, materialLabel: budget.materialLabel, sourceText: budget.sourceText,
      valueText: budget.valueText, outcome: 'dropped', reason: 'invalid_evidence',
    };
    decisions.push(trace);
    const target = targets[index];
    if (target.length !== 1) { trace.reason = 'ambiguous_material'; return; }
    if (!currentUserText.includes(budget.materialLabel)
      || !currentUserText.includes(budget.sourceText) || !budget.sourceText.includes(budget.materialLabel)
      || !normalizeWeeklyPlanningEvidenceTextV5(budget.sourceText)
      || !normalizeWeeklyPlanningEvidenceTextV5(budget.materialLabel)
      || typedBudgetMinutes(budget as unknown as Record<string, unknown>) !== budget.minutes) return;
    const material = target[0];
    if (materials.filter(entry => entry.materialId === material.materialId).length !== 1) { trace.reason = 'ambiguous_material'; return; }
    if (targets.filter(matches => matches.length === 1 && matches[0].materialId === material.materialId).length !== 1) {
      trace.reason = 'conflicting_complements'; return;
    }
    if (document.tasks.some(task => represented(material, task as unknown as Record<string, unknown>))) {
      trace.reason = params.phase === 'reread' ? 'reread_already_supplied' : 'precedence'; return;
    }
    if (document.tasks.some(task => sourceSpansOverlap(currentUserText, budget.sourceText, task.sourceText))) {
      trace.reason = 'span_overlap'; return;
    }
    if (records(state?.tasks).some(task => represented(material, task))
      || records(state?.components).some(component => component.role === 'material'
        && (component.materialId === material.materialId || materialLabels(material).includes(String(component.label ?? ''))))
      || (graph && (filterActiveWeeklyPlanningFactsV5(graph, graph.tasks).some(task => materialLabels(material).includes(task.title))
        || filterActiveWeeklyPlanningFactsV5(graph, graph.components).some(component => component.role === 'material'
          && materialLabels(material).includes(component.label))))) { trace.reason = 'accepted_graph_duplicate'; return; }
    const id = uniqueId(`registered-budget-task-${budget.omissionIndex}`);
    const effortId = uniqueId(`registered-budget-effort-${budget.omissionIndex}`);
    tasks.push({
      localId: id, existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title: budget.materialLabel,
      study: { purpose: 'unknown', activityKind: 'unknown', contextLabel: null, components: [] },
      workloads: [], effortEstimates: [{
        localId: effortId, targetLocalId: id,
        kind: 'total_duration', minutes: budget.minutes, unitCode: null, precision: budget.precision, sourceText: budget.sourceText,
      }], temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: budget.sourceText,
    });
    acceptedOmissionIndexes.push(budget.omissionIndex);
    Object.assign(trace, { outcome: 'added', reason: 'audit_authored', taskLocalId: id, effortLocalId: effortId });
  });
  return { document: tasks.length ? { ...document, tasks: [...document.tasks, ...tasks] } : document, acceptedOmissionIndexes, decisions };
}

/** Validation failure discards additions; this function never invokes an AI repair. */
export function applyValidatedRegisteredMaterialBudgetCompletionV5(params: {
  document: WeeklyPlanningSemanticDocumentV5;
  completion: RegisteredMaterialBudgetCompletionV5;
  input: WeeklyPlanningSemanticResponseValidationInputV5;
  phase?: 'initial' | 'reread' | 'repair';
}): RegisteredMaterialBudgetCompletionResultV5 {
  if (!conversationArchitecturePolicy(params.input.conversationArchitecture).semanticConversationActs) {
    return { document: params.document, acceptedOmissionIndexes: [], decisions: [] };
  }
  const result = addRegisteredMaterialBudgetCompletionV5({
    document: params.document, completion: params.completion, phase: params.phase,
    currentUserText: params.input.currentUserText ?? '', publicStateSummary: params.input.publicStateSummary,
    committedGraph: params.input.committedGraph,
  });
  if (result.document === params.document) return result;
  const validated = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(result.document), params.input);
  return validated.document ? { ...result, document: validated.document } : {
    document: params.document, acceptedOmissionIndexes: [],
    decisions: result.decisions.map(decision => decision.outcome === 'added'
      ? { ...decision, outcome: 'dropped', reason: 'validation' } : decision),
  };
}

export function registeredMaterialBudgetAccountsForAllOmissionsV5(
  completion: RegisteredMaterialBudgetCompletionV5, acceptedOmissionIndexes: readonly number[],
): boolean {
  return completion.otherMissingFactIndexes.length === 0 && completion.timeBudgets.length > 0
    && completion.timeBudgets.every(budget => acceptedOmissionIndexes.includes(budget.omissionIndex));
}
