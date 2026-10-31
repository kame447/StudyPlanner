// A thin use of V5's existing focused purpose. It never reads Japanese in code:
// the shared bound-target prompt/parser classify, the VNext binder supplies refs,
// and every abstention reads the entire original input through Luna. No V5 pre-route
// or trace runtime is imported. FocusedInterpreter.test.ts guards target and fallback.
import { createFocusedContextualAnswerMessagesV5, parseFocusedContextualAnswerDecisionV5,
  createFocusedContextualBindingSnapshotV5, isFocusedContextualBindingCurrentV5,
  FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5, FOCUSED_CONTEXTUAL_ANSWER_MAX_COMPLETION_TOKENS } from '../weeklyPlanningVNextV5Boundary';
import type { WeeklyPlanningSemanticNormalizerInputV5 } from '../../semantic/weeklyPlanningSemanticNormalizerContractsV5';
import type { WeeklyPlanningVNextInterpretationInput, WeeklyPlanningVNextInterpreter } from '../weeklyPlanningVNextInterpretationContract';
import { computeVNextWorkUnits, createVNextLineageResolver, withCurrentVNextReferences } from '../weeklyPlanningVNextWorkIdentity';
import { bindWeeklyPlanningVNextAnswer } from './weeklyPlanningVNextAnswerBinding';
import { applyWeeklyPlanningVNextTurn } from '../semantic/weeklyPlanningVNextTransaction';
import type { VNextTurnDelta } from '../weeklyPlanningVNextTypes';

const empty = (): VNextTurnDelta => ({ add: [], patch: [], remove: [], relate: [], defer: [] });

/** Translate only the presented slot. Projected work is not misrepresented as a stored fact. */
function contextualInput(input: WeeklyPlanningVNextInterpretationInput, requestId: string): WeeklyPlanningSemanticNormalizerInputV5 | null {
  const question = input.presentedQuestion;
  if (!question || input.presentedText === null || input.projection.graphRevision !== input.state.graph.revision
    || !input.projection.questions.some(item => item.key === question.key)
    || !['missing_effort_estimate', 'quantity_role_unresolved'].includes(question.code)
    || question.effortMeasurement === 'session_duration') return null;
  const resolver = createVNextLineageResolver(input.state.graph);
  const graph = withCurrentVNextReferences(input.state.graph, id => resolver.leafOf(id) ?? id);
  const active = new Set(graph.factLifecycles.filter(item => item.status === 'active').map(item => item.factId));
  const task = graph.tasks.find(item => item.id === resolver.leafOf(question.taskId));
  if (!task) return null;
  const unit = question.forWork ? computeVNextWorkUnits(graph).flatMap(owner => owner.units)
    .find(item => item.workLineageId === question.forWork!.workLineageId) : null;
  const unresolved = graph.workloads.filter(fact => active.has(fact.id) && question.subjectLineageIds.includes(resolver.lineageOf(fact.id)));
  const workload = question.forWork ? graph.workloads.find(fact => fact.id === resolver.leafOf(question.forWork!.definingFactId))
    : unresolved.length === 1 ? unresolved[0] : null;
  if (!workload || (question.forWork && !unit)) return null;
  const slotId = question.forWork?.workLineageId ?? workload.id;
  return { userText: input.userText, traceRequestId: requestId, publicStateSummary: {
    graphRevision: graph.revision,
    pendingQuestion: { actionId: question.key, questionCode: question.code, targetFactId: slotId, graphRevision: graph.revision,
      effortMeasurement: question.code === 'missing_effort_estimate' ? 'total_duration' : null,
      questionBasis: null, estimateForWorkloadFactId: null },
    tasks: [{ publicId: task.id, category: task.category, title: task.title }],
    components: graph.components.filter(item => active.has(item.id) && item.taskId === task.id).map(item => ({
      publicId: item.id, taskPublicId: task.id, parentComponentPublicId: item.parentComponentId, role: item.role, label: item.label })),
    workloads: [{ publicId: slotId, taskPublicId: task.id, componentPublicId: workload.componentId,
      quantityRole: unit?.role ?? workload.quantityRole, amount: question.forWork?.amount ?? workload.amount,
      unitCode: workload.unitCode, unitLabel: workload.unitLabel, rangeStart: workload.rangeStart, rangeEnd: workload.rangeEnd,
      perOccurrence: workload.perOccurrence, periodExpression: workload.periodExpression }],
  } };
}

