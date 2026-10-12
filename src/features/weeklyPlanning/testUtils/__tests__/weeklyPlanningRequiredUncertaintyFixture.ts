import { createEmptyWeeklyPlanningFactGraphV5 } from '../../semantic/weeklyPlanningFactGraphV5';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { createWeeklyPlanningSemanticPipelineV5 } from '../../semantic/weeklyPlanningSemanticPipelineV5';
import { validateWeeklyPlanningSemanticResponseV5 } from '../../semantic/weeklyPlanningSemanticResponseValidationV5';
import type { WeeklyPlanningSemanticDocumentV5 } from '../../semantic/weeklyPlanningSemanticDocumentV5';
import type { WeeklyPlanningSemanticNormalizerV5 } from '../../semantic/weeklyPlanningSemanticNormalizerContractsV5';
import { beginWeeklyPlanningStableV5DebugTrace, takeWeeklyPlanningStableV5DebugTrace } from '../../trace/weeklyPlanningStableV5DebugTrace';

export const REQUIRED_UNCERTAINTY_SETUP = '2026年8月17日に数学の問題集を20問進めたい。教材はまだ未確定です。';
export const REQUIRED_UNCERTAINTY_ANSWER = '1問3分くらい。教材はまだ未確定です。';
const schedulerContext = { ownerId: 'required-uncertainty-owner', currentDate: '2026-08-12', planningStartDate: '2026-08-17', planningEndDate: '2026-08-17', timeZone: 'Asia/Tokyo' };
function task(existingPublicId: string | null, sourceText: string): WeeklyPlanningSemanticDocumentV5['tasks'][number] {
  return { localId: 't', existingPublicId, decompositionStatus: 'atomic', category: 'study', title: '数学の問題集', study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [] }, workloads: [{ localId: 'wl', quantityRole: 'target', amount: 20, unitCode: 'problem', unitLabel: '問', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText }], effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText };
}
function need(sourceText: string): WeeklyPlanningSemanticDocumentV5['uncertainties'][number] {
  return { localId: 'u', targetLocalId: 't', field: 'material_identity', reason: '教材はまだ未確定です', sourceText };
}
function document(overrides: Partial<WeeklyPlanningSemanticDocumentV5>): WeeklyPlanningSemanticDocumentV5 {
  return { schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan', planningWindow: null, tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [], conversationActs: [], ...overrides };
}
function validatedNormalizer(rawDocument: WeeklyPlanningSemanticDocumentV5): WeeklyPlanningSemanticNormalizerV5 {
  return { async normalize(input) {
    const raw = JSON.stringify(rawDocument);
    const validation = validateWeeklyPlanningSemanticResponseV5(raw, { currentUserText: input.userText, recentConversation: input.recentConversation, publicStateSummary: input.publicStateSummary, committedGraph: input.committedGraph });
    if (validation.errors.length > 0 || !validation.document) throw new Error(`Invalid required-uncertainty fixture: ${JSON.stringify(validation)}`);
    return { status: 'accepted', document: validation.document, diagnostics: { schemaVersion: 'weekly-planning-semantic-v5', jsonSchemaName: 'weekly_planning_semantic_document_v5', normalizerVersion: 'weekly-planning-semantic-normalizer-v5', attemptCount: 0, repairAttempted: false, requestBytes: [], responseLengths: [raw.length], latencyMs: 0, validationErrors: [], algorithmicRepairs: validation.algorithmicRepairs, providerError: null, providerDispatch: { count: 0, anyFailure: false, complete: true } } };
  } };
}

/** Same validated typed cases used for the pre-fix original/current comparison;
 * the actual validator, semantic pipeline, commit, compiler and diagnostics run. */
export async function runRequiredUncertaintyRateFixture(relisted: boolean, conversationId = `required-uncertainty-${relisted ? 'relisted' : 'omitted'}`, normalizerFactory: (document: WeeklyPlanningSemanticDocumentV5) => WeeklyPlanningSemanticNormalizerV5 = validatedNormalizer) {
  const initialDocument = document({ planningIntent: 'create_plan', planningWindow: { localId: 'window', kind: 'absolute', value: '2026-08-17', start: '2026-08-17', end: '2026-08-17', sourceText: REQUIRED_UNCERTAINTY_SETUP }, tasks: [task(null, REQUIRED_UNCERTAINTY_SETUP)], uncertainties: [need(REQUIRED_UNCERTAINTY_SETUP)] });
  const initial = await createWeeklyPlanningSemanticPipelineV5(normalizerFactory(initialDocument)).run({ graph: createEmptyWeeklyPlanningFactGraphV5(), conversationId, turnId: 'setup', expectedRevision: 0, userText: REQUIRED_UNCERTAINTY_SETUP, schedulerContext });
  if (initial.status !== 'scheduler_needs_resolution') throw new Error(`Initial uncertainty fixture did not commit: ${JSON.stringify(initial)}`);
  const before = createWeeklyPlanningActiveSchedulerGraphViewV5(initial.graph);
  const originalNeed = before.uncertainties[0];
  const pendingQuestion = { actionId: 'required-material-question', questionCode: 'semantic_uncertainty', targetFactId: originalNeed.id, graphRevision: initial.graph.revision };
  const answerTask = task(before.tasks[0].id, REQUIRED_UNCERTAINTY_ANSWER);
  answerTask.effortEstimates = [{ localId: 'rate', targetLocalId: 'wl', kind: 'duration_per_unit', minutes: 3, unitCode: 'problem', precision: 'approximate', sourceText: REQUIRED_UNCERTAINTY_ANSWER }];
  const answerDocument = document({ tasks: [answerTask], uncertainties: relisted ? [need(REQUIRED_UNCERTAINTY_ANSWER)] : [], conversationActs: [{ kind: 'answer_pending_question', targetPublicId: null }] });
  const requestId = 'rate-answer';
  beginWeeklyPlanningStableV5DebugTrace(requestId);
  const originalGraphBytes = JSON.stringify(initial.graph);
  const second = await createWeeklyPlanningSemanticPipelineV5(normalizerFactory(answerDocument)).run({ graph: initial.graph, conversationId, turnId: requestId, expectedRevision: initial.graph.revision, userText: REQUIRED_UNCERTAINTY_ANSWER, recentConversation: [{ role: 'user', content: REQUIRED_UNCERTAINTY_SETUP }], publicStateSummary: { pendingQuestion, uncertainties: [{ publicId: originalNeed.id, targetPublicId: originalNeed.targetFactId, field: originalNeed.field, reason: originalNeed.reason }] }, schedulerContext });
  return { initial, before, second, originalNeed, originalGraphBytes, pendingQuestion, answerDocument, requestId, debugTrace: takeWeeklyPlanningStableV5DebugTrace(requestId), after: createWeeklyPlanningActiveSchedulerGraphViewV5(second.graph) };
}
