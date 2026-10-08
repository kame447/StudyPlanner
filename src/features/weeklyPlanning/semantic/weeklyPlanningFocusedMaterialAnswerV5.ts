import type { ChatMessage, JsonSchemaResponseFormat } from '../../../services/ai/openAiCompatibleClient';
import { conversationArchitecturePolicy } from '../weeklyPlanningConversationArchitecture';
import { recordWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import { isWeeklyPlanningFactActiveV5 } from './weeklyPlanningFactLifecycleV5';
import type { PlanningTaskFactV5, StudyComponentFactV5, WorkloadFactV5 } from './weeklyPlanningFactGraphV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import type { WeeklyPlanningSemanticNormalizerInputV5, WeeklyPlanningSemanticNormalizerResultV5 } from './weeklyPlanningSemanticNormalizerContractsV5';
import { semanticNormalizerByteLength, semanticNormalizerErrorMessage, type WeeklyPlanningSemanticNormalizerRunV5 } from './weeklyPlanningSemanticNormalizerRunV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';
import { normalizeWeeklyPlanningEvidenceTextV5, weeklyPlanningLabelEvidencedBySourceV5 } from './weeklyPlanningCurrentTurnProvenanceV5';
import { measureWeeklyPlanningSemanticEvidenceCoverageV5, boundedEffortEvidenceV5 } from './weeklyPlanningSemanticEvidenceCoverageV5';
import { markWeeklyPlanningSemanticRepairConsumedV5, weeklyPlanningSemanticRepairConsumedV5 } from './weeklyPlanningSemanticRepairLedgerV5';

const SCHEMA_NAME = 'weekly_planning_focused_material_answer_v5';
const ANSWER_FIELDS = ['decision', 'label', 'registeredChoice', 'workloadChoice', 'effortKind', 'minutes', 'precision', 'sourceText', 'effortSourceText'];
/** Per-run repair consumption checked at each subsequent repair dispatch boundary. */
export const focusedMaterialRepairConsumedV5 = weeklyPlanningSemanticRepairConsumedV5;

/** Exact typed idempotency only: retain the accepted estimate's identity and source. */
function withoutRedundantFocusedRate(run: WeeklyPlanningSemanticNormalizerRunV5,
  parsed: WeeklyPlanningSemanticDocumentV5, validated: WeeklyPlanningSemanticDocumentV5): WeeklyPlanningSemanticDocumentV5 {
  const estimate = parsed.tasks[0]?.effortEstimates[0];
  const graph = run.input.committedGraph;
  if (!estimate || !graph) return validated;
  const existing = graph.effortEstimates.filter((fact) => isWeeklyPlanningFactActiveV5(graph, fact.id)
    && fact.targetFactId === estimate.targetLocalId && fact.kind === estimate.kind);
  const prior = existing[0];
  if (existing.length !== 1 || prior.taskId !== parsed.tasks[0].existingPublicId
    || prior.kind !== estimate.kind || prior.minutes !== estimate.minutes
    || prior.unitCode !== estimate.unitCode || prior.precision !== estimate.precision) return validated;
  return { ...validated, tasks: [{ ...validated.tasks[0], effortEstimates: [] }] };
}
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const records = (value: unknown) => Array.isArray(value) ? value.map(record).filter((item): item is Record<string, unknown> => item !== null) : [];

export interface FocusedMaterialContextV5 {
  task: PlanningTaskFactV5;
  component: StudyComponentFactV5 | null;
  pendingNeedId: string | null;
  pendingNeedField: string | null;
  questionPresented: boolean;
  workloads: Array<{ choice: string; fact: WorkloadFactV5 }>;
  materials: Array<{ choice: string; materialId: string; name: string; aliases: string[] }>;
}

/** Only authoritative state selects a target; the model owns whether the utterance answers it. */
export function focusedMaterialContextV5(input: WeeklyPlanningSemanticNormalizerInputV5): FocusedMaterialContextV5 | null {
  if (!conversationArchitecturePolicy(input.conversationArchitecture).semanticConversationActs || input.supplementalContext?.trim() || !input.committedGraph) return null;
  const graph = input.committedGraph;
  const active = (id: string) => isWeeklyPlanningFactActiveV5(graph, id);
  const pending = record(input.publicStateSummary?.pendingQuestion);
  let pendingNeedId: string | null = null;
  let pendingNeedField: string | null = null;
  let task: PlanningTaskFactV5 | undefined;
  let component: StudyComponentFactV5 | undefined;
  {
    if (pending && (pending.questionCode !== 'semantic_uncertainty' || pending.graphRevision !== graph.revision)) return null;
    // These are typed field identifiers from the live semantic documents, not language routing.
    const needs = graph.uncertainties.filter((fact) => active(fact.id) && ['material_identity', 'material'].includes(fact.field));
    const need = pending ? needs.find((fact) => fact.id === pending.targetFactId) : needs.length === 1 ? needs[0] : undefined;
    if (!need) return null;
    pendingNeedId = need.id;
    pendingNeedField = need.field;
    component = graph.components.find((fact) => active(fact.id) && fact.id === need.targetFactId && fact.role === 'material');
    task = graph.tasks.find((fact) => active(fact.id) && fact.id === (component?.taskId ?? need.targetFactId));
  }
  if (!task || task.category !== 'study' || (!pending && graph.tasks.filter((fact) => active(fact.id)).length !== 1)) return null;
  // A task-level new constituent also affects structure. Leave multi-need task
  // answers to the general interpreter instead of retiring another dimension.
  if (!component && graph.uncertainties.some((need) => active(need.id) && need.id !== pendingNeedId && need.targetFactId === task!.id)) return null;
  const materials = graph.components.filter((fact) => active(fact.id) && fact.taskId === task!.id && fact.role === 'material');
  if (!component) {
    if (materials.length > 1) return null;
    component = materials[0];
  }
  return { task, component: component ?? null, pendingNeedId, pendingNeedField, questionPresented: pending !== null,
    workloads: graph.workloads.filter((fact) => active(fact.id) && fact.taskId === task!.id && fact.quantityRole === 'target' && !['minute', 'hour'].includes(fact.unitCode)
      && (!component || fact.componentId === component.id || (fact.componentId === null && materials.length <= 1))).map((fact, index) => ({ choice: `w${index + 1}`, fact })),
    materials: records(input.publicStateSummary?.registeredMaterials).filter((entry) => typeof entry.materialId === 'string' && typeof entry.name === 'string')
      .slice(0, 32).map((entry, index) => ({ choice: `m${index + 1}`, materialId: String(entry.materialId), name: String(entry.name),
        aliases: Array.isArray(entry.aliases) ? entry.aliases.filter((alias): alias is string => typeof alias === 'string') : [] })),
  };
}

export function focusedMaterialResponseFormatV5(context: FocusedMaterialContextV5): JsonSchemaResponseFormat {
  const nullableChoice = (choices: string[]) => ({ anyOf: [...(choices.length ? [{ type: 'string', enum: choices }] : []), { type: 'null' }] });
  return { type: 'json_schema', json_schema: { name: SCHEMA_NAME, strict: true, schema: {
    type: 'object', additionalProperties: false, required: ANSWER_FIELDS, properties: {
      decision: { type: 'string', enum: ['material_answer', 'effort_answer', 'material_and_effort_answer', 'explain_question', 'fallback'] },
      label: { type: ['string', 'null'] }, registeredChoice: nullableChoice(context.materials.map((entry) => entry.choice)),
      workloadChoice: nullableChoice(context.workloads.map((entry) => entry.choice)),
      effortKind: { anyOf: [{ type: 'string', const: 'duration_per_unit' }, { type: 'null' }] },
      minutes: { anyOf: [{ type: 'number', exclusiveMinimum: 0 }, { type: 'null' }] },
      precision: { anyOf: [{ type: 'string', enum: ['exact', 'approximate', 'unspecified'] }, { type: 'null' }] },
      sourceText: { type: ['string', 'null'] },
      effortSourceText: { type: ['string', 'null'] },
    },
  } } };
}

export function createFocusedMaterialMessagesV5(input: WeeklyPlanningSemanticNormalizerInputV5, context: FocusedMaterialContextV5): ChatMessage[] {
  return [{ role: 'system', content: [
    'Interpret only currentUserText in this exact accepted material context. Return the focused answer schema, not task/component shells or a general semantic document.',
    'A fragment identifying the material for the accepted task answers the open material need even when phrased as a clarification. Do not treat it as topic_shift merely because its question is not currently presented.',
    'Use the literal material label supported by the current utterance; never append an unmentioned edition or subject. registeredChoice is optional, never a Fact Graph id: supply it only when label EXACTLY matches the listed name or alias. Otherwise use that literal label with registeredChoice=null; do not expand an abbreviation into a catalogue name.',
    'For a per-unit pace about a listed workload, return effort_answer and its workloadChoice. minutes is the time for ONE stated unit, never multiplied by quantity. This answers effort only and leaves any material question unresolved.',
    'For a pure explanation request about the pending question return explain_question; it does not create or change planning facts.',
    'Return fallback for ambiguity, an unrelated topic, totals/session budgets, approval/save, or any answer mixed with independent planning/advice meaning. General interpretation must retain all of that meaning.',
    'material_answer: label/sourceText are non-empty, registeredChoice may be null, all effort fields and effortSourceText are null. effort_answer: label/registeredChoice/effortSourceText are null; workloadChoice, effortKind, minutes, precision and sourceText are required.',
    'material_and_effort_answer captures BOTH a material and a per-unit pace for the same accepted task in one response. All material and effort fields are required; sourceText cites the material and effortSourceText separately cites the pace. Never choose only one half of such a reply.',
    'explain_question: sourceText cites the current explanation request and all other payload fields are null. fallback: every payload field is null. Every non-fallback answer cites all current meaning it interprets; uncited independent meaning requires fallback.',
    'sourceText must be a literal current-user fragment. No facts are established by stored conversation or catalogue wording alone.',
  ].join('\n') }, { role: 'user', content: JSON.stringify({ currentUserText: input.userText,
    pendingQuestion: context.questionPresented ? { questionCode: 'semantic_uncertainty', field: context.pendingNeedField, target: 'current_material' } : null,
    openMaterialNeed: context.pendingNeedId ? { field: context.pendingNeedField, target: 'current_material' } : null,
    recentConversation: (input.recentConversation ?? []).slice(-4),
    acceptedTask: { title: context.task.title, category: context.task.category }, currentMaterial: context.component?.label ?? null,
    workloadChoices: context.workloads.map(({ choice, fact }) => ({ choice, amount: fact.amount, unitCode: fact.unitCode, unitLabel: fact.unitLabel })),
    registeredMaterials: context.materials.map(({ choice, name, aliases }) => ({ choice, name, aliases })),
  }) }];
}

export function parseFocusedMaterialDocumentV5(raw: string, context: FocusedMaterialContextV5): { document: WeeklyPlanningSemanticDocumentV5 | null; errors: string[]; fallback: boolean; sourceSpans?: string[] } {
  let value: Record<string, unknown> | null;
  try { value = record(JSON.parse(raw)); } catch { value = null; }
  const invalid = (error: string) => ({ document: null, errors: [`focused-material:${error}`], fallback: false });
  if (!value || Object.keys(value).length !== ANSWER_FIELDS.length || ANSWER_FIELDS.some((key) => !(key in value))) return invalid('schema');
  const empty = (keys: string[]) => keys.every((key) => value![key] === null);
  const document: WeeklyPlanningSemanticDocumentV5 = { schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null,
    tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [], conversationActs: [] };
  if (value.decision === 'fallback' || value.decision === 'explain_question') {
    if (!empty(ANSWER_FIELDS.filter((field) => field !== 'decision' && (value!.decision !== 'explain_question' || field !== 'sourceText')))) return invalid('non-answer-payload');
    if (value.decision === 'fallback') return { document: null, errors: [], fallback: true };
    if (typeof value.sourceText !== 'string' || !value.sourceText.trim()) return invalid('explanation-source');
    if (!context.questionPresented) return invalid('no-pending-question');
    document.planningIntent = 'discuss';
    document.conversationActs = [{ kind: 'ask_about_pending_question', targetPublicId: null }];
    return { document, errors: [], fallback: false, sourceSpans: [value.sourceText] };
  }
  if (typeof value.sourceText !== 'string' || !value.sourceText.trim()) return invalid('sourceText');
  const task: WeeklyPlanningSemanticDocumentV5['tasks'][number] = { localId: 'focused_material_task', existingPublicId: context.task.id,
    decompositionStatus: 'atomic', category: context.task.category, title: context.task.title, study: null,
    workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: value.sourceText };
  const combined = value.decision === 'material_and_effort_answer';
  if (value.decision === 'material_answer' || combined) {
    if (typeof value.label !== 'string' || !value.label.trim() || (!combined && !empty(['workloadChoice', 'effortKind', 'minutes', 'precision', 'effortSourceText']))) return invalid('material-payload');
    // Literal evidence validation only; interpretation and choice remain model-owned.
    const normalizedLabel = normalizeWeeklyPlanningEvidenceTextV5(value.label).toLowerCase();
    if (!normalizedLabel || !normalizeWeeklyPlanningEvidenceTextV5(value.sourceText).toLowerCase().includes(normalizedLabel)) return invalid('label-without-current-source');
    if (value.registeredChoice !== null && !context.materials.some((entry) => entry.choice === value!.registeredChoice
      && [entry.name, ...entry.aliases].includes(String(value!.label)))) return invalid('registeredChoice');
    task.study = { purpose: 'unknown', contextLabel: null, components: [{ localId: 'focused_material', existingPublicId: context.component?.id ?? null,
      parentLocalId: null, role: 'material', label: value.label, sourceText: value.sourceText, workloads: [], durableContextSignals: [] }] };
  }
  if (value.decision === 'effort_answer' || combined) {
    if ((!combined && !empty(['label', 'registeredChoice', 'effortSourceText'])) || value.effortKind !== 'duration_per_unit'
      || typeof value.minutes !== 'number' || !Number.isFinite(value.minutes) || value.minutes <= 0
      || !['exact', 'approximate', 'unspecified'].includes(String(value.precision))) return invalid('effort-payload');
    const target = context.workloads.find((entry) => entry.choice === value!.workloadChoice)?.fact;
    if (!target) return invalid('workloadChoice');
    const effortSource = combined ? value.effortSourceText : value.sourceText;
    if (typeof effortSource !== 'string' || !effortSource.trim()) return invalid('effort-source');
    task.effortEstimates = [{ localId: 'focused_material_pace', targetLocalId: target.id, kind: 'duration_per_unit', minutes: value.minutes,
      unitCode: target.unitCode, precision: value.precision as 'exact' | 'approximate' | 'unspecified', sourceText: effortSource }];
  } else if (value.decision !== 'material_answer') return invalid('decision');
  document.tasks = [task];
  document.conversationActs = [{ kind: 'answer_pending_question', targetPublicId: null }];
  return { document, errors: [], fallback: false, sourceSpans: [value.sourceText, ...(combined ? [String(value.effortSourceText)] : [])] };
}

/** One focused attempt and one repair; subsequent generic interpretation has no repair left. */
export async function tryFocusedMaterialAnswerRouteV5(run: WeeklyPlanningSemanticNormalizerRunV5): Promise<WeeklyPlanningSemanticNormalizerResultV5 | null> {
  const context = focusedMaterialContextV5(run.input);
  if (!context) return null;
  const baseMessages = createFocusedMaterialMessagesV5(run.input, context);
  let messages = baseMessages;
  let errors: string[] = [];
  const before = run.responseLengths.length;
  const finish = (status: WeeklyPlanningSemanticNormalizerResultV5['status'], document: WeeklyPlanningSemanticDocumentV5 | null, repair: boolean, providerError: string | null = null) => {
    const result: WeeklyPlanningSemanticNormalizerResultV5 = { status, document, diagnostics: run.diagnostics({
      attemptCount: run.responseLengths.length, repairAttempted: repair, validationErrors: errors, providerError,
    }) };
    run.recordDecision(result, { route: 'focused_material_answer' });
    return result;
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt && weeklyPlanningSemanticRepairConsumedV5(run)) return null;
    const request = { messages, temperature: 0, responseFormat: focusedMaterialResponseFormatV5(context),
      purpose: 'weekly_planning_semantic_normalizer' as const, maxCompletionTokens: 400 };
    const attemptName = attempt ? 'focused_material_answer_repair' : 'focused_material_answer';
    const requestBytes = semanticNormalizerByteLength(request);
    run.requestBytes.push(requestBytes);
    recordWeeklyPlanningStableV5DebugTrace({ requestId: run.input.traceRequestId, stage: 'semantic_provider_request', data: { attempt: attemptName, requestBytes, request } });
    let response: string;
    if (attempt) markWeeklyPlanningSemanticRepairConsumedV5(run);
    try {
      response = await run.client.createChatCompletion(run.client.semanticCensusEnabled
        ? { ...request, semanticCensusStage: attempt ? 'repair' : 'focused' } : request);
      run.responseLengths.push(response.length);
      recordWeeklyPlanningStableV5DebugTrace({ requestId: run.input.traceRequestId, stage: 'semantic_provider_response', data: { attempt: attemptName, responseLength: response.length, rawResponse: response } });
    } catch (error) {
      if (!attempt) return null;
      return finish('provider_failure', null, true, semanticNormalizerErrorMessage(error));
    }
    const parsed = parseFocusedMaterialDocumentV5(response, context);
    if (parsed.fallback) return null;
    const validation = parsed.document ? validateWeeklyPlanningSemanticResponseV5(JSON.stringify(parsed.document), {
      currentUserText: run.input.userText, committedGraph: run.input.committedGraph, publicStateSummary: run.input.publicStateSummary,
      recentConversation: run.input.recentConversation, conversationArchitecture: run.input.conversationArchitecture,
    }) : null;
    errors = validation?.errors ?? parsed.errors;
    const invalidSpans = (parsed.sourceSpans ?? []).some((span) => !run.input.userText.includes(span));
    if (invalidSpans) errors = [...errors, 'focused-material:source-span-not-grounded-in-current-user-text'];
    const task = validation?.document?.tasks[0];
    const materialLabel = task?.study?.components[0]?.label;
    const effortSource = task?.effortEstimates[0]?.sourceText;
    const materialAnchorMissing = Boolean(materialLabel && !run.input.userText.includes(materialLabel));
    const effortAnchorUnbounded = Boolean(effortSource && !boundedEffortEvidenceV5(effortSource));
    // A quoted whole reply cannot make one material leaf cover an omitted pace.
    const anchors = materialLabel ? [materialLabel, ...(effortSource && !effortAnchorUnbounded ? [effortSource] : [])]
      : effortSource ? effortAnchorUnbounded ? [] : [effortSource] : parsed.sourceSpans;
    const knownLabels = [context.component?.label ?? '', ...context.materials.flatMap((entry) => [entry.name, ...entry.aliases])];
    // Typed owner names only select further AI interpretation; no name is bound
    // or meaning established by this literal match. Unknown names remain open.
    const effortMentionsMaterial = Boolean(effortSource && !materialLabel && knownLabels.some((label) =>
      weeklyPlanningLabelEvidencedBySourceV5(label, run.input.userText)));
    const coverage = validation?.document && !invalidSpans ? measureWeeklyPlanningSemanticEvidenceCoverageV5({
      userText: run.input.userText, document: validation.document, additionalSourceTexts: anchors,
      additionalSourceTextsOnly: true, includeUncoveredDigits: true,
    }) : null;
    // This conservative acceptance gate selects more AI interpretation only.
    // Generic audit eligibility remains at K8 with its original result shape.
    const incomplete = materialAnchorMissing || effortAnchorUnbounded || effortMentionsMaterial || Boolean(coverage && ((coverage.coveredCodePoints > 0 && coverage.maxUncoveredSpanCodePoints >= 4)
      || (coverage.uncoveredDigitCodePoints ?? 0) > 0));
    if (incomplete) errors = [...errors, `focused-material:uncovered-literal-span:${coverage?.maxUncoveredSpanCodePoints ?? 0}`];
    recordWeeklyPlanningStableV5DebugTrace({ requestId: run.input.traceRequestId, stage: 'semantic_validation_result', data: {
      attempt: attemptName, accepted: Boolean(validation?.document) && !invalidSpans && !incomplete, errors, parsedDocument: validation?.parsedDocument ?? parsed.document,
      conversationActs: validation?.conversationActs ?? parsed.document?.conversationActs ?? [],
    } });
    if (incomplete) return null;
    if (validation?.document && !invalidSpans) {
      run.addAlgorithmicRepairs(validation.algorithmicRepairs);
      return finish('accepted', withoutRedundantFocusedRate(run, parsed.document!, validation.document), attempt > 0);
    }
    if (attempt) return null;
    const payload = JSON.parse(baseMessages[1].content) as Record<string, unknown>;
    messages = [...baseMessages, { role: 'assistant', content: response }, { role: 'user', content: JSON.stringify({ ...payload,
      repair: { validationErrors: errors, instruction: 'Repair the focused answer once using the same current user text, exact choices and source evidence. Return fallback if the meaning cannot be expressed without losing other information.' },
    }) }];
  }
  return before === run.responseLengths.length ? null : finish('rejected', null, true);
}