export function createWeeklyPlanningVNextFocusedInterpreter(params: { fullReading: WeeklyPlanningVNextInterpreter }): WeeklyPlanningVNextInterpreter {
  return async input => {
    const started = Date.now();
    const requestId = `vnext-focused:${crypto.randomUUID()}`;
    const evidence = contextualInput(input, requestId);
    const snapshot = evidence ? createFocusedContextualBindingSnapshotV5(evidence) : null;
    if (!evidence || !snapshot) return params.fullReading(input);
    const fallback = async () => {
      const result = await params.fullReading(input);
      return { ...result, metrics: { ...result.metrics, calls: result.metrics.calls + 1, latencyMs: Math.max(0, Date.now() - started) } };
    };
    let raw: string;
    try {
      raw = await input.client.createChatCompletion({
        messages: createFocusedContextualAnswerMessagesV5(evidence, snapshot.context.state.pendingQuestion.target),
        responseFormat: FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5,
        maxCompletionTokens: FOCUSED_CONTEXTUAL_ANSWER_MAX_COMPLETION_TOKENS, temperature: 0,
        purpose: 'weekly_planning_semantic_normalizer', decisionContext: snapshot.context,
      });
    } catch { return fallback(); }
    const current = contextualInput(input, requestId);
    if (!current || !isFocusedContextualBindingCurrentV5(snapshot, current)) return fallback();
    const decision = parseFocusedContextualAnswerDecisionV5(raw);
    if (!decision || decision.decision === 'fallback') return fallback();
    const question = input.presentedQuestion!;
    let delta: VNextTurnDelta;
    if (decision.decision === 'effort_answer') {
      if (question.code !== 'missing_effort_estimate' || decision.effortTarget !== 'question_target') return fallback();
      const bound = bindWeeklyPlanningVNextAnswer({ presentationFresh: true,
        presented: { questionKey: question.key, graphRevision: input.projection.graphRevision }, projection: input.projection,
        lineageOf: createVNextLineageResolver(input.state.graph).lineageOf,
        answer: { kind: 'estimate_minutes', minutes: decision.minutes!, precision: decision.precision!,
          per: decision.effortMeasurement === 'duration_per_unit' ? 'unit' : 'whole_work' } });
      if (bound.status !== 'bound') return fallback();
      delta = bound.delta;
    } else {
      if (question.code !== 'quantity_role_unresolved' || question.subjectLineageIds.length !== 1) return fallback();
      const resolver = createVNextLineageResolver(input.state.graph);
      const targetFactId = resolver.leafOf(question.subjectLineageIds[0]);
      if (!targetFactId) return fallback();
      delta = { ...empty(), patch: [{ kind: 'workload', localId: 'focused_role', targetFactId, amountDelta: null,
        changes: { quantityRole: decision.quantityRole!, amount: null, unitCode: null, unitLabel: null, rangeStart: null,
          rangeEnd: null, perOccurrence: null, periodExpression: null } }] };
    }
    const dryRun = applyWeeklyPlanningVNextTurn(input.state, delta, { expectedRevision: input.state.graph.revision,
      acceptedDate: input.clock.currentDate, weekStartsOn: input.clock.weekStartsOn,
      planningHorizon: { startDate: input.clock.planningStartDate, endDate: input.clock.planningEndDate },
      defaultPlanningHorizon: input.clock.defaultPlanningHorizon, observedMemoryPace: input.observedMemoryPace,
      conversationId: 'vnext-focused-dry-run', turnKey: requestId, turnId: requestId, sourceText: input.userText });
    if (dryRun.status === 'rejected') return fallback();
    return { status: 'interpreted', delta, answer: null, metrics: { calls: 1, repairs: 0, latencyMs: Math.max(0, Date.now() - started) } };
  };
}
