import { createWeeklyPlanningStableV5CurrentTurnGrounding } from '../dialogue/weeklyPlanningStableV5CurrentTurnGrounding';
import { createWeeklyPlanningStableV5DialogueProjection } from '../semantic/weeklyPlanningStableV5DialogueProjection';
import { createWeeklyPlanningStableV5DialogueRendererCore } from '../dialogue/weeklyPlanningStableV5AiDialogueRendererCore';
import { createWeeklyPlanningAiRenderedDialogueTrace, createWeeklyPlanningFallbackDialogueTrace, recordWeeklyPlanningDialogueRendererRequestV5, recordWeeklyPlanningDialogueRendererResponseV5 } from '../dialogue/weeklyPlanningStableV5TurnDialogueTrace';
import { D5_TOP1_ANSWER_POLICY_VERSION, D5_TOP1_SCOPE } from '../../../../shared/d5AnswerPolicy';
import { numericFixture } from '../semantic/weeklyPlanningNumericPendingChoiceV5.testUtils';
import { numericPendingCompleteScopeV5 } from '../semantic/weeklyPlanningNumericPendingScopeV5';
import { createWeeklyPlanningSemanticPublicStateSummaryV5 } from '../semantic/weeklyPlanningSemanticPublicStateV5';
import { tryNumericPendingChoiceRouteV5 } from '../semantic/weeklyPlanningNumericPendingChoiceV5';
import { WeeklyPlanningSemanticNormalizerRunV5 } from '../semantic/weeklyPlanningSemanticNormalizerRunV5';
import { CANDIDATE_CHOICE_CATALOG_VERSION } from '../../../../shared/candidateChoiceDecision';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { choiceRequest, choiceEvaluation } from '../../../../shared/candidateChoiceFixtures.testUtils';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createCandidateChoiceClient } from '../../../services/ai/candidateChoiceClient';
import { createControlledCandidateChoiceOptions, type ControlledCandidateDomainHost } from '../application/weeklyPlanningControlledCandidateChoice';
import { createNumericPendingRegisteredDomainV5 } from '../semantic/weeklyPlanningNumericRegisteredDomainV5';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { recordWeeklyPlanningStableV5DebugTrace, takeWeeklyPlanningStableV5DebugTrace } from './weeklyPlanningStableV5DebugTrace';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from './weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceRepository, WeeklyPlanningTraceSession } from './weeklyPlanningTraceTypes';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
const userId = 'numeric-choice-owner'; const conversationId = 'weekly-conversation-323e4567-e89b-52d3-a456-426614174000';
let restore: () => void;
beforeEach(() => { restore = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage); resetWeeklyPlanningStableV5TraceRuntimeForTest(); });
afterEach(() => { resetWeeklyPlanningStableV5TraceRuntimeForTest(); setWeeklyPlanningTraceRepositoryForTests(undefined); restore(); });
function repository() {
  const writes: { session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }[] = []; let fail = false;
  const port: WeeklyPlanningTraceRepository = { async upsertSession() {}, async appendEntries(p) { if (fail) { fail = false; throw new Error('injected append failure'); } writes.push(structuredClone(p)); }, async listSessions() { return []; }, async listSessionsForAdmin() { return []; }, async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; } };
  return { port, writes, failNext() { fail = true; } };
}
async function dispatchAndTrace(oversized = false, effortTarget: 'workload' | 'task' = 'workload') {
  const r = choiceRequest(); const requestId = `${conversationId}:request:choice`;
  const scope = { ...r.context.scope, ...D5_TOP1_SCOPE, futureNumericChoiceSentinel: 'keep-unknown-numeric-sentinel', ...(oversized ? { largeValue: 'あ'.repeat(15000) } : {}) };
  const request = { ...r, context: { ...r.context, scope } }; let serializedBody = '';
  const client = createCandidateChoiceClient({ semanticPolicy: { calibrationEvidenceId: 'synthetic-test-only', maximumConditionChange: 0.01, maximumIndependentMeaning: 0.01 },
    proxyUrl: 'https://fixture.invalid', getToken: async () => 'auth-secret-never-trace', semanticCensus: { sentinel: 'census-never-trace' },
    transport: async (_input, init) => { serializedBody = String(init?.body); return Response.json(choiceEvaluation(request)); } });
  await client.choose(request, () => {
    const { wholeUtterance, ...candidateChoiceRequest } = request;
    // Exercise the actual stage projection; future raw transport fields must not leak.
    recordWeeklyPlanningStableV5DebugTrace({ requestId, stage: 'semantic_provider_request', data: { attempt: 'numeric_pending_choice', requestBytes: JSON.stringify(request).length,
      request: { purpose: 'weekly_planning_semantic_normalizer', messages: [{ role: 'user', content: wholeUtterance }], candidateChoiceRequest: { ...candidateChoiceRequest, token: 'token-never-trace', ownerId: 'owner-never-trace', semanticCensus: 'census-never-trace' } } } });
  });
  const graph = numericFixture().graph;
  const workload = graph.workloads[0];
  graph.effortEstimates.push({ id: 'required-effort-ack', taskId: workload.taskId, targetFactId: effortTarget === 'task' ? workload.taskId : workload.id,
    kind: 'total_duration', minutes: 15, unitCode: effortTarget === 'task' ? 'minute' : null, precision: 'exact', createdRevision: graph.revision,
    source: { ...workload.source, turnId: requestId, sourceText: '15' } });
  graph.factLifecycles.push({ factId: 'required-effort-ack', status: 'active', createdRevision: graph.revision,
    terminalRevision: null, supersededByFactId: null });
  const currentTurnGrounding = createWeeklyPlanningStableV5CurrentTurnGrounding({ graph, turnId: requestId,
    actionKind: 'status', previousQuestionCode: 'missing_effort_estimate', currentQuestionCode: null });
  const fact = currentTurnGrounding.acceptedFacts.find(f => f.kind === 'effort_estimate')!;
  fact.data.futureEffortAckSentinel = 'keep-future-effort-ack';
  const input = { actionId: 'required-ack-action', currentUserMessage: '15', recentConversation: [],
    planningInformation: createWeeklyPlanningStableV5DialogueProjection(graph), currentTurnGrounding, actionKind: 'status' as const, questionCode: null,
    requiredLabels: [], fallbackText: '技術的なエラー', previewCount: 0 };
  let actualRendererRequest = '';
  const renderer = createWeeklyPlanningStableV5DialogueRendererCore({ async createChatCompletion(request) {
    actualRendererRequest = JSON.stringify(request);
    const text = `${(fact.data.targetLabels as string[]).join('の')}${workload.amount}${workload.unitLabel}は全部で15分ですね。`;
    return JSON.stringify({ actionId: input.actionId, actionKind: input.actionKind, questionCode: null,
      groundingAcknowledgement: { factIds: [fact.factId], text }, text });
  } });
  recordWeeklyPlanningDialogueRendererRequestV5({ requestId, input });
  const rendered = await renderer.render(input);
  expect(rendered.status).toBe('rendered');
  expect(actualRendererRequest).toContain('keep-future-effort-ack');
  recordWeeklyPlanningDialogueRendererResponseV5({ requestId, actionId: input.actionId, rendered, selfRepairNotice: null });
  if (rendered.status !== 'rendered') throw new Error('ACK fixture failed');
  const dialogueRendererTrace = createWeeklyPlanningAiRenderedDialogueTrace({ actionId: input.actionId, actionKind: 'status', questionCode: null, renderInput: input, rendered, finalMessage: rendered.text });
  dialogueRendererTrace.request!.promptContext = JSON.parse(actualRendererRequest);
  const events = takeWeeklyPlanningStableV5DebugTrace(requestId);
  expect(JSON.parse(serializedBody).decisionContext.request.context.scope.futureNumericChoiceSentinel).toBe('keep-unknown-numeric-sentinel');
  return { userId, conversationId, requestId, userText: r.wholeUtterance, assistantMessage: '確認しました', responseSource: 'ai' as const, outcome: 'discuss', previewCount: 0, debugTraceEvents: events, dialogueRendererTrace };
}
function prepare(write: ReturnType<typeof repository>['writes'][number]) {
  return prepareWeeklyPlanningTraceServerWrite({ session: write.session as unknown as Record<string, unknown>, entries: write.entries as unknown as Record<string, unknown>[] },
    { token: `wpt_${'d'.repeat(43)}`, epoch: '103' }, { sessionId: 'weekly-trace-323e4567-e89b-52d3-a456-426614174000', logicalConversationId: conversationId }, '2026-10-05T00:00:00.000Z');
}
describe('actual Choice request through durable trace gate', () => {
  it.each([
    { corrected: false, contextualMinutes: null, nonReflected: null }, { corrected: true, contextualMinutes: null, nonReflected: null },
    { corrected: false, contextualMinutes: 45, nonReflected: null }, { corrected: false, contextualMinutes: 60, nonReflected: null },
    { corrected: false, contextualMinutes: null, nonReflected: 'question' }, { corrected: false, contextualMinutes: null, nonReflected: 'assertion' },
  ])('persists asymmetric active-fact claim checks: %j', async ({ corrected, contextualMinutes, nonReflected }) => {
    const requestId = 'display-existing-effort';
    const contextual = contextualMinutes !== null, valid = nonReflected ? nonReflected === 'question' : contextual ? contextualMinutes === 45 : corrected;
    const graph: WeeklyPlanningFactGraphV5 = numericFixture('duration_per_unit').graph;
    const workload = graph.workloads[0];
    graph.effortEstimates.push({ id: 'old-rate', taskId: workload.taskId, targetFactId: workload.id,
      kind: 'duration_per_unit', minutes: 15, unitCode: 'problem', precision: 'exact', createdRevision: 2,
      source: contextual ? { ...workload.source, turnId: requestId } : workload.source });
    graph.factLifecycles.push({ factId: 'old-rate', status: corrected ? 'superseded' : 'active', createdRevision: 2,
      terminalRevision: corrected ? 3 : null, supersededByFactId: corrected ? 'new-total' : null });
    if (corrected) {
      graph.revision = 3;
      graph.effortEstimates.push({ ...graph.effortEstimates[0], id: 'new-total', kind: 'total_duration', minutes: 60, unitCode: null, createdRevision: 3 });
      graph.factLifecycles.push({ factId: 'new-total', status: 'active', createdRevision: 3, terminalRevision: null, supersededByFactId: null });
    }
    if (contextual || nonReflected) {
      graph.tasks.push({ ...graph.tasks[0], id: 'english', title: '英語' });
      graph.workloads.push({ ...workload, id: 'english-work', taskId: 'english', amount: 15, unitCode: 'page', unitLabel: 'ページ' });
      graph.effortEstimates.push({ ...graph.effortEstimates[0], id: 'english-effort', taskId: 'english', targetFactId: 'english-work',
        kind: 'total_duration', minutes: 45, unitCode: 'minute', source: workload.source });
      for (const factId of ['english', 'english-work', 'english-effort']) graph.factLifecycles.push({ factId, status: 'active',
        createdRevision: 2, terminalRevision: null, supersededByFactId: null });
    }
    if (nonReflected) {
      graph.effortEstimates = graph.effortEstimates.filter(fact => fact.taskId !== workload.taskId);
      graph.factLifecycles = graph.factLifecycles.filter(fact => fact.factId !== 'old-rate');
    }
    const currentTurnGrounding = createWeeklyPlanningStableV5CurrentTurnGrounding({ graph, turnId: requestId,
      actionKind: 'status', previousQuestionCode: null, currentQuestionCode: null });
    expect(currentTurnGrounding.acceptedFacts.filter(fact => fact.kind === 'effort_estimate')).toHaveLength(contextual ? 1 : 0);
    const input = { actionId: requestId, currentUserMessage: nonReflected ? '15分。あと英語の締切を金曜にして' : 'いや、数学は全部で60分です。', recentConversation: [],
      planningInformation: { ...createWeeklyPlanningStableV5DialogueProjection(graph), futureActiveClaimSentinel: 'keep-active-claim-sentinel' },
      currentTurnGrounding, actionKind: 'status' as const, questionCode: null, requiredLabels: [], previewCount: 0,
      fallbackText: '返信を作れませんでした。少し待ってからもう一度送信してください。' };
    const before = structuredClone(graph); let sends = 0; let actualRequest = '';
    const text = nonReflected === 'question' ? '今回は「15分」という内容も、英語の締切を金曜にする内容も計画に反映されていません。数学は1問あたり15分、という理解でよいですか？'
      : nonReflected === 'assertion' ? '数学は1問あたり15分ですね。'
      : contextual ? `数学は1問あたり15分ですね。数学20問と英語15ページ（全部で${contextualMinutes}分）をもとに確認してください。`
      : '失礼しました。数学は1問あたり15分ではなく、全部で60分ですね。';
    const renderer = createWeeklyPlanningStableV5DialogueRendererCore({ async createChatCompletion(request) {
      sends++; actualRequest = JSON.stringify(request);
      return JSON.stringify({ actionId: requestId, actionKind: 'status', questionCode: null,
        groundingAcknowledgement: contextual ? { factIds: ['old-rate'], text: '数学は1問あたり15分ですね。' } : null, text });
    } });
    recordWeeklyPlanningDialogueRendererRequestV5({ requestId, input });
    const rendered = await renderer.render(input);
    expect(rendered.status).toBe(valid ? 'rendered' : 'fallback');
    expect(sends).toBe(valid ? 1 : 2);
    if (!valid) expect(actualRequest).toContain('planningInformation.effortEstimatesの現在有効な対象');
    expect(graph).toEqual(before);
    recordWeeklyPlanningDialogueRendererResponseV5({ requestId, actionId: requestId, rendered, selfRepairNotice: null });
    const finalMessage = rendered.status === 'rendered' ? rendered.text : input.fallbackText;
    const traceParams = { actionId: requestId, actionKind: 'status' as const, questionCode: null, renderInput: input, finalMessage };
    const dialogueRendererTrace = rendered.status === 'rendered' ? createWeeklyPlanningAiRenderedDialogueTrace({ ...traceParams, rendered })
      : createWeeklyPlanningFallbackDialogueTrace({ ...traceParams, rendered });
    dialogueRendererTrace.request!.promptContext = JSON.parse(actualRequest);
    const trace = { userId, conversationId, requestId, userText: input.currentUserMessage, assistantMessage: finalMessage,
      responseSource: valid ? 'ai' as const : 'deterministic_fallback' as const, outcome: 'discuss', previewCount: 0,
      dialogueRendererTrace, debugTraceEvents: takeWeeklyPlanningStableV5DebugTrace(requestId) };
    const h = repository(); h.failNext(); setWeeklyPlanningTraceRepositoryForTests(h.port);
    await recordWeeklyPlanningStableV5TurnTrace(trace);
    expect(listWeeklyPlanningTraceOutboxItems({ userId, conversationId })).toHaveLength(1);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace({ ...trace, requestId: 'retry-existing-display', debugTraceEvents: [] });
    expect(listWeeklyPlanningTraceOutboxItems({ userId, conversationId })).toEqual([]);
    expect(h.writes).toHaveLength(2);
    expect(measureWeeklyPlanningTraceJsonBytes(h.writes[0].entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const prepared = prepare(h.writes[0]);
    for (const entry of [h.writes[0].entries[0], prepared.entries[0]]) {
      expect(JSON.stringify(entry)).toContain('keep-active-claim-sentinel');
      expect(JSON.stringify(entry)).toContain(nonReflected ? '数学は1問あたり15分' : contextual ? `英語15ページ（全部で${contextualMinutes}分）` : '1問あたり15分ではなく');
      expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    }
  });
  it.each(['workload', 'task'] as const)('preserves question/scope/menu/hash/epoch and %s-target ACK through failed append, outbox retry and Worker preparation', async effortTarget => {
    const h = repository(); h.failNext(); setWeeklyPlanningTraceRepositoryForTests(h.port);
    const input = await dispatchAndTrace(false, effortTarget); await recordWeeklyPlanningStableV5TurnTrace(input);
    expect(h.writes).toHaveLength(0); expect(listWeeklyPlanningTraceOutboxItems({ userId, conversationId })).toHaveLength(1);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace({ ...input, requestId: `${conversationId}:request:retry`, debugTraceEvents: [] });
    expect(h.writes).toHaveLength(2); expect(listWeeklyPlanningTraceOutboxItems({ userId, conversationId })).toEqual([]);
    const entry = h.writes[0].entries[0]; expect(entry.kind).toBe('turn_diagnostic');
    expect(JSON.stringify(entry)).toContain('は全部で15分ですね。');
    const serialized = JSON.stringify(entry);
    for (const marker of ['keep-unknown-numeric-sentinel', 'missing_effort_estimate', 'question-1', 'workload-1', 'sha256:', 'selectionEpoch', 'precision', 'exact', D5_TOP1_ANSWER_POLICY_VERSION, 'one_exact_duration_or_contextual_bare_minutes', 'keep-future-effort-ack', 'targetLabels', 'unitLabel', 'required_before_resume']) expect(serialized).toContain(marker);
    for (const marker of ['auth-secret-never-trace', 'token-never-trace', 'owner-never-trace', 'census-never-trace']) expect(serialized).not.toContain(marker);
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const prepared = prepare(h.writes[0]); expect(prepared.entries).toHaveLength(1);
    expect(JSON.stringify(prepared.entries[0])).toContain('は全部で15分ですね。');
    expect(JSON.stringify(prepared.entries[0])).toContain('keep-unknown-numeric-sentinel');
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
  });
  it('preserves actual D5 complete ancestor scope through the real client, outbox retry and Worker preparation', async () => {
    const numeric = numericFixture(); const pending = numeric.input.publicStateSummary!.pendingQuestion;
    numeric.graph.tasks[0].source.sourceText = 'private-numeric-provenance-never-trace';
    numeric.graph.components.push({ id: 'numeric-material', taskId: 'task-1', parentComponentId: null,
      role: 'material', label: '山地の教材', source: numeric.graph.tasks[0].source, createdRevision: 2 },
      { id: 'numeric-chapter', taskId: 'task-1', parentComponentId: 'numeric-material',
        role: 'chapter', label: '第1章', source: numeric.graph.tasks[0].source, createdRevision: 2 });
    Object.assign(numeric.graph.workloads[0], { componentId: 'numeric-chapter' });
    numeric.graph.factLifecycles.push(...numeric.graph.components.map(fact => ({ factId: fact.id, status: 'active' as const,
      createdRevision: 2, terminalRevision: null, supersededByFactId: null })));
    numeric.input.publicStateSummary = createWeeklyPlanningSemanticPublicStateSummaryV5({ pendingQuestion: pending }, numeric.graph);
    const scope = numericPendingCompleteScopeV5(numeric.input, D5_TOP1_ANSWER_POLICY_VERSION)!;
    numeric.setState({ ...numeric.state, binding: { ...numeric.state.binding, scope } });
    let wire: any;
    const choicePolicy = { ...numeric.port.choicePolicy, rules: numeric.port.choicePolicy.rules.map(rule => ({ ...rule, minimumTopProbability: 0, minimumMargin: 0 })) };
    const options = createControlledCandidateChoiceOptions(createNumericPendingRegisteredDomainV5([10, 20, 30], D5_TOP1_ANSWER_POLICY_VERSION), {
      domain: 'd5_numeric', domainPolicyVersion: D5_TOP1_ANSWER_POLICY_VERSION, mode: 'canary', choicePolicy,
      semanticPolicy: { calibrationEvidenceId: 'synthetic-test-only', maximumConditionChange: .01, maximumIndependentMeaning: .01 },
      maximumChildrenPerMenu: 254, maximumDecisions: 1,
    }, { semanticObservation: () => ({ client: {}, finish() {} }),
      choiceServices: { proxyUrl: 'https://fixture.invalid', getToken: async () => 'auth-secret-never-trace', transport: async (_url: RequestInfo | URL, init?: RequestInit) => {
        wire = JSON.parse(String(init?.body)).decisionContext.request;
        return Response.json({ status: 'evaluated', catalogVersion: CANDIDATE_CHOICE_CATALOG_VERSION,
          requestId: wire.requestId, selectionEpoch: wire.selectionEpoch, candidateSetHash: wire.candidateSetHash,
          nodeId: wire.menu.nodeId, optionId: 'leaf:2', conditionChange: .56, independentMeaning: .50,
          probabilities: wire.menu.options.map((option: { id: string }) => ({ optionId: option.id,
            probability: option.id === 'leaf:2' ? .59 : .41 / (wire.menu.options.length - 1) })) });
      } } } as unknown as ControlledCandidateDomainHost)!;
    expect(options).toBeDefined();
    const choose: typeof numeric.port.choose = (request, before) => options.choose({ ...request, context: { ...request.context,
      question: { ...request.context.question, code: 'missing_effort_estimate' } } }, before);
    const port = { ...numeric.port, choicePolicy, domainPolicyVersion: D5_TOP1_ANSWER_POLICY_VERSION, choose };
    const staged = await tryNumericPendingChoiceRouteV5(new WeeklyPlanningSemanticNormalizerRunV5({ createChatCompletion: async () => { throw new Error('No Luna in trace fixture'); } }, numeric.input), port);
    expect(staged?.status).toBe('staged'); expect(wire.context.scope).toEqual(scope);
    expect(wire.menu.options[2].candidate.tuple.scope).toEqual(scope);
    expect(JSON.stringify(wire)).not.toContain('private-numeric-provenance-never-trace');
    const trace = { userId, conversationId, requestId: numeric.input.traceRequestId!, userText: numeric.input.userText,
      assistantMessage: '確認しました', responseSource: 'ai' as const, outcome: 'discuss', previewCount: 0,
      debugTraceEvents: takeWeeklyPlanningStableV5DebugTrace(numeric.input.traceRequestId!) };
    const h = repository(); h.failNext(); setWeeklyPlanningTraceRepositoryForTests(h.port);
    await recordWeeklyPlanningStableV5TurnTrace(trace);
    expect(listWeeklyPlanningTraceOutboxItems({ userId, conversationId })).toHaveLength(1);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace({ ...trace, requestId: 'numeric-ancestor-retry', debugTraceEvents: [] });
    expect(h.writes).toHaveLength(2); expect(listWeeklyPlanningTraceOutboxItems({ userId, conversationId })).toEqual([]);
    for (const entry of [h.writes[0].entries[0], prepare(h.writes[0]).entries[0]]) {
      for (const marker of ['山地の教材', '第1章', 'componentChain', 'unitLabel']) expect(JSON.stringify(entry)).toContain(marker);
      for (const privateValue of ['auth-secret-never-trace', 'private-numeric-provenance-never-trace']) expect(JSON.stringify(entry)).not.toContain(privateValue);
      expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
      const diagnostic = entry as typeof h.writes[0]['entries'][0] & { aiInterpreter: { rawResponses: { attempt: string; text: string }[] } };
      const raw = diagnostic.aiInterpreter.rawResponses.find(response => response.attempt === 'numeric_pending_choice_raw');
      expect(raw).toBeDefined();
      expect(JSON.parse(raw!.text)).toMatchObject({ conditionChange: .56, independentMeaning: .50,
        probabilities: expect.arrayContaining([{ optionId: 'leaf:2', probability: .59 }]) });
    }
    expect(measureWeeklyPlanningTraceJsonBytes(h.writes[0].entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
  });
  it('keeps the whole diagnostic with explicit oversized-menu truncation and server budget', async () => {
    const h = repository(); setWeeklyPlanningTraceRepositoryForTests(h.port);
    await recordWeeklyPlanningStableV5TurnTrace(await dispatchAndTrace(true));
    expect(h.writes).toHaveLength(1); const entry = h.writes[0].entries[0];
    expect(JSON.stringify(entry)).toContain('truncated'); expect(JSON.stringify(entry)).toContain('originalBytes');
    expect(JSON.stringify(entry)).not.toContain('あ'.repeat(15000));
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    expect(measureWeeklyPlanningTraceJsonBytes(prepare(h.writes[0]).entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
  });
});
