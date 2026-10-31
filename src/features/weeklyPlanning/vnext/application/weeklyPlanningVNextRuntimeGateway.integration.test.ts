import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANDIDATE_CHOICE_CATALOG_VERSION, type CandidateChoiceWireRequest } from '../../../../../shared/candidateChoiceDecision';
import { measureWeeklyPlanningTraceJsonBytes, WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS } from '../../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import type { WeeklyPlanningAction } from '../../types';
import type { WeeklyPlanningTurnExecutionResult } from '../../weeklyPlanningTurnExecutionTypes';
import { createInitialPlanningState, weeklyPlanningReducer } from '../../weeklyPlanningReducer';
import { createWeeklyPlanningControllerSession, submitWeeklyPlanningControlledTurn } from '../../weeklyPlanningTurnController';
import { recordCommittedWeeklyPlanningApplicationTurn, recordDiscardedWeeklyPlanningApplicationTurn, recordFailedWeeklyPlanningApplicationTurn } from '../../application/weeklyPlanningTurnTraceSideEffects';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { successfulWeeklyPlanningRendererCompletion } from '../../testUtils/__tests__/weeklyPlanningRendererCompletionFixture';
import { createInMemoryWeeklyPlanningTraceRepository } from '../../trace/weeklyPlanningTraceInMemoryRepository';
import { setWeeklyPlanningTraceRepositoryForTests } from '../../trace/weeklyPlanningTraceRepository';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceSession } from '../../trace/weeklyPlanningTraceTypes';
import { listWeeklyPlanningTraceOutboxItems } from '../../trace/weeklyPlanningTraceOutbox';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from '../../trace/weeklyPlanningStableV5TraceRuntime';
import { resetWeeklyPlanningStableV5DebugTraceForTest } from '../../trace/weeklyPlanningStableV5DebugTrace';
import { createInitialPlanningIntakeState, createWeeklyPlanningStableV5DialogueRendererCore } from '../weeklyPlanningVNextV5Boundary';
import type { WeeklyPlanningVNextInterpretation, WeeklyPlanningVNextInterpreter } from '../weeklyPlanningVNextInterpretationContract';
import type { VNextAddFact, VNextTurnDelta } from '../weeklyPlanningVNextTypes';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { createWeeklyPlanningVNextRuntimeGateway } from './weeklyPlanningVNextRuntimeGateway';
import type { WeeklyPlanningVNextExperimentalPorts } from './weeklyPlanningVNextExperimentalSession';
import { createWeeklyPlanningVNextOptionChoiceInterpreter, createWeeklyPlanningVNextOptionChoicePort } from './weeklyPlanningVNextOptionChoice';

const OWNER = 'synthetic-gateway-owner'; const WEEK = '2026-11-02'; const NOW = `${WEEK}T00:00:00.000Z`;
const CONVERSATION = 'weekly-conversation-423e4567-e89b-52d3-a456-426614174000';
const EMPTY: VNextTurnDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };
const task: VNextAddFact = { kind: 'task', localId: 'task', category: 'study', title: '数学' };
const work = (id: string, role: 'remaining' | 'scope_total' | 'completed', amount: number, unitCode = 'page'): VNextAddFact => ({
  kind: 'workload', localId: id, taskRef: { localId: 'task' }, componentRef: null, quantityRole: role, amount,
  unitCode, unitLabel: unitCode === 'minute' ? '分' : '枚', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
} as VNextAddFact);
const reading = (add: VNextAddFact[], answer: Extract<WeeklyPlanningVNextInterpretation, { status: 'interpreted' }>['answer'] = null): WeeklyPlanningVNextInterpretation => ({
  status: 'interpreted', delta: { ...EMPTY, add }, answer, metrics: { calls: 1, repairs: 0, latencyMs: 1 },
});

let restore: () => void;
let writes: { session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }[];
let failAppend: boolean;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
  restore = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  resetWeeklyPlanningStableV5TraceRuntimeForTest(); resetWeeklyPlanningStableV5DebugTraceForTest();
  writes = []; failAppend = false;
  const repository = createInMemoryWeeklyPlanningTraceRepository();
  setWeeklyPlanningTraceRepositoryForTests({ ...repository, async appendEntries(write) {
    if (failAppend) { failAppend = false; throw new Error('synthetic append failure'); }
    writes.push(structuredClone(write));
  } });
});
afterEach(() => { resetWeeklyPlanningStableV5TraceRuntimeForTest(); resetWeeklyPlanningStableV5DebugTraceForTest();
  setWeeklyPlanningTraceRepositoryForTests(undefined); vi.useRealTimers(); restore(); });

function harness(options: { interpret?: WeeklyPlanningVNextInterpreter; createRenderer?: WeeklyPlanningVNextExperimentalPorts['createRenderer'];
  providerFails?: boolean; beforeDispatch?: (action: WeeklyPlanningAction) => void } = {}) {
  const local = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: createMemoryStorageHarness().storage });
  let state = createInitialPlanningState(WEEK);
  const controller = createWeeklyPlanningControllerSession(OWNER, WEEK, CONVERSATION);
  const requests: unknown[] = [];
  const results: WeeklyPlanningTurnExecutionResult[] = [];
  const client: WeeklyPlanningVNextExperimentalPorts['client'] = { async createChatCompletion(input) {
    requests.push(structuredClone(input));
    if (options.providerFails) throw new Error('synthetic provider unavailable');
    return JSON.stringify({ delta: { ...EMPTY, add: [task, work('work', 'remaining', 30, 'minute')] }, answer: null });
  } };
  const gateway = createWeeklyPlanningVNextRuntimeGateway({ session: local, ports: () => ({ client,
    interpret: options.interpret ?? createWeeklyPlanningVNextProviderInterpreter(), checkpoint: local.checkpoint,
    legacyV5Checkpoint: local.legacyV5Checkpoint, now: () => NOW,
    approvalLedger: { read: () => null, write: () => { throw new Error('no approval in this test'); } },
    plans: { findExistingPlanId: async () => undefined, saveBlock: async () => { throw new Error('no save in this test'); } },
    calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
    createRenderer: options.createRenderer ?? (() => createWeeklyPlanningStableV5DialogueRendererCore({
      createChatCompletion: successfulWeeklyPlanningRendererCompletion,
    })),
  }) });
  const getState = () => state;
  const dispatch = (action: WeeklyPlanningAction) => { options.beforeDispatch?.(action); state = weeklyPlanningReducer(state, action); return state; };
  const submit = (userText: string) => submitWeeklyPlanningControlledTurn({ session: controller, ownerId: OWNER, userText, now: () => NOW,
    getState, dispatch, async execute(input) {
      const result = await gateway.runtimeGateway.execute({ ...input, userId: OWNER, selectedDate: WEEK,
        plans: [], scheduleTemplates: [], timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' });
      results.push(result); return result;
    },
    prepareExecutionCommit: ({ pending }) => gateway.stagingLifecycle.prepare({ ownerId: OWNER, pending }),
    discardExecutionResult: async ({ pending, result, userText, reason }) => {
      gateway.stagingLifecycle.discard(pending);
      if (reason !== 'failed') await recordDiscardedWeeklyPlanningApplicationTurn({ ownerId: OWNER, pending, result, userText, reason });
    },
    onCommittedTurn: async input => { await recordCommittedWeeklyPlanningApplicationTurn({ ...input, ownerId: OWNER }); },
    onFailedTurn: async input => { await recordFailedWeeklyPlanningApplicationTurn({ ...input, ownerId: OWNER }); },
  });
  return { local, submit, getState, requests, results };
}
const diagnosticEntries = () => writes.flatMap(write => write.entries).filter(entry => entry.kind === 'turn_diagnostic');

describe('VNext session → gateway → existing controller and trace owner', () => {
  it('keeps successful placement and records the actual native request and renderer evidence', async () => {
    const h = harness();
    const submitted = await h.submit('数学を30分');
    expect(submitted).toMatchObject({ accepted: true, draftCandidates: [expect.objectContaining({})] });
    expect(h.local.readCheckpoint()!.vnext.state.graph.workloads[0].amount).toBe(30);
    const trace = diagnosticEntries()[0];
    expect(trace.diagnostics.outcome).toBe('preview_ready');
    expect(trace.diagnostics.error).toBeNull();
    expect(trace.assistantOutput.responseSource).toBe('ai');
    const serialized = JSON.stringify(trace);
    expect(serialized).toContain('weekly_planning_vnext');
    expect(serialized).toContain('30分');
    expect(h.results[0].dialogueRendererTrace).toMatchObject({ response: { status: 'rendered' }, decision: { branch: 'ai_rendered' },
      request: { promptContext: { currentUserMessage: '数学を30分', previewCount: 1 } } });
    expect(h.results[0].debugTraceEvents!.find(event => event.stage === 'semantic_provider_request')!.data).toMatchObject({
      request: { messages: (h.requests[0] as { messages: unknown[] }).messages },
    });
  });

  it('records a native provider error as a failed turn with an explicit error code', async () => {
    const h = harness({ providerFails: true, createRenderer: () => ({ render: async () => ({ status: 'fallback', reason: 'provider_error', rawResponse: null }) }) });
    expect(await h.submit('数学を30分')).toEqual({ accepted: true, draftCandidates: [] });
    expect(h.requests).toHaveLength(1);
    expect(diagnosticEntries()[0].diagnostics).toMatchObject({ outcome: 'failed', error: { type: 'vnext_provider_error' } });
    expect(diagnosticEntries()[0].assistantOutput.responseSource).toBe('system');
    expect(h.local.readCheckpoint()!.vnext.state.graph.tasks).toEqual([]);
    expect(h.getState().messages[h.getState().messages.length - 1].content).toBe(h.results[0].failure!.userMessage);
  });

  it.each([true, false])('binds the next answer to the actual retained presentation (verified recovery=%s)', async verified => {
    const failed: WeeklyPlanningVNextInterpretation = { status: 'failed', reason: 'provider_error', errors: [], metrics: { calls: 1, repairs: 0, latencyMs: 1 } };
    let count = 0;
    const shown = '数学8枚は全部で何分ですか？'; const recovered = '反映していません。数学8枚は全部で何分ですか？';
    const h = harness({ interpret: async input => {
      count += 1;
      if (count === 1) return reading([task, work('work', 'remaining', 8)]);
      if (count === 2) return failed;
      expect(input.presentedText).toBe(verified ? recovered : shown);
      expect(input.presentedQuestion?.code).toBe('missing_effort_estimate');
      return reading([], { kind: 'estimate_minutes', minutes: 60, per: 'whole_work' });
    }, createRenderer: () => ({ render: async input => input.recovery
      ? verified ? { status: 'rendered', text: recovered, rawResponse: 'synthetic-recovery-response', recoveryVerified: true }
        : { status: 'fallback', reason: 'recovery_verification_failed', rawResponse: 'synthetic-unverified-response' }
      : { status: 'rendered', text: shown, rawResponse: 'synthetic-question-response' } }) });
    await h.submit('数学は残り8枚');
    const before = h.local.readCheckpoint()!.vnext;
    await h.submit('…');
    const after = h.local.readCheckpoint()!.vnext;
    expect(after.state).toEqual(before.state);
    expect(after.presentedQuestion).toEqual({ ...before.presentedQuestion, shownText: verified ? recovered : shown });
    expect(diagnosticEntries()[1]).toMatchObject({ assistantOutput: { responseSource: verified ? 'ai' : 'system' }, diagnostics: { outcome: 'failed' } });
    expect(await h.submit('全部で60分')).toMatchObject({ accepted: true, draftCandidates: [expect.objectContaining({})] });
    expect(h.local.readCheckpoint()!.vnext.state.graph.effortEstimates[0].minutes).toBe(60);
  });

  it('leaves marker-absent V5 failures on their unchanged discard/fail_turn path', async () => {
    let state = createInitialPlanningState(WEEK);
    const prepare = vi.fn(); const discard = vi.fn(); const failed = vi.fn();
    const result: WeeklyPlanningTurnExecutionResult = { state: createInitialPlanningIntakeState(), message: '反映できませんでした。', draftCandidates: [],
      failure: { code: 'stable_v5_provider_failure', userMessage: '反映できませんでした。', traceCode: 'stable_v5_provider_error',
        diagnostics: { attemptCount: 1, repairAttempted: false, validationErrorCategories: [], providerErrorCategory: 'provider_error' } } };
    const session = createWeeklyPlanningControllerSession(OWNER, WEEK, CONVERSATION);
    expect(await submitWeeklyPlanningControlledTurn({ session, ownerId: OWNER, userText: '合成入力', now: () => NOW,
      getState: () => state, dispatch: action => { state = weeklyPlanningReducer(state, action); return state; }, execute: async () => result,
      prepareExecutionCommit: prepare, discardExecutionResult: discard, onFailedTurn: failed })).toEqual({ accepted: true, draftCandidates: [] });
    expect(prepare).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ reason: 'failed', result }));
    expect(failed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ result, error: expect.objectContaining({ name: 'stable_v5_provider_error' }) }));
    expect(state).toEqual(weeklyPlanningReducer(weeklyPlanningReducer(createInitialPlanningState(WEEK), {
      type: 'begin_turn', pending: discard.mock.calls[0][0].pending, userMessage: state.messages[0],
    }), { type: 'fail_turn', pending: discard.mock.calls[0][0].pending, assistantMessage: state.messages[1] }));
  });

  it('rolls the staged failure presentation back if fail_turn publication throws', async () => {
    const h = harness({ providerFails: true,
      createRenderer: () => ({ render: async () => ({ status: 'rendered', text: '反映していません。', rawResponse: '', recoveryVerified: true }) }),
      beforeDispatch: action => { if (action.type === 'fail_turn') throw new Error('synthetic UI persistence failure'); } });
    await expect(h.submit('数学を30分')).rejects.toThrow('synthetic UI persistence failure');
    expect(h.local.checkpoint.read()).toBeNull();
    expect(h.getState().messages.map(message => message.role)).toEqual(['user']);
  });

  it.each([true, false])('sends the actual re-presentation to Jev for a subsequent ordinal answer (verified=%s)', async verified => {
    let fullReadings = 0;
    const original = '数学: 残りを8枚にする / 終わった量を13枚にする、どちらですか？';
    const recovery = '反映していません。数学: 終わった量を13枚にする / 残りを8枚にする、どちらですか？';
    const choice = createWeeklyPlanningVNextOptionChoicePort({
      policy: { id: 'frozen-test-policy', calibrationEvidenceId: 'synthetic-dev', rules: [
        { menuKind: 'leaves', optionCount: 3, depth: 0, minimumTopProbability: 0.91, minimumMargin: 0.82 }] },
      client: { proxyUrl: 'https://synthetic.invalid', getToken: async () => 'synthetic-only-token',
        semanticPolicy: { calibrationEvidenceId: 'synthetic-dev', maximumConditionChange: 0.36, maximumIndependentMeaning: 0.69 },
        transport: async (_url, init) => {
          const request = JSON.parse(String(init?.body)).decisionContext.request as CandidateChoiceWireRequest;
          if (request.wholeUtterance === '…') throw new Error('synthetic choice unavailable');
          expect(request.wholeUtterance).toBe('前者です');
          expect(request.context.presentedQuestion).toBe(verified ? recovery : original);
          // Synthetic model evaluation of the displayed order: recovery deliberately reverses it.
          const optionId = verified ? 'completed_follows_remaining' : 'remaining_follows_progress';
          const selected = request.menu.options.find(option => option.kind === 'leaf' && option.candidate.tuple.optionId === optionId)!;
          return Response.json({ status: 'evaluated', catalogVersion: CANDIDATE_CHOICE_CATALOG_VERSION,
            requestId: request.requestId, selectionEpoch: request.selectionEpoch, candidateSetHash: request.candidateSetHash,
            nodeId: request.menu.nodeId, optionId: selected.id,
            probabilities: request.menu.options.map(option => ({ optionId: option.id, probability: option.id === selected.id ? 0.96 : 0.02 })),
            conditionChange: 0.1, independentMeaning: 0.2 });
        } },
    });
    const h = harness({ interpret: createWeeklyPlanningVNextOptionChoiceInterpreter({ choice, scope: { ownerId: OWNER, conversationId: CONVERSATION },
      fullReading: async () => ++fullReadings === 1
        ? reading([task, work('total', 'scope_total', 20), work('done', 'completed', 12), work('left', 'remaining', 7)])
        : { status: 'failed', reason: 'provider_error', errors: [], metrics: { calls: 1, repairs: 0, latencyMs: 1 } } }),
    createRenderer: () => ({ render: async input => input.recovery
      ? verified ? { status: 'rendered', text: recovery, rawResponse: '', recoveryVerified: true }
        : { status: 'fallback', reason: 'recovery_verification_failed', rawResponse: '' }
      : { status: 'rendered', text: original, rawResponse: '' } }) });
    await h.submit('全部20枚、12枚済み、残り7枚');
    const before = h.local.readCheckpoint()!.vnext.state;
    await h.submit('…');
    expect(h.local.readCheckpoint()!.vnext.state).toEqual(before);
    await h.submit('前者です');
    expect(fullReadings).toBe(2);
    const graph = h.local.readCheckpoint()!.vnext.state.graph;
    const active = new Set(graph.factLifecycles.filter(fact => fact.status === 'active').map(fact => fact.factId));
    const workloads = graph.workloads.filter(work => active.has(work.id));
    expect(workloads.find(work => work.quantityRole === 'remaining')!.amount).toBe(verified ? 7 : 8);
    expect(workloads.find(work => work.quantityRole === 'completed')!.amount).toBe(verified ? 13 : 12);
    expect(h.results[2].failure).toBeUndefined();
    expect(h.results[2].debugTraceEvents).toEqual(expect.arrayContaining([expect.objectContaining({ stage: 'semantic_validation_result',
      data: expect.objectContaining({ parsedDocument: expect.objectContaining({ metrics: expect.objectContaining({ optionChoice: expect.objectContaining({ reason: 'selected' }) }) }) }) })]));
  });

  it.each([false, true])('persists generated Jev metrics and renderer input through append failure, reload and Worker (oversized=%s)', async oversized => {
    let evaluations = 0;
    const choice = createWeeklyPlanningVNextOptionChoicePort({
      policy: { id: 'frozen-test-policy', calibrationEvidenceId: 'synthetic-dev', rules: [
        { menuKind: 'leaves', optionCount: 3, depth: 0, minimumTopProbability: 0.91, minimumMargin: 0.82 }] },
      client: { proxyUrl: 'https://synthetic.invalid', getToken: async () => 'synthetic-only-token',
        semanticPolicy: { calibrationEvidenceId: 'synthetic-dev', maximumConditionChange: 0.36, maximumIndependentMeaning: 0.69 },
        transport: async (_url, init) => {
          const request = JSON.parse(String(init?.body)).decisionContext.request as CandidateChoiceWireRequest;
          evaluations += 1;
          const selected = request.menu.options.find(option => option.kind !== 'none')!;
          return Response.json({ status: 'evaluated', catalogVersion: CANDIDATE_CHOICE_CATALOG_VERSION,
            requestId: request.requestId, selectionEpoch: request.selectionEpoch, candidateSetHash: request.candidateSetHash,
            nodeId: request.menu.nodeId, optionId: selected.id,
            probabilities: request.menu.options.map(option => ({ optionId: option.id, probability: option.id === selected.id ? 0.96 : 0.02 })),
            conditionChange: 0.1, independentMeaning: 0.2 });
        } },
    });
    const interpreter = createWeeklyPlanningVNextOptionChoiceInterpreter({ scope: { ownerId: OWNER, conversationId: CONVERSATION }, choice,
      fullReading: async () => reading([task, work('total', 'scope_total', 20), work('done', 'completed', 12), work('left', 'remaining', 7)]) });
    const h = harness({ interpret: async input => {
      const interpreted = await interpreter(input);
      // A future diagnostic field must cross the generic evidence path without schema edits.
      Object.assign(interpreted.metrics, { futureGatewaySentinel: 'keep-future-vnext-field',
        ...(oversized ? { futureLargeGatewayField: 'x'.repeat(48 * 1024) } : {}) });
      return interpreted;
    }, createRenderer: () => ({ render: async input => ({ status: 'rendered', text: input.requiredLabels.join(' / '), rawResponse: 'synthetic-renderer-raw' }) }) });
    await h.submit('全部20枚、12枚済み、残り7枚');
    failAppend = true;
    await h.submit('最初の選択肢で');
    expect(evaluations).toBe(1);
    const queued = listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION });
    expect(queued).toHaveLength(1);
    expect(queued[0].input.debugTraceEvents).toEqual(h.results[1].debugTraceEvents);
    const expected = h.results[1].debugTraceEvents!.find(event => event.stage === 'semantic_validation_result')!;
    expect(expected.data).toMatchObject({ parsedDocument: { metrics: { optionChoice: { reason: 'selected', margin: 0.94,
      probabilities: expect.arrayContaining([{ optionId: 'none', probability: 0.02 }]), conditionChange: 0.1, independentMeaning: 0.2 } } } });
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace({ ...queued[0].input, requestId: 'retry-after-reload', debugTraceEvents: [] });
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toEqual([]);
    const write = writes[1]; const entry = write.entries.find(entry => entry.kind === 'turn_diagnostic')!;
    if (entry.kind !== 'turn_diagnostic') throw new Error('missing retried turn diagnostic');
    const expectedChoice = (expected.data as { parsedDocument: { metrics: { optionChoice: unknown } } }).parsedDocument.metrics.optionChoice;
    expect(entry.aiInterpreter.structuredResults).toHaveLength(1);
    expect(entry.aiInterpreter.structuredResults[0].structuredResult).toMatchObject({ metrics: { optionChoice: expectedChoice } });
    const text = JSON.stringify(entry);
    expect(text).toContain('keep-future-vnext-field');
    expect(text).toContain('frozen-test-policy');
    expect(text).toContain('synthetic-renderer-raw');
    expect(text).toContain('0.94');
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const server = prepareWeeklyPlanningTraceServerWrite({ session: write.session as unknown as Record<string, unknown>,
      entries: write.entries as unknown as Record<string, unknown>[] }, { token: `wpt_${'a'.repeat(43)}`, epoch: '105' },
    { sessionId: 'weekly-trace-423e4567-e89b-52d3-a456-426614174000', logicalConversationId: CONVERSATION }, NOW);
    expect(server.entries).toHaveLength(1);
    expect(server.entries[0].aiInterpreter).toMatchObject({ structuredResults: [expect.objectContaining({
      structuredResult: expect.objectContaining({ metrics: expect.objectContaining({ optionChoice: expectedChoice }) }),
    })] });
    expect(JSON.stringify(server.entries[0])).toContain('keep-future-vnext-field');
    expect(measureWeeklyPlanningTraceJsonBytes(server.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    if (oversized) expect(JSON.stringify(server.entries[0])).toContain('truncat');
  });
});
