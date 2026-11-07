import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEntryDurationMinutes } from '../../../../lib/entryTimeRange';
import { createWeeklyPlanningStableV5DialoguePrompt } from '../../dialogue/weeklyPlanningStableV5DialoguePrompt';
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
import { buildWeeklyPlanningVNextTurnPayload, createWeeklyPlanningVNextRuntimeGateway } from './weeklyPlanningVNextRuntimeGateway';
import { createWeeklyPlanningTurnRequestContext } from '../../application/weeklyPlanningTemporalContext';
import type { ExecuteWeeklyPlanningTurnRuntimeParams } from '../../application/weeklyPlanningTurnRuntimeGateway';
import type { WeeklyPlanningVNextExperimentalPorts } from './weeklyPlanningVNextExperimentalSession';
import { createWeeklyPlanningVNextOptionChoiceInterpreter } from './weeklyPlanningVNextOptionChoice';
import { createWeeklyPlanningVNextOptionChoicePort } from './weeklyPlanningVNextOptionChoiceBrowserPort';

const OWNER = 'synthetic-gateway-owner'; const WEEK = '2026-11-02'; const NOW = `${WEEK}T00:00:00.000Z`;
const CONVERSATION = 'weekly-conversation-423e4567-e89b-52d3-a456-426614174000';
const EMPTY: VNextTurnDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };
const task: VNextAddFact = { kind: 'task', localId: 'task', category: 'study', title: '数学' };
const work = (id: string, role: 'remaining' | 'scope_total' | 'completed', amount: number, unitCode = 'page'): VNextAddFact => ({
  kind: 'workload', localId: id, taskRef: { localId: 'task' }, componentRef: null, quantityRole: role, amount,
  unitCode, unitLabel: unitCode === 'minute' ? '分' : '枚', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
} as VNextAddFact);
const reading = (add: VNextAddFact[], answer: Extract<WeeklyPlanningVNextInterpretation, { status: 'interpreted' }>['answer'] = null): WeeklyPlanningVNextInterpretation => ({
  status: 'interpreted', planningIntent: 'create_plan' as const, delta: { ...EMPTY, add }, answer, metrics: { calls: 1, repairs: 0, latencyMs: 1 },
});

let restore: () => void;
let writes: { session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }[];
let failAppend: boolean;
let appendAttempts: typeof writes;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
  restore = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  resetWeeklyPlanningStableV5TraceRuntimeForTest(); resetWeeklyPlanningStableV5DebugTraceForTest();
  writes = []; appendAttempts = []; failAppend = false;
  const repository = createInMemoryWeeklyPlanningTraceRepository();
  setWeeklyPlanningTraceRepositoryForTests({ ...repository, async appendEntries(write) {
    appendAttempts.push(structuredClone(write));
    if (failAppend) { failAppend = false; throw new Error('synthetic append failure'); }
    writes.push(structuredClone(write));
  } });
});
afterEach(() => { resetWeeklyPlanningStableV5TraceRuntimeForTest(); resetWeeklyPlanningStableV5DebugTraceForTest();
  setWeeklyPlanningTraceRepositoryForTests(undefined); vi.useRealTimers(); restore(); });

function harness(options: { interpret?: WeeklyPlanningVNextInterpreter; createRenderer?: WeeklyPlanningVNextExperimentalPorts['createRenderer'];
  nativeReadings?: unknown[]; nativeReading?: unknown; providerFails?: boolean; planningIntent?: 'create_plan' | 'discuss'; beforeDispatch?: (action: WeeklyPlanningAction) => void } = {}) {
  const local = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: createMemoryStorageHarness().storage });
  let state = createInitialPlanningState(WEEK);
  const controller = createWeeklyPlanningControllerSession(OWNER, WEEK, CONVERSATION);
  const requests: unknown[] = [];
  const results: WeeklyPlanningTurnExecutionResult[] = [];
  const client: WeeklyPlanningVNextExperimentalPorts['client'] = { async createChatCompletion(input) {
    requests.push(structuredClone(input));
    if (options.providerFails) throw new Error('synthetic provider unavailable');
    const response = options.nativeReadings ? options.nativeReadings.shift() : options.nativeReading
      ?? { planningIntent: options.planningIntent ?? 'create_plan', conversationActs: [], delta: { ...EMPTY, add: [task, work('work', 'remaining', 30, 'minute')] }, answer: null };
    return JSON.stringify(typeof response === 'function' ? response(input) : response);
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
  it.each([false, true])('#1005 persists answer-plus-request evidence through outbox reload and Worker (large=%s)', async large => {
    const quote = 'この条件で今週の予定案を作って';
    let wire: unknown;
    const h = harness({ nativeReadings: [
      { planningIntent: 'discuss', conversationActs: [], delta: { ...EMPTY, add: [task, work('work', 'remaining', 8)] }, answer: null },
      (request: { messages: { content: string }[] }) => {
        const context = JSON.parse(request.messages[1].content);
        wire = { planningIntent: 'create_plan', conversationActs: [], delta: EMPTY,
          planningRequestEvidence: { quote, questionKey: context.presentedQuestion.key },
          answer: { kind: 'estimate_minutes', optionId: null, minutes: 40, per: 'whole_work' } };
        return wire;
      },
    ], createRenderer: () => {
      const renderer = createWeeklyPlanningStableV5DialogueRendererCore({ createChatCompletion: successfulWeeklyPlanningRendererCompletion });
      return { render(input) {
        Object.assign(input.communication!, { futurePlanningRequestSentinel: 'keep-planning-request',
          ...(large ? { futureLargePlanningRequestDetails: 'x'.repeat(48 * 1024) } : {}) });
        return renderer.render(input);
      } };
    } });
    await h.submit('数学プリントは残り8枚です');
    const questionKey = h.local.readCheckpoint()!.vnext.presentedQuestion!.questionKey;
    failAppend = true;
    expect(await h.submit(`全部で40分です。${quote}`)).toMatchObject({ accepted: true,
      draftCandidates: [expect.objectContaining({ approvalStatus: 'unapproved' })] });
    const result = h.results[1];
    const sent = h.requests[1] as { messages: { role: string; content: string }[] };
    expect(result.debugTraceEvents!.find(event => event.stage === 'semantic_provider_request')!.data).toMatchObject({
      request: { messages: sent.messages }, requestBytes: new TextEncoder().encode(JSON.stringify(sent)).byteLength });
    const [queued] = listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION });
    expect(queued.input.debugTraceEvents).toEqual(result.debugTraceEvents);
    const attempted = appendAttempts[appendAttempts.length - 1];
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toHaveLength(1);
    await recordWeeklyPlanningStableV5TurnTrace({ ...queued.input, requestId: 'planning-request-retry', debugTraceEvents: [] });
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toEqual([]);
    const write = writes.find(write => write.entries.some(entry => entry.requestId === queued.input.requestId))!;
    expect(write.entries).toEqual(attempted.entries);
    const entry = write.entries[0];
    if (entry.kind !== 'turn_diagnostic') throw new Error('missing planning request diagnostic');
    expect(entry.diagnostics.outcome).toBe('preview_ready');
    expect(entry.aiInterpreter.rawResponses[0].text).toBe(JSON.stringify(wire));
    expect(entry.aiInterpreter.structuredResults[0].structuredResult).toMatchObject({ planningIntent: 'create_plan',
      planningRequestEvidence: { quote, questionKey }, authorizationDecision: { authorized: true } });
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const server = prepareWeeklyPlanningTraceServerWrite({ session: write.session as unknown as Record<string, unknown>,
      entries: write.entries as unknown as Record<string, unknown>[] }, { token: `wpt_${'a'.repeat(43)}`, epoch: '106' },
    { sessionId: 'weekly-trace-423e4567-e89b-52d3-a456-426614174000', logicalConversationId: CONVERSATION }, NOW);
    expect(server.entries).toHaveLength(1);
    expect(server.entries[0].aiInterpreter).toMatchObject({ structuredResults: [expect.objectContaining({
      structuredResult: expect.objectContaining({ planningRequestEvidence: { quote, questionKey } }),
    })] });
    expect(JSON.stringify(server.entries[0])).toContain('keep-planning-request');
    expect(measureWeeklyPlanningTraceJsonBytes(server.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    if (large) {
      const diagnostic = server.entries[0].diagnostics as { dialogueRenderer: { request: { promptContext: unknown } } };
      expect(diagnostic.dialogueRenderer.request.promptContext).toMatchObject({ traceTruncated: true,
        jsonHead: expect.any(String), jsonTail: expect.any(String) });
      expect(JSON.stringify(server.entries[0])).not.toContain('x'.repeat(48 * 1024));
    }
    expect(JSON.stringify(h.local.readCheckpoint()!.vnext)).not.toContain('"planningRequestEvidence"');
  });

  it.each([false, true])('#868 persists a timed registration retained across an independent question through outbox and Worker (large=%s)', async large => {
    const first = { planningIntent: 'create_plan', conversationActs: [{ kind: 'request_event_registration', targetRef: { localId: 'club' } }],
      answer: null, delta: { ...EMPTY, add: [task, work('work', 'remaining', 8),
        { kind: 'task', localId: 'club', category: 'non_study', title: '部活' },
        { kind: 'temporal_constraint', localId: 'fixed', taskRef: { localId: 'club' }, targetRef: { localId: 'club' },
          constraintKind: 'fixed_interval', constraintLevel: 'hard', dateExpression: '2026-11-03', namedTimePeriod: null,
          startTime: '16:00', endTime: '17:00', precision: 'exact' }] } };
    const answer = { planningIntent: 'unknown', conversationActs: [], delta: EMPTY,
      answer: { kind: 'estimate_minutes', optionId: null, minutes: 40, per: 'whole_work' } };
    const h = harness({ nativeReadings: [first, answer], createRenderer: () => {
      const renderer = createWeeklyPlanningStableV5DialogueRendererCore({ createChatCompletion: successfulWeeklyPlanningRendererCompletion });
      return { render(input) {
        Object.assign(input.communication!, { futureTimedRegistrationSentinel: 'keep-timed-registration',
          ...(large ? { futureLargeTimedRegistrationMetadata: 'x'.repeat(48 * 1024) } : {}) });
        return renderer.render(input);
      } };
    } });
    expect(await h.submit('数学は残り8枚の予定案を作って。火曜16時から17時の部活も登録して')).toMatchObject({ accepted: true, draftCandidates: [] });
    expect(h.local.readCheckpoint()!.vnext.state.pendingEventRegistrationTargetIds)
      .toEqual([h.local.readCheckpoint()!.vnext.state.graph.tasks.find(task => task.title === '部活')!.id]);
    failAppend = true;
    const submitted = await h.submit('全部で40分です');
    expect(submitted.accepted).toBe(true);
    expect(submitted.draftCandidates.map(candidate => candidate.source).sort()).toEqual(['fixed_event_registration', 'weekly_exam_prep']);
    expect(submitted.draftCandidates.every(candidate => candidate.approvalStatus === 'unapproved')).toBe(true);
    expect(h.local.readCheckpoint()!.vnext.state.pendingEventRegistrationTargetIds ?? []).toEqual([]);
    const result = h.results[1];
    const sent = h.requests[1] as { messages: { role: string; content: string }[] };
    expect(result.debugTraceEvents!.find(event => event.stage === 'semantic_provider_request')!.data).toMatchObject({
      request: { messages: sent.messages }, requestBytes: new TextEncoder().encode(JSON.stringify(sent)).byteLength });
    const [queued] = listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION });
    expect(queued.input.debugTraceEvents).toEqual(result.debugTraceEvents);
    const attempted = appendAttempts[appendAttempts.length - 1];
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toHaveLength(1);
    await recordWeeklyPlanningStableV5TurnTrace({ ...queued.input, requestId: 'timed-registration-retry', debugTraceEvents: [] });
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toEqual([]);
    const write = writes.find(write => write.entries.some(entry => entry.requestId === queued.input.requestId))!;
    expect(write.entries).toEqual(attempted.entries);
    const entry = write.entries[0];
    if (entry.kind !== 'turn_diagnostic') throw new Error('missing retained timed-registration diagnostic');
    expect(entry.diagnostics).toMatchObject({ outcome: 'preview_ready', previewCount: 2 });
    expect(entry.aiInterpreter.rawResponses[0].text).toBe(JSON.stringify(answer));
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const server = prepareWeeklyPlanningTraceServerWrite({ session: write.session as unknown as Record<string, unknown>,
      entries: write.entries as unknown as Record<string, unknown>[] }, { token: `wpt_${'a'.repeat(43)}`, epoch: '106' },
    { sessionId: 'weekly-trace-423e4567-e89b-52d3-a456-426614174000', logicalConversationId: CONVERSATION }, NOW);
    expect(server.entries).toHaveLength(1);
    expect(JSON.stringify(server.entries[0])).toContain('keep-timed-registration');
    expect(measureWeeklyPlanningTraceJsonBytes(server.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    if (large) {
      const diagnostic = server.entries[0].diagnostics as { dialogueRenderer: { request: { promptContext: unknown } } };
      expect(diagnostic.dialogueRenderer.request.promptContext).toMatchObject({ traceTruncated: true,
        jsonHead: expect.any(String), jsonTail: expect.any(String) });
      expect(JSON.stringify(server.entries[0])).not.toContain('x'.repeat(48 * 1024));
    }
  });

  it.each([false, true].flatMap(large => [true, false].map(withUncertainty => ({ large, withUncertainty }))))(
    'persists year evidence and a required period question through outbox and Worker (large=$large, uncertainty=$withUncertainty)', async ({ large, withUncertainty }) => {
    const reason = 'The omitted end year may mean a much longer period ending next year';
    const native = { planningIntent: 'create_plan', conversationActs: [], answer: null, delta: { ...EMPTY, add: [
      { kind: 'planning_window', localId: 'period', windowKind: 'absolute',
        value: '2026-11-03/2027-09-07', start: '2026-11-03', end: '2027-09-07', yearBasis: {
          start: { origin: 'context', source: 'current_date', reference: WEEK },
          end: { origin: 'inferred', source: 'user_text', reference: '9/7' },
        } },
      task, work('daily-work', 'remaining', 45, 'minute'),
      ...(withUncertainty ? [{ kind: 'uncertainty', localId: 'year-question', targetRef: { localId: 'period' }, field: 'planning_window', reason }] : []),
    ] } };
    const h = harness({ nativeReading: native, createRenderer: () => {
      const delegate = createWeeklyPlanningStableV5DialogueRendererCore({ createChatCompletion: successfulWeeklyPlanningRendererCompletion });
      return { render(input) {
        expect(input.questionCode).toBe('semantic_uncertainty');
        expect(input.questionIntent).toMatchObject({ resolutionKind: 'semantic_clarification',
          ambiguityField: 'planning_window', ambiguityReason: withUncertainty ? reason : '計画期間の開始年・終了年の根拠が未確認です。' });
        Object.assign(input.communication!, { futureWindowSentinel: 'keep-future-window-confirmation',
          ...(large ? { futureLargeWindowMetadata: 'x'.repeat(48 * 1024) } : {}) });
        return delegate.render(input);
      } };
    } });
    failAppend = true;
    expect(await h.submit('明日から9/7までの数学の予定を作って')).toEqual({ accepted: true, draftCandidates: [] });
    if (withUncertainty) expect(h.local.readCheckpoint()!.vnext.state.graph.uncertainties[0]).toMatchObject({ field: 'planning_window', reason });
    else expect(h.local.readCheckpoint()!.vnext.state.graph.uncertainties).toEqual([]);
    expect(h.local.readCheckpoint()!.vnext.state.graph.planningWindows[0].yearBasis?.end)
      .toMatchObject({ origin: 'inferred', source: 'user_text', reference: '9/7', year: 2027, verified: false });
    expect(h.local.readCheckpoint()!.vnext.presentedQuestion?.questionKey).toContain('semantic_uncertainty');
    expect(h.results[0].debugTraceEvents!.find(event => event.stage === 'semantic_provider_request')!.data).toMatchObject({
      request: { messages: (h.requests[0] as { messages: unknown[] }).messages },
    });
    const queued = listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION });
    expect(queued).toHaveLength(1);
    expect(JSON.stringify(queued[0].input)).toContain(withUncertainty ? reason : 'yearBasis');
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace({ ...queued[0].input, requestId: 'window-confirmation-retry', debugTraceEvents: [] });
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toEqual([]);
    const write = writes.find(write => write.entries.some(entry => entry.requestId === queued[0].input.requestId))!;
    const entry = write.entries.find(entry => entry.kind === 'turn_diagnostic' && entry.requestId === queued[0].input.requestId)!;
    const serialized = JSON.stringify(entry);
    expect(serialized).toContain(withUncertainty ? reason : 'yearBasis');
    expect(serialized).toContain('semantic_uncertainty');
    expect(serialized).toContain('keep-future-window-confirmation');
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const server = prepareWeeklyPlanningTraceServerWrite({ session: write.session as unknown as Record<string, unknown>,
      entries: write.entries as unknown as Record<string, unknown>[] }, { token: `wpt_${'a'.repeat(43)}`, epoch: '106' },
    { sessionId: 'weekly-trace-423e4567-e89b-52d3-a456-426614174000', logicalConversationId: CONVERSATION }, NOW);
    expect(server.entries).toHaveLength(1);
    expect(JSON.stringify(server.entries[0])).toContain(withUncertainty ? reason : 'yearBasis');
    expect(JSON.stringify(server.entries[0])).toContain('keep-future-window-confirmation');
    expect(measureWeeklyPlanningTraceJsonBytes(server.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    if (large) expect(JSON.stringify(server.entries[0])).toContain('truncat');
  });

  it.each([false, true])('persists an inherited session duration and its accepted preview through outbox reload and Worker (large=%s)', async large => {
    const initial = { planningIntent: 'create_plan', conversationActs: [], answer: null, delta: { ...EMPTY, add: [{ ...task, title: '暗記' },
      { kind: 'study_context', localId: 'study', taskRef: { localId: 'task' }, purpose: 'self_study',
        activityKind: 'memorization_retrieval', contextLabel: null },
      { ...work('words', 'remaining', 100), unitCode: 'word', unitLabel: '語' },
      { kind: 'effort_estimate', localId: 'rate', taskRef: { localId: 'task' }, targetRef: { localId: 'words' },
        effortKind: 'duration_per_unit', minutes: 2, unitCode: 'word', unitLabel: '語', precision: 'exact' },
      { kind: 'effort_estimate', localId: 'session', taskRef: { localId: 'task' }, targetRef: { localId: 'task' },
        effortKind: 'session_duration', minutes: 20, unitCode: null, unitLabel: null, precision: 'exact' },
    ] } };
    const contexts: unknown[] = [];
    let acceptedWire: unknown;
    const h = harness({ nativeReadings: [initial, (request: { messages: { content: string }[] }) => {
      const input = JSON.parse(request.messages[1].content);
      acceptedWire = { planningIntent: 'unknown', conversationActs: [], delta: EMPTY,
        answer: { kind: 'proposal_decision', proposalId: input.presentedQuestion.proposal.id, decision: 'accept' } };
      return acceptedWire;
    }], createRenderer: () => {
      const renderer = createWeeklyPlanningStableV5DialogueRendererCore({ createChatCompletion: successfulWeeklyPlanningRendererCompletion });
      return { render(input) {
        Object.assign(input.communication!, { futureKnownSessionSentinel: 'keep-known-session-evidence',
          ...(large ? { futureKnownSessionDetails: 'x'.repeat(48 * 1024) } : {}) });
        contexts.push(structuredClone(input));
        return renderer.render(input);
      } };
    } });
    await h.submit('暗記100語、1語2分、1回20分で計画して');
    expect(h.local.readCheckpoint()!.vnext.state.learningStrategyProposalRecords[0].status).toBe('pending');
    failAppend = true;
    await h.submit('分散学習の提案を採用して');
    const result = h.results[1];
    const persisted = h.local.readCheckpoint()!.vnext;
    expect(persisted.presentedQuestion).toBeNull();
    expect(persisted.preview!.blocks.length).toBeGreaterThan(0);
    expect(result.draftCandidates.every(candidate => candidate.durationMinutes === 20)).toBe(true);
    expect(persisted.preview!.blocks.map(({ date, startTime, endTime }) => ({ date, startTime, endTime }))).toEqual(
      result.draftCandidates.map(({ date, startTime, endTime }) => ({ date, startTime, endTime })));
    expect(persisted.state.graph.effortEstimates.filter(fact => fact.kind === 'session_duration')).toMatchObject([
      { minutes: 20, targetFactId: persisted.state.graph.tasks[0].id },
    ]);
    expect(result.draftCandidates.every(candidate => candidate.approvalStatus === 'unapproved')).toBe(true);
    expect(result.dialogueRendererTrace?.request?.promptContext).toEqual(contexts[1]);
    expect(result.dialogueRendererTrace?.response?.status).toBe('rendered');
    const sent = h.requests[1] as { messages: { content: string }[] };
    expect(result.debugTraceEvents!.find(event => event.stage === 'semantic_provider_request')!.data).toMatchObject({
      request: { messages: sent.messages }, requestBytes: new TextEncoder().encode(JSON.stringify(sent)).byteLength });
    const [queued] = listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION });
    expect(queued).toBeDefined();
    const attempted = appendAttempts[appendAttempts.length - 1];
    expect(measureWeeklyPlanningTraceJsonBytes(attempted.entries[0]))
      .toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toHaveLength(1);
    await recordWeeklyPlanningStableV5TurnTrace({ ...queued.input, requestId: 'retry-known-session', debugTraceEvents: [] });
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toEqual([]);
    const write = writes.find(write => write.entries.some(entry => entry.requestId === queued.input.requestId))!;
    expect(write.entries).toEqual(attempted.entries);
    const server = prepareWeeklyPlanningTraceServerWrite({ session: write.session as unknown as Record<string, unknown>,
      entries: write.entries as unknown as Record<string, unknown>[] }, { token: `wpt_${'a'.repeat(43)}`, epoch: '107' },
    { sessionId: 'weekly-trace-423e4567-e89b-52d3-a456-426614174000', logicalConversationId: CONVERSATION }, NOW);
    expect(server.entries).toHaveLength(1);
    expect(server.entries[0].aiInterpreter).toMatchObject({ rawResponses: [expect.objectContaining({ text: JSON.stringify(acceptedWire) })] });
    const diagnostic = server.entries[0].diagnostics as { dialogueRenderer: { request: { promptContext: unknown } } };
    if (!large) expect(diagnostic.dialogueRenderer.request.promptContext).toEqual(contexts[1]);
    else {
      const originalBytes = new TextEncoder().encode(JSON.stringify(contexts[1])).byteLength;
      expect(diagnostic.dialogueRenderer.request.promptContext).toMatchObject({ traceTruncated: true, originalBytes,
        jsonHead: expect.stringContaining('keep-known-session-evidence'), jsonTail: expect.any(String) });
    }
    const saved = JSON.stringify(server.entries[0]);
    expect(saved).toContain('keep-known-session-evidence');
    expect(measureWeeklyPlanningTraceJsonBytes(server.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    if (large) expect(saved).not.toContain('x'.repeat(48 * 1024));
  });

  it.each(['fixed', 'completed', 'time_budget'].flatMap(kind => [false, true].map(large => ({ kind, large }))))
  ('Stage B: persists ready memory planning through failed append, reload and Worker (kind=$kind, large=$large)', async ({ kind, large }) => {
    const completed = kind === 'completed';
    const timeBudget = kind === 'time_budget';
    const wire = completed || timeBudget ? { planningIntent: 'create_plan', conversationActs: [], answer: null,
      delta: { ...EMPTY, add: [
        { ...task, title: '英単語' },
        ...(completed ? [
          { ...work('scope', 'scope_total', 100, 'word'), unitLabel: '語' },
          { ...work('done', 'completed', 100, 'word'), unitLabel: '語' },
        ] : [work('time-budget', 'remaining', 60, 'minute')]),
        { kind: 'study_context', localId: 'study', taskRef: { localId: 'task' }, purpose: 'self_study',
          activityKind: 'memorization_retrieval', contextLabel: null },
        { kind: 'task', localId: 'math', category: 'study', title: '数学' },
        { ...work('math-time', 'remaining', 60, 'minute'), taskRef: { localId: 'math' } },
      ] } } : { planningIntent: 'discuss', conversationActs: [{ kind: 'request_event_registration', targetRef: null }],
      answer: null, delta: { ...EMPTY, add: [task, work('pages', 'remaining', 10),
        { kind: 'study_context', localId: 'study', taskRef: { localId: 'task' }, purpose: 'self_study',
          activityKind: 'memorization_retrieval', contextLabel: null },
        { kind: 'temporal_constraint', localId: 'fixed', taskRef: { localId: 'task' }, targetRef: { localId: 'task' },
          constraintKind: 'fixed_interval', constraintLevel: 'hard', dateExpression: '2026-11-03',
          namedTimePeriod: null, startTime: '10:00', endTime: '11:00', precision: 'exact' }] } };
    const rendererInputs: unknown[] = [];
    const h = harness({ nativeReading: wire, createRenderer: () => {
      const renderer = createWeeklyPlanningStableV5DialogueRendererCore({ createChatCompletion: successfulWeeklyPlanningRendererCompletion });
      return { render(input) {
        Object.assign(input.communication!, { futureFixedQuantitySentinel: 'keep-fixed-quantity-evidence',
          ...(large ? { futureFixedQuantityDetails: 'x'.repeat(48 * 1024) } : {}) });
        rendererInputs.push(structuredClone(input));
        return renderer.render(input);
      } };
    } });
    failAppend = true;
    const submitted = await h.submit(timeBudget ? '今週は英単語60分と数学60分の予定案を作って'
      : completed ? '英単語100語は全部終わった。今週は数学60分の予定案を作って'
      : '火曜10時から11時に数学の残り10枚を進める予定を入れて');
    if (completed || timeBudget) {
      expect(h.local.readCheckpoint()!.vnext.state.graph.workloads.map(fact => fact.amount)).toEqual(completed ? [100, 100, 60] : [60, 60]);
      expect(submitted.draftCandidates.reduce((minutes, candidate) => minutes
        + getEntryDurationMinutes(candidate.startTime, candidate.endTime), 0)).toBe(timeBudget ? 120 : 60);
    } else {
      expect(submitted.draftCandidates).toEqual([expect.objectContaining({ source: 'fixed_event_registration',
        date: '2026-11-03', startTime: '10:00', endTime: '11:00' })]);
    }
    expect(h.local.readCheckpoint()!.vnext.state.graph.effortEstimates).toEqual([]);
    expect(h.local.readCheckpoint()!.vnext.state.learningStrategyProposalRecords).toEqual([]);
    expect(h.local.readCheckpoint()!.vnext.presentedQuestion).toBeNull();
    const result = h.results[0];
    expect(h.getState().previewCandidates).toEqual(result.draftCandidates);
    expect(result.draftCandidates[0].approvalStatus).toBe('unapproved');
    expect(result.dialogueRendererTrace?.request?.promptContext).toEqual(rendererInputs[0]);
    expect(result.dialogueRendererTrace?.response?.status).toBe('rendered');
    const sent = h.requests[0] as { messages: { role: string; content: string }[] };
    expect(result.debugTraceEvents!.find(event => event.stage === 'semantic_provider_request')!.data).toMatchObject({
      request: { messages: sent.messages }, requestBytes: new TextEncoder().encode(JSON.stringify(sent)).byteLength });
    const [queued] = listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION });
    expect(queued).toBeDefined();
    const attempted = appendAttempts[appendAttempts.length - 1];
    expect(measureWeeklyPlanningTraceJsonBytes(attempted.entries[0]))
      .toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toHaveLength(1);
    await recordWeeklyPlanningStableV5TurnTrace({ ...queued.input, requestId: 'retry-fixed-quantity', debugTraceEvents: [] });
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toEqual([]);
    const write = writes.find(write => write.entries.some(entry => entry.requestId === queued.input.requestId))!;
    expect(write.entries).toEqual(attempted.entries);
    const server = prepareWeeklyPlanningTraceServerWrite({ session: write.session as unknown as Record<string, unknown>,
      entries: write.entries as unknown as Record<string, unknown>[] }, { token: `wpt_${'a'.repeat(43)}`, epoch: '106' },
    { sessionId: 'weekly-trace-423e4567-e89b-52d3-a456-426614174000', logicalConversationId: CONVERSATION }, NOW);
    expect(server.entries).toHaveLength(1);
    expect(server.entries[0].aiInterpreter).toMatchObject({ rawResponses: [expect.objectContaining({ text: JSON.stringify(wire) })] });
    const diagnostic = server.entries[0].diagnostics as { dialogueRenderer: { request: { promptContext: unknown } } };
    if (!large) expect(diagnostic.dialogueRenderer.request.promptContext).toEqual(rendererInputs[0]);
    else {
      const originalBytes = new TextEncoder().encode(JSON.stringify(rendererInputs[0])).byteLength;
      if (completed || timeBudget) {
        // This ready-turn document fits after one source-value truncation.
        const truncated = diagnostic.dialogueRenderer.request.promptContext as { jsonHead: string; jsonTail: string };
        expect(truncated).toMatchObject({ traceTruncated: true, originalBytes,
          jsonHead: expect.stringContaining('keep-fixed-quantity-evidence'), jsonTail: expect.any(String) });
        expect(truncated.jsonTail.length).toBeGreaterThan(0);
        const sourceJson = JSON.stringify(rendererInputs[0]);
        expect(sourceJson.startsWith(truncated.jsonHead)).toBe(true);
        expect(sourceJson.endsWith(truncated.jsonTail)).toBe(true);
      } else {
        // Fixed registration also needs document-level truncation. The outer
        // wrapper must retain the raw source size in the first wrapper's head.
        expect(diagnostic.dialogueRenderer.request.promptContext).toMatchObject({ traceTruncated: true,
          jsonHead: expect.stringContaining(`"originalBytes":${originalBytes}`), jsonTail: expect.any(String) });
      }
    }
    const saved = JSON.stringify(server.entries[0]);
    expect(saved).toContain('keep-fixed-quantity-evidence');
    expect(measureWeeklyPlanningTraceJsonBytes(server.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    if (large) expect(saved).not.toContain('x'.repeat(48 * 1024));
  });

  it.each([
    { code: 'missing_effort_estimate', large: false }, { code: 'missing_effort_estimate', large: true },
    { code: 'missing_schedulable_work', large: false }, { code: 'missing_schedulable_work', large: true },
    { code: 'remaining_inconsistent', large: false }, { code: 'remaining_inconsistent', large: true },
    { code: 'same_or_distinct_work', large: false }, { code: 'same_or_distinct_work', large: true },
  ])('persists the third unanswered $code explanation through outbox reload and Worker (large=$large)', async ({ code, large }) => {
    const add: VNextAddFact[] = code === 'remaining_inconsistent'
      ? [task, work('total', 'scope_total', 20), work('done', 'completed', 12), work('left', 'remaining', 7)]
      : code === 'same_or_distinct_work' ? [task, work('pages', 'remaining', 10), work('minutes', 'remaining', 45, 'minute')]
        : code === 'missing_effort_estimate' ? [task, work('work', 'remaining', 8)] : [task];
    const initial = { planningIntent: 'discuss', conversationActs: [], answer: null,
      delta: { ...EMPTY, add } };
    const unanswered = { planningIntent: 'unknown', conversationActs: [], answer: null, delta: EMPTY };
    const contexts: unknown[] = [];
    const h = harness({ nativeReadings: [initial, unanswered, unanswered, unanswered], createRenderer: () => {
      const renderer = createWeeklyPlanningStableV5DialogueRendererCore({ async createChatCompletion(request) {
        const response = JSON.parse(await successfulWeeklyPlanningRendererCompletion(request));
        const prompt = JSON.parse(request.messages[1].content);
        response.text += (prompt.applicationDecision.relevantLabels ?? []).join(' / ');
        return JSON.stringify(response);
      } });
      return { render(input) {
        if (input.communication?.goal === 'explain_question') {
          Object.assign(input.communication, { futureRepeatedQuestionSentinel: 'keep-repeated-question-evidence',
            ...(large ? { futureRepeatedQuestionDetails: 'x'.repeat(48 * 1024) } : {}) });
          contexts.push(structuredClone(input));
        }
        return renderer.render(input);
      } };
    } });
    const initialText = code === 'remaining_inconsistent' ? '数学は全体20枚、完了12枚、残り7枚です。'
      : code === 'same_or_distinct_work' ? '数学は残り10枚、残り45分です。'
        : code === 'missing_effort_estimate' ? '数学を残り8枚やりたいです' : '今週は数学をやりたいです';
    await h.submit(initialText);
    const retained = h.local.readCheckpoint()!.vnext.state;
    await h.submit('わかりません');
    await h.submit('まだ決めていません');
    failAppend = true;
    expect(await h.submit('今は答えられません')).toEqual({ accepted: true, draftCandidates: [] });
    expect(h.local.readCheckpoint()!.vnext.state).toEqual(retained);
    expect(h.local.readCheckpoint()!.vnext.unansweredQuestionStreak?.count).toBe(3);
    expect(h.local.readCheckpoint()!.vnext.preview).toBeNull();
    const result = h.results[3];
    const choice = code === 'remaining_inconsistent'
      ? '全体から完了量を引いた残りと、入力された残量が一致しません。どの値を直すか選んでください。'
      : code === 'same_or_distinct_work'
        ? '複数の量や時間が、別々に行う作業なのか、同じ作業を表しているのかが未確定です。予定に含める作業を、表示した選択肢から選んでください。'
        : '所要時間はまだ分からないので、仮置きで予定を組んで見せて';
    expect(contexts).toHaveLength(1);
    expect(result.dialogueRendererTrace?.request?.promptContext).toMatchObject({
      questionCode: code, communication: { goal: 'explain_question', askQuestion: true },
      requiredLabels: expect.arrayContaining(code === 'remaining_inconsistent' || code === 'same_or_distinct_work'
        ? [choice] : ['何分くらい', choice, '後で決める']),
    });
    const messages = h.getState().messages;
    expect(messages[messages.length - 1]?.content).toContain(choice);
    const [queued] = listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION });
    expect(queued).toBeDefined();
    expect(queued.input.debugTraceEvents).toEqual(result.debugTraceEvents);
    const attempted = appendAttempts[appendAttempts.length - 1];
    expect(attempted.entries).toHaveLength(1);
    expect(measureWeeklyPlanningTraceJsonBytes(attempted.entries[0]))
      .toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toHaveLength(1);
    await recordWeeklyPlanningStableV5TurnTrace({ ...queued.input, requestId: 'repeated-question-retry', debugTraceEvents: [] });
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toEqual([]);
    const replayed = writes.find(write => write.entries.some(entry => entry.requestId === queued.input.requestId))!;
    expect(replayed.entries).toEqual(attempted.entries);
    const entry = replayed.entries[0];
    if (entry.kind !== 'turn_diagnostic') throw new Error('missing repeated-question diagnostic');
    const sent = h.requests[3] as { messages: { role: string; content: string }[] };
    const requestBytes = new TextEncoder().encode(JSON.stringify(sent)).byteLength;
    expect(result.debugTraceEvents!.find(event => event.stage === 'semantic_provider_request')!.data).toMatchObject({
      request: { messages: sent.messages }, requestBytes,
    });
    // Recent dialogue makes this native input exceed the per-message trace limit. Preserve
    // exact sent-request evidence above and explicit clipping in the persisted projection.
    const recorded = entry.aiInterpreter.input.requests[0];
    expect(recorded.requestBytes).toBe(requestBytes);
    const recordedContext = recorded.messages.find(message => message.role === 'user')!.content;
    expect(recordedContext).toContain(`"code":"${code}"`);
    expect(recordedContext).toContain('[trace truncated]');
    expect(entry.aiInterpreter.rawResponses[0].text).toBe(JSON.stringify(unanswered));
    expect(JSON.stringify(entry)).toContain('keep-repeated-question-evidence');
    expect(measureWeeklyPlanningTraceJsonBytes(entry))
      .toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const server = prepareWeeklyPlanningTraceServerWrite({ session: replayed.session as unknown as Record<string, unknown>,
      entries: replayed.entries as unknown as Record<string, unknown>[] }, { token: `wpt_${'a'.repeat(43)}`, epoch: '106' },
    { sessionId: 'weekly-trace-423e4567-e89b-52d3-a456-426614174000', logicalConversationId: CONVERSATION }, NOW);
    expect(server.entries).toHaveLength(1);
    const saved = JSON.stringify(server.entries[0]);
    expect(saved).toContain('keep-repeated-question-evidence');
    expect(saved).toContain('explain_question');
    expect(measureWeeklyPlanningTraceJsonBytes(server.entries[0]))
      .toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    if (large) {
      const renderer = server.entries[0].diagnostics as { dialogueRenderer: { request: { promptContext: unknown } } };
      expect(renderer.dialogueRenderer.request.promptContext).toMatchObject({ traceTruncated: true,
        originalBytes: new TextEncoder().encode(JSON.stringify(contexts[0])).byteLength,
        jsonHead: expect.any(String), jsonTail: expect.any(String) });
      expect(saved).not.toContain('x'.repeat(48 * 1024));
    }
  });

  it.each([
    { code: 'effort_inconsistent', large: false }, { code: 'effort_inconsistent', large: true },
    { code: 'completed_exceeds_total', large: false }, { code: 'completed_exceeds_total', large: true },
  ])('persists the third $code explanation through actual renderer, outbox reload and Worker (large=$large)', async ({ code, large }) => {
    const rendererRequests: { messages: readonly { content: string }[] }[] = [];
    const rendererInputs: unknown[] = [];
    const add: VNextAddFact[] = code === 'completed_exceeds_total'
      ? [task, work('total', 'scope_total', 10), work('done', 'completed', 12)]
      : [task, work('pages', 'remaining', 8),
      { kind: 'effort_estimate', localId: 'rate', taskRef: { localId: 'task' }, targetRef: { localId: 'pages' },
        effortKind: 'duration_per_unit', minutes: 5, unitCode: 'page', unitLabel: '枚', precision: 'exact' },
      { kind: 'effort_estimate', localId: 'total', taskRef: { localId: 'task' }, targetRef: { localId: 'pages' },
        effortKind: 'total_duration', minutes: 60, unitCode: null, unitLabel: null, precision: 'exact' }];
    const h = harness({ nativeReadings: [add, [], [], []].map(add => ({ planningIntent: 'discuss',
      conversationActs: [], delta: { ...EMPTY, add }, answer: null })), createRenderer: () => {
      const renderer = createWeeklyPlanningStableV5DialogueRendererCore({ async createChatCompletion(request) {
        rendererRequests.push(structuredClone(request));
        const response = JSON.parse(await successfulWeeklyPlanningRendererCompletion(request));
        const prompt = JSON.parse(request.messages[1].content);
        response.text += prompt.applicationDecision.relevantLabels.join(' / ');
        return JSON.stringify(response);
      } });
      return { render(input) {
        Object.assign(input.communication!, { futureEffortConflictSentinel: 'keep-effort-conflict-guidance',
          ...(large ? { futureLargeEffortConflictField: 'z'.repeat(48 * 1024) } : {}) });
        rendererInputs.push(structuredClone(input));
        return renderer.render(input);
      } };
    } });
    await h.submit(code === 'completed_exceeds_total'
      ? '数学プリントは全体10枚、12枚完了です。' : '数学プリントは残り8枚、1枚5分、全体60分です。');
    expect(h.results[0].dialogueRendererTrace?.response?.status,
      JSON.stringify(h.results[0].dialogueRendererTrace?.response)).toBe('rendered');
    await h.submit('うーん'); await h.submit('まだ分からない');
    failAppend = true;
    await h.submit('そうですね');
    const result = h.results[3];
    const sent = rendererRequests[rendererRequests.length - 1];
    const prompt = JSON.parse(sent.messages[1].content);
    expect(prompt.applicationDecision).toMatchObject({ questionCode: code,
      communication: { goal: 'explain_question' }, relevantLabels: expect.arrayContaining(code === 'completed_exceeds_total'
        ? ['全体10枚', '完了12枚'] : ['1枚あたり5分', '全体60分']) });
    expect(result.dialogueRendererTrace?.response?.status).toBe('rendered');
    const actualInput = rendererInputs[3] as Parameters<typeof createWeeklyPlanningStableV5DialoguePrompt>[0];
    const actualPrompt = createWeeklyPlanningStableV5DialoguePrompt(actualInput);
    expect(sent.messages).toEqual([{ role: 'system', content: actualPrompt.systemPrompt },
      { role: 'user', content: actualPrompt.userPrompt }]);
    expect(result.dialogueRendererTrace?.request?.promptContext).toEqual(actualInput);
    const [queued] = listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION });
    expect(queued).toBeDefined();
    const failedWrite = appendAttempts[appendAttempts.length - 1];
    expect(measureWeeklyPlanningTraceJsonBytes(failedWrite.entries[0]))
      .toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toHaveLength(1);
    await recordWeeklyPlanningStableV5TurnTrace({ ...queued.input, requestId: 'retry-effort-conflict', debugTraceEvents: [] });
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toEqual([]);
    const write = writes.find(write => write.entries.some(entry => entry.requestId === queued.input.requestId))!;
    expect(write.entries).toEqual(failedWrite.entries);
    const server = prepareWeeklyPlanningTraceServerWrite({ session: write.session as unknown as Record<string, unknown>,
      entries: write.entries as unknown as Record<string, unknown>[] }, { token: `wpt_${'a'.repeat(43)}`, epoch: '106' },
    { sessionId: 'weekly-trace-423e4567-e89b-52d3-a456-426614174000', logicalConversationId: CONVERSATION }, NOW);
    expect(server.entries).toHaveLength(1);
    if (!large) {
      const diagnostic = server.entries[0].diagnostics as { dialogueRenderer: { request: { promptContext: unknown } } };
      expect(diagnostic.dialogueRenderer.request.promptContext).toEqual(actualInput);
    }
    const saved = JSON.stringify(server.entries[0]);
    expect(saved).toContain('keep-effort-conflict-guidance');
    expect(saved).toContain('explain_question');
    expect(saved).toContain(code);
    expect(measureWeeklyPlanningTraceJsonBytes(server.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    if (large) {
      const diagnostic = server.entries[0].diagnostics as { dialogueRenderer: { request: { promptContext: unknown } } };
      expect(diagnostic.dialogueRenderer.request.promptContext).toMatchObject({ traceTruncated: true,
        originalBytes: new TextEncoder().encode(JSON.stringify(rendererInputs[3])).byteLength });
      expect(saved).not.toContain('z'.repeat(48 * 1024));
    }
  });

  it('omits in-flight optimistic actuals from the shared local/durable payload without changing the wire shape', () => {
    const actuals = [{ id: 'saving-one' }, { id: 'saved-one' }, { id: 'saving-two' }] as ExecuteWeeklyPlanningTurnRuntimeParams['actuals'];
    const input = { snapshot: createInitialPlanningState(WEEK), pending: { conversationId: CONVERSATION,
      requestId: 'request-1', baseRevision: 0 }, userText: '同じ週を再送', selectedDate: WEEK, userId: OWNER,
      plans: [], actuals, scheduleTemplates: [] } as unknown as ExecuteWeeklyPlanningTurnRuntimeParams;
    const clock = createWeeklyPlanningTurnRequestContext({ startedAtIso: NOW, timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' });
    const payload = buildWeeklyPlanningVNextTurnPayload(input, null, null, clock, new Set(['saving-one', 'saving-two']));
    expect(payload.input.actuals?.map(actual => actual.id)).toEqual(['saved-one']);
    expect(input.actuals?.map(actual => actual.id)).toEqual(['saving-one', 'saved-one', 'saving-two']);
    expect(payload.input).not.toHaveProperty('savingActualRecordIds');
    expect(Object.keys(payload)).toEqual(['core', 'checkpoint', 'legacyV5Checkpoint', 'weekStartDate', 'input']);
  });

  it.each([false, true])('Stage B: persists ordinary scoped session durations through outbox reload and Worker (large=%s)', async large => {
    const wire = { planningIntent: 'create_plan', conversationActs: [], answer: null, delta: { ...EMPTY, add: [task,
      { kind: 'component', localId: 'a', taskRef: { localId: 'task' }, parentComponentRef: null, role: 'chapter', label: '第1章' },
      { kind: 'component', localId: 'b', taskRef: { localId: 'task' }, parentComponentRef: null, role: 'chapter', label: '第2章' },
      { ...work('a-work', 'remaining', 2, 'session'), unitLabel: '回', componentRef: { localId: 'a' } },
      { ...work('b-work', 'remaining', 2, 'session'), unitLabel: '回', componentRef: { localId: 'b' } },
      { kind: 'effort_estimate', localId: 'default', taskRef: { localId: 'task' }, targetRef: { localId: 'task' },
        effortKind: 'session_duration', minutes: 20, unitCode: null, unitLabel: null, precision: 'exact' },
      { kind: 'effort_estimate', localId: 'detail', taskRef: { localId: 'task' }, targetRef: { localId: 'a' },
        effortKind: 'session_duration', minutes: 30, unitCode: null, unitLabel: null, precision: 'exact' },
    ] } };
    const inputs: unknown[] = [];
    const h = harness({ nativeReading: wire, createRenderer: () => {
      const renderer = createWeeklyPlanningStableV5DialogueRendererCore({ createChatCompletion: successfulWeeklyPlanningRendererCompletion });
      return { render(input) {
        Object.assign(input.communication!, { futureScopedSessionSentinel: 'keep-session-scope-evidence',
          ...(large ? { futureScopedSessionDetails: 'x'.repeat(48 * 1024) } : {}) });
        inputs.push(structuredClone(input)); return renderer.render(input);
      } };
    } });
    failAppend = true;
    const submitted = await h.submit('数学は各章を2回。普段は1回20分、第1章だけ30分で今週の予定案を作って');
    // The stated 60/40-minute work keeps the ordinary 10/5-minute estimate buffers.
    expect(submitted.draftCandidates.reduce((sum, item) => sum + getEntryDurationMinutes(item.startTime, item.endTime), 0)).toBe(115);
    expect(submitted.draftCandidates.every(item => item.approvalStatus === 'unapproved')).toBe(true);
    expect(h.getState().previewCandidates).toEqual(submitted.draftCandidates);
    const checkpoint = h.local.readCheckpoint()!.vnext;
    expect(checkpoint.presentedQuestion).toBeNull();
    expect(checkpoint.state.graph.effortEstimates.map(estimate => estimate.minutes)).toEqual([20, 30]);
    expect(h.results[0].dialogueRendererTrace?.request?.promptContext).toEqual(inputs[0]);
    expect(h.results[0].dialogueRendererTrace?.response?.status).toBe('rendered');
    const sent = h.requests[0] as { messages: { role: string; content: string }[] };
    expect(h.results[0].debugTraceEvents!.find(event => event.stage === 'semantic_provider_request')!.data).toMatchObject({
      request: { messages: sent.messages }, requestBytes: new TextEncoder().encode(JSON.stringify(sent)).byteLength });
    const [queued] = listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION });
    expect(queued).toBeDefined();
    const attempted = appendAttempts[appendAttempts.length - 1];
    expect(measureWeeklyPlanningTraceJsonBytes(attempted.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toHaveLength(1);
    await recordWeeklyPlanningStableV5TurnTrace({ ...queued.input, requestId: 'retry-scoped-session', debugTraceEvents: [] });
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toEqual([]);
    const write = writes.find(write => write.entries.some(entry => entry.requestId === queued.input.requestId))!;
    expect(write.entries).toEqual(attempted.entries);
    const server = prepareWeeklyPlanningTraceServerWrite({ session: write.session as unknown as Record<string, unknown>,
      entries: write.entries as unknown as Record<string, unknown>[] }, { token: `wpt_${'a'.repeat(43)}`, epoch: '112' },
    { sessionId: 'weekly-trace-423e4567-e89b-52d3-a456-426614174000', logicalConversationId: CONVERSATION }, NOW);
    expect(server.entries).toHaveLength(1);
    expect(server.entries[0].aiInterpreter).toMatchObject({ rawResponses: [expect.objectContaining({ text: JSON.stringify(wire) })] });
    const diagnostic = server.entries[0].diagnostics as { dialogueRenderer: { request: { promptContext: unknown } } };
    if (!large) expect(diagnostic.dialogueRenderer.request.promptContext).toEqual(inputs[0]);
    else {
      const originalBytes = new TextEncoder().encode(JSON.stringify(inputs[0])).byteLength;
      const truncated = diagnostic.dialogueRenderer.request.promptContext as { originalBytes: number; jsonHead: string; jsonTail: string };
      expect(truncated).toMatchObject({ traceTruncated: true, jsonHead: expect.any(String), jsonTail: expect.any(String) });
      if (truncated.originalBytes === originalBytes) {
        expect(JSON.stringify(inputs[0]).startsWith(truncated.jsonHead)).toBe(true);
        expect(JSON.stringify(inputs[0]).endsWith(truncated.jsonTail)).toBe(true);
      } else expect(truncated.jsonHead).toContain(`"originalBytes":${originalBytes}`);
      expect(truncated.jsonTail.length).toBeGreaterThan(0);
    }
    const saved = JSON.stringify(server.entries[0]);
    expect(saved).toContain('keep-session-scope-evidence');
    expect(measureWeeklyPlanningTraceJsonBytes(server.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    if (large) expect(saved).not.toContain('x'.repeat(48 * 1024));
  });

  it('keeps successful placement and records the actual native request and renderer evidence', async () => {
    const h = harness();
    const submitted = await h.submit('数学を30分');
    expect(submitted).toMatchObject({ accepted: true, draftCandidates: [expect.objectContaining({})] });
    expect(h.local.readCheckpoint()!.vnext.state.graph.workloads[0].amount).toBe(30);
    const trace = diagnosticEntries()[0];
    expect(trace.diagnostics.outcome).toBe('preview_ready');
    expect(trace.diagnostics.error).toBeNull();
    expect(trace.assistantOutput.responseSource).toBe('ai');
    expect(trace.aiInterpreter.structuredResults[0].structuredResult).toMatchObject({ planningIntent: 'create_plan',
      authorizationDecision: { authorized: true, draftGenerationIntent: h.local.readCheckpoint()!.vnext.state.draftGenerationIntent } });
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

  it.each([
    { phase: 'invitation', oversized: false }, { phase: 'invitation', oversized: true },
    { phase: 'decline', oversized: false }, { phase: 'decline', oversized: true },
  ] as const)('persists native $phase evidence through failed append, reload and Worker (oversized=$oversized)', async ({ phase, oversized }) => {
    const initial = { planningIntent: 'discuss', conversationActs: [], delta: EMPTY, answer: null };
    const declined = { ...initial, conversationActs: [{ kind: 'decline_additional_work', targetRef: null }] };
    const rendererContexts: unknown[] = [];
    const h = harness({ nativeReadings: [initial, declined], createRenderer: () => {
      const renderer = createWeeklyPlanningStableV5DialogueRendererCore({ createChatCompletion: successfulWeeklyPlanningRendererCompletion });
      return { render(input) {
        // A future, unregistered renderer field must survive the generic transport; the large
        // sibling must be bounded explicitly, without dropping this turn or its semantic reading.
        Object.assign(input.communication!, { futureInvitationSentinel: 'retain-optional-evidence',
          ...(oversized ? { futureInvitationDetails: 'z'.repeat(48 * 1024) } : {}) });
        rendererContexts.push(structuredClone(input));
        return renderer.render(input);
      } };
    } });
    const isDecline = phase === 'decline';
    if (isDecline) await h.submit('今週の計画を相談したいです');
    failAppend = true;
    expect(await h.submit(isDecline ? '追加する作業はありません' : '今週の計画を相談したいです'))
      .toEqual({ accepted: true, draftCandidates: [] });
    const persisted = h.local.readCheckpoint()!.vnext;
    expect(persisted.state.optionalInvitationClosed).toBe(isDecline);
    expect(persisted.state.draftGenerationIntent).toBe('not_requested');
    expect(persisted.presentedQuestion === null).toBe(isDecline);
    expect(persisted.preview).toBeNull();
    const result = h.results[h.results.length - 1];
    const sent = h.requests[h.requests.length - 1] as { messages: { role: string; content: string }[] };
    const wire = isDecline ? declined : initial;
    const events = result.debugTraceEvents!;
    // The collector bounds deep schema data intentionally; exact sent messages and original
    // request byte count prove which invocation was captured without demanding unbounded schema.
    expect(events.find(event => event.stage === 'semantic_provider_request')!.data).toMatchObject({
      request: { messages: sent.messages }, requestBytes: new TextEncoder().encode(JSON.stringify(sent)).byteLength });
    expect(events.find(event => event.stage === 'semantic_provider_response')!.data).toMatchObject({ rawResponse: JSON.stringify(wire) });
    expect(result.dialogueRendererTrace!.request!.promptContext).toMatchObject(isDecline
      ? { questionCode: null, communication: { askQuestion: false, statusReason: 'no_additional_work' } }
      : { questionCode: 'missing_schedulable_work', questionTarget: null,
        questionIntent: { kind: 'schedulable_work_detail', mode: 'missing_task_identity' }, communication: { askQuestion: true } });
    if (isDecline) expect(JSON.parse(sent.messages[1].content).presentedQuestion)
      .toMatchObject({ code: 'missing_schedulable_work', taskId: null, optionalInvitation: { intent: 'missing_task_identity' } });

    const [queued] = listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION });
    expect(queued).toBeDefined();expect(queued.input.debugTraceEvents).toEqual(events);
    const failedWrite = appendAttempts[appendAttempts.length - 1];
    expect(failedWrite.entries).toHaveLength(1);
    expect(measureWeeklyPlanningTraceJsonBytes(failedWrite.entries[0]))
      .toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toHaveLength(1);
    await recordWeeklyPlanningStableV5TurnTrace({ ...queued.input, requestId: 'retry-optional-evidence', debugTraceEvents: [] });
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toEqual([]);
    const write = writes.find(write => write.entries.some(entry => entry.requestId === queued.input.requestId))!;
    expect(write.entries).toEqual(failedWrite.entries);
    const entry = write.entries[0];
    if (entry.kind !== 'turn_diagnostic') throw new Error('missing optional-invitation diagnostic');
    expect(entry.aiInterpreter.input.requests).toHaveLength(1);
    expect(entry.aiInterpreter.input.requests[0]).toMatchObject({
      requestBytes: new TextEncoder().encode(JSON.stringify(sent)).byteLength,
      messages: expect.arrayContaining([sent.messages[1]]),
    });
    expect(entry.aiInterpreter.rawResponses[0].text).toBe(JSON.stringify(wire));
    expect(entry.aiInterpreter.structuredResults[0].structuredResult).toMatchObject({ conversationActs: wire.conversationActs,
      authorizationDecision: { authorized: false, draftGenerationIntent: 'not_requested' } });
    expect(JSON.stringify(entry)).toContain('retain-optional-evidence');
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const server = prepareWeeklyPlanningTraceServerWrite({ session: write.session as unknown as Record<string, unknown>,
      entries: write.entries as unknown as Record<string, unknown>[] }, { token: `wpt_${'a'.repeat(43)}`, epoch: '106' },
    { sessionId: 'weekly-trace-423e4567-e89b-52d3-a456-426614174000', logicalConversationId: CONVERSATION }, NOW);
    expect(server.entries).toHaveLength(1);
    expect(server.entries[0].aiInterpreter).toMatchObject({ rawResponses: [expect.objectContaining({ text: JSON.stringify(wire) })],
      structuredResults: [expect.objectContaining({ structuredResult: expect.objectContaining({ conversationActs: wire.conversationActs }) })] });
    const saved = JSON.stringify(server.entries[0]);
    expect(saved).toContain('retain-optional-evidence');
    expect(saved).toContain(isDecline ? 'no_additional_work' : 'missing_task_identity');
    expect(measureWeeklyPlanningTraceJsonBytes(server.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    if (oversized) {
      const renderer = server.entries[0].diagnostics as { dialogueRenderer: { request: { promptContext: unknown } } };
      const originalBytes = new TextEncoder().encode(JSON.stringify(rendererContexts[rendererContexts.length - 1])).byteLength;
      expect(renderer.dialogueRenderer.request.promptContext).toMatchObject({ traceTruncated: true, originalBytes,
        jsonHead: expect.any(String), jsonTail: expect.any(String) });
      expect(saved).not.toContain('z'.repeat(48 * 1024));
    }
  });

  it.each([false, true])('persists #951 label repair requests and quotations through outbox reload and Worker (large=%s)', async large => {
    const native = (title: string, unitLabel: string) => ({ planningIntent: 'create_plan', conversationActs: [], answer: null,
      delta: { ...EMPTY, add: [{ kind: 'task', localId: 'cards', category: 'study', title },
        { kind: 'workload', localId: 'cards-left', taskRef: { localId: 'cards' }, componentRef: null,
          quantityRole: 'remaining', amount: 10, unitCode: 'custom', unitLabel, rangeStart: null, rangeEnd: null,
          perOccurrence: false, periodExpression: null },
        { kind: 'effort_estimate', localId: 'cards-rate', taskRef: { localId: 'cards' }, targetRef: { localId: 'cards-left' },
          effortKind: 'duration_per_unit', minutes: 8, unitCode: 'custom', unitLabel, precision: 'exact' }] } });
    const initial = native('卡片', '张');
    const repaired = { ...native('カードを進める作業', '枚'), labelEvidence: [{ localId: 'cards', quote: 'カード' }] };
    const interpret = createWeeklyPlanningVNextProviderInterpreter();
    const h = harness({ nativeReadings: [initial, repaired], interpret: async input => {
      const result = await interpret(input);
      Object.assign(result.metrics, { futureLabelEvidenceSentinel: 'retain-future-label-evidence',
        ...(large ? { futureLargeLabelDiagnostic: 'x'.repeat(48 * 1024) } : {}) });
      return result;
    } });
    failAppend = true;
    await h.submit('カードは残り10枚で、1枚8分です。この内容で今週の計画を作ってください。');
    const accepted = h.local.readCheckpoint()!.vnext;
    expect(accepted.state.graph.tasks).toMatchObject([{ title: 'カードを進める作業' }]);
    expect(JSON.stringify(accepted)).not.toContain('labelEvidence');
    expect(h.requests).toHaveLength(2);
    const requests = h.requests as { messages: unknown[]; responseFormat: { json_schema: { name: string } } }[];
    expect(requests.map(request => request.responseFormat.json_schema.name))
      .toEqual(['weekly_planning_vnext_native_v1', 'weekly_planning_vnext_label_repair_v1']);
    const events = h.results[0].debugTraceEvents!;
    const sent = events.filter(event => event.stage === 'semantic_provider_request');
    expect(sent).toHaveLength(2);
    sent.forEach((event, index) => expect(event.data).toMatchObject({ request: { messages: requests[index].messages },
      requestBytes: new TextEncoder().encode(JSON.stringify(requests[index])).byteLength }));
    expect(events.filter(event => event.stage === 'semantic_provider_response').map(event => (event.data as { rawResponse: string }).rawResponse))
      .toEqual([JSON.stringify(initial), JSON.stringify(repaired)]);
    const queued = listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION });
    expect(queued).toHaveLength(1);
    expect(queued[0].input.debugTraceEvents).toEqual(events);
    const failed = appendAttempts[0];
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace({ ...queued[0].input, requestId: 'label-repair-retry', debugTraceEvents: [] });
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toEqual([]);
    const write = writes[0];
    expect(write.entries).toEqual(failed.entries);
    const entry = write.entries[0];
    if (entry.kind !== 'turn_diagnostic') throw new Error('missing label repair diagnostic');
    expect(entry.aiInterpreter.input.requests).toHaveLength(2);
    requests.forEach((request, index) => expect(entry.aiInterpreter.input.requests[index])
      .toMatchObject({ requestBytes: new TextEncoder().encode(JSON.stringify(request)).byteLength }));
    expect(entry.aiInterpreter.rawResponses.map(response => response.text)).toEqual([JSON.stringify(initial), JSON.stringify(repaired)]);
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const server = prepareWeeklyPlanningTraceServerWrite({ session: write.session as unknown as Record<string, unknown>,
      entries: write.entries as unknown as Record<string, unknown>[] }, { token: `wpt_${'a'.repeat(43)}`, epoch: '106' },
    { sessionId: 'weekly-trace-423e4567-e89b-52d3-a456-426614174000', logicalConversationId: CONVERSATION }, NOW);
    expect(server.entries).toHaveLength(1);
    const persisted = JSON.stringify(server.entries[0]);
    expect(persisted).toContain('labelEvidence');
    expect(persisted).toContain('retain-future-label-evidence');
    expect(measureWeeklyPlanningTraceJsonBytes(server.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    if (large) expect(persisted).toContain('truncat');
  });

  it.each([false, true])('persists actual intent and authorization presentation through append failure/reload/Worker (large=%s)', async large => {
    const sent: Record<string, unknown>[] = [];
    const h = harness({ planningIntent: 'discuss', createRenderer: () => {
      const renderer = createWeeklyPlanningStableV5DialogueRendererCore({ async createChatCompletion(request) {
        const prompt = JSON.parse(request.messages[1].content); sent.push(prompt);
        expect(prompt.applicationDecision.communication.previewAuthorization).toMatchObject({ status: 'authorization_required' });
        return successfulWeeklyPlanningRendererCompletion(request);
      } });
      return { render(input) {
        const authorization = (input.communication as unknown as { previewAuthorization: Record<string, unknown> }).previewAuthorization;
        Object.assign(authorization, { futureAuthorizationSentinel: 'keep-future-authorization',
          ...(large ? { futureLargeAuthorizationMetadata: 'x'.repeat(48 * 1024) } : {}) });
        return renderer.render(input);
      } };
    } });
    failAppend = true;
    expect(await h.submit('数学の作業量は30分です。')).toEqual({ accepted: true, draftCandidates: [] });
    expect(sent).toHaveLength(1);
    expect(h.local.readCheckpoint()!.vnext.state.draftGenerationIntent).toBe('not_requested');
    const queued = listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION });
    expect(queued).toHaveLength(1);
    expect(queued[0].input.debugTraceEvents).toEqual(h.results[0].debugTraceEvents);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace({ ...queued[0].input, requestId: 'authorization-retry-after-reload', debugTraceEvents: [] });
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toEqual([]);
    const write = writes[0];
    const entry = write.entries.find(entry => entry.kind === 'turn_diagnostic')!;
    if (entry.kind !== 'turn_diagnostic') throw new Error('missing authorization diagnostic');
    expect(entry.diagnostics.outcome).toBe('needs_scope');
    expect(entry.aiInterpreter.structuredResults[0].structuredResult).toMatchObject({ planningIntent: 'discuss',
      authorizationDecision: { planningIntent: 'discuss', authorized: false, previousDraftGenerationIntent: 'not_requested',
        draftGenerationIntent: h.local.readCheckpoint()!.vnext.state.draftGenerationIntent } });
    expect(JSON.stringify(entry)).toContain('authorization_required');
    expect(JSON.stringify(entry)).toContain('keep-future-authorization');
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const server = prepareWeeklyPlanningTraceServerWrite({ session: write.session as unknown as Record<string, unknown>,
      entries: write.entries as unknown as Record<string, unknown>[] }, { token: `wpt_${'a'.repeat(43)}`, epoch: '106' },
    { sessionId: 'weekly-trace-423e4567-e89b-52d3-a456-426614174000', logicalConversationId: CONVERSATION }, NOW);
    expect(server.entries).toHaveLength(1);
    expect(server.entries[0].aiInterpreter).toMatchObject({ structuredResults: [expect.objectContaining({ structuredResult: expect.objectContaining({
      planningIntent: 'discuss', authorizationDecision: expect.objectContaining({ authorized: false, draftGenerationIntent: 'not_requested' }),
    }) })] });
    expect(JSON.stringify(server.entries[0])).toContain('keep-future-authorization');
    expect(measureWeeklyPlanningTraceJsonBytes(server.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    if (large) expect(JSON.stringify(server.entries[0])).toContain('truncat');
  });

  it.each([
    { large: false, timeless: false }, { large: true, timeless: false },
    { large: false, timeless: true }, { large: true, timeless: true },
  ])('persists registration acts and their actual preview or clock question through outbox reload and Worker (large=$large, timeless=$timeless)', async ({ large, timeless }) => {
    const nativeReading = { planningIntent: 'discuss', conversationActs: [{ kind: 'request_event_registration', targetRef: { localId: 'club' } }],
      answer: null, delta: { ...EMPTY, add: [{ kind: 'task', localId: 'club', category: 'non_study', title: '部活' },
        ...(timeless ? [{ kind: 'task_date_rule', localId: 'date', taskRef: { localId: 'club' }, targetRef: { localId: 'club' },
          ruleKind: 'allowed_date', dateExpression: '2026-11-03', constraintLevel: 'hard' }] : [{ kind: 'temporal_constraint', localId: 'fixed', taskRef: { localId: 'club' }, targetRef: { localId: 'club' },
          constraintKind: 'fixed_interval', constraintLevel: 'hard', dateExpression: '2026-11-03', namedTimePeriod: null,
          startTime: '16:00', endTime: '17:30', precision: 'exact' }])] } };
    const h = harness({ nativeReading, createRenderer: () => {
      const renderer = createWeeklyPlanningStableV5DialogueRendererCore({ createChatCompletion: successfulWeeklyPlanningRendererCompletion });
      return { render(input) {
        if (timeless) expect(input.questionIntent).toMatchObject({ kind: 'resolution_question', resolutionKind: 'commitment_time_bounds',
          requestedInformation: ['commitment_start_and_end_time'] });
        else expect(input.communication?.eventRegistration?.candidates).toEqual([expect.objectContaining({ source: 'fixed_event_registration',
          startTime: '16:00', endTime: '17:30', durationMinutes: 90 })]);
        Object.assign(timeless ? input.questionIntent! : input.communication!.eventRegistration!, { futureRegistrationSentinel: 'keep-future-registration',
          ...(large ? { futureLargeRegistrationMetadata: 'x'.repeat(48 * 1024) } : {}) });
        return renderer.render(input);
      } };
    } });
    failAppend = true;
    const submitted = await h.submit(timeless ? '火曜の部活を予定に登録して' : '火曜16時から17時半の部活を予定に登録して');
    expect(submitted).toMatchObject(timeless ? { accepted: true } : { accepted: true,
      draftCandidates: [expect.objectContaining({ source: 'fixed_event_registration', startTime: '16:00', endTime: '17:30' })] });
    if (timeless) {
      expect(h.local.readCheckpoint()!.vnext.state.pendingEventRegistrationTargetIds).toHaveLength(1);
      expect(h.local.readCheckpoint()!.vnext.preview).toBeNull();
    }
    const providerMessages = (h.requests[0] as { messages: { role: string; content: string }[] }).messages;
    expect(providerMessages[0].content).toContain('Distinguish a shared planning day from a date limited to one task.');
    expect(h.results[0].debugTraceEvents!.find(event => event.stage === 'semantic_provider_request')!.data).toMatchObject({
      request: { messages: (h.requests[0] as { messages: unknown[] }).messages },
    });
    const queued = listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION });
    expect(queued).toHaveLength(1); expect(queued[0].input.debugTraceEvents).toEqual(h.results[0].debugTraceEvents);
    const queuedRequest = queued[0].input.debugTraceEvents!.find(event => event.stage === 'semantic_provider_request')!;
    expect(queuedRequest.data).toMatchObject({ request: { messages: providerMessages } });
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace({ ...queued[0].input, requestId: 'registration-retry-after-reload', debugTraceEvents: [] });
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toEqual([]);
    const write = writes[0]; const entry = write.entries.find(entry => entry.kind === 'turn_diagnostic')!;
    if (entry.kind !== 'turn_diagnostic') throw new Error('missing registration diagnostic');
    // VNext questions live in its checkpoint; a consultation keeps the initial compatibility intake idle.
    expect(entry.diagnostics.outcome).toBe(timeless ? 'idle' : 'preview_ready');
    expect(entry.aiInterpreter.structuredResults[0].structuredResult).toMatchObject({ conversationActs: nativeReading.conversationActs,
      authorizationDecision: { authorized: false, draftGenerationIntent: 'not_requested' } });
    const evidence = timeless ? 'commitment_start_and_end_time' : 'fixed_event_registration';
    expect(JSON.stringify(entry)).toContain(evidence); expect(JSON.stringify(entry)).toContain('keep-future-registration');
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const server = prepareWeeklyPlanningTraceServerWrite({ session: write.session as unknown as Record<string, unknown>,
      entries: write.entries as unknown as Record<string, unknown>[] }, { token: `wpt_${'a'.repeat(43)}`, epoch: '106' },
    { sessionId: 'weekly-trace-423e4567-e89b-52d3-a456-426614174000', logicalConversationId: CONVERSATION }, NOW);
    expect(server.entries).toHaveLength(1);
    expect(server.entries[0].aiInterpreter).toMatchObject({ structuredResults: [expect.objectContaining({ structuredResult: expect.objectContaining({
      conversationActs: nativeReading.conversationActs,
    }) })] });
    expect(JSON.stringify(server.entries[0])).toContain('keep-future-registration');
    expect(JSON.stringify(server.entries[0])).toContain(evidence);
    // Full requests remain in the persistent outbox; diagnostics retain bounded evidence with explicit truncation.
    const storedInterpreter = server.entries[0].aiInterpreter as typeof entry.aiInterpreter;
    const storedPrompt = storedInterpreter.input.requests[0].messages[0].content;
    expect(storedPrompt).toContain('…[trace truncated]');
    const keptPrefix = storedPrompt.slice(0, storedPrompt.indexOf('…[trace truncated]'));
    expect(keptPrefix).not.toBe('');
    expect(providerMessages[0].content.startsWith(keptPrefix)).toBe(true);
    expect(storedInterpreter.input.requests[0].messages[1]).toEqual(providerMessages[1]);
    expect(server.entries[0].diagnostics).toMatchObject({ truncation: { applied: true,
      fields: expect.arrayContaining(['aiInterpreter.input.requests[0].messages[0].content']) } });
    expect(measureWeeklyPlanningTraceJsonBytes(server.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    if (large) expect(JSON.stringify(server.entries[0])).toContain('truncat');
  });

  it.each([false, true])('AB01 persists the newly authorized preview revision through outbox reload and Worker (large=%s)', async large => {
    const first = { planningIntent: 'discuss', conversationActs: [{ kind: 'request_event_registration', targetRef: { localId: 'club' } }],
      answer: null, delta: { ...EMPTY, add: [task, work('work', 'remaining', 60, 'minute'),
        { kind: 'task', localId: 'club', category: 'non_study', title: '部活' },
        { kind: 'temporal_constraint', localId: 'fixed', taskRef: { localId: 'club' }, targetRef: { localId: 'club' },
          constraintKind: 'fixed_interval', constraintLevel: 'hard', dateExpression: '2026-11-03', namedTimePeriod: null,
          startTime: '16:00', endTime: '17:30', precision: 'exact' }] } };
    const h = harness({ nativeReadings: [first, { planningIntent: 'create_plan', conversationActs: [], delta: EMPTY, answer: null }],
      createRenderer: () => {
        const renderer = createWeeklyPlanningStableV5DialogueRendererCore({ createChatCompletion: successfulWeeklyPlanningRendererCompletion });
        return { render(input) { Object.assign(input.communication!, { futurePreviewRevisionSentinel: 'keep-future-preview-revision',
          ...(large ? { futureLargePreviewMetadata: 'x'.repeat(48 * 1024) } : {}) }); return renderer.render(input); } };
      } });
    expect(await h.submit('部活を登録して。数学は60分です')).toMatchObject({ accepted: true,
      draftCandidates: [expect.objectContaining({ source: 'fixed_event_registration' })] });
    expect(h.local.readCheckpoint()!.vnext.state.graph.revision).toBe(1);
    failAppend = true;
    const submitted = await h.submit('数学の予定も作ってください');
    expect(submitted).toMatchObject({ accepted: true, draftCandidates: [expect.objectContaining({ source: 'weekly_exam_prep' })] });
    const revision = h.local.readCheckpoint()!.vnext.state.graph.revision; expect(revision).toBe(2);
    const queued = listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION }); expect(queued).toHaveLength(1);
    expect(queued[0].input.debugTraceEvents).toEqual(h.results[1].debugTraceEvents);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace({ ...queued[0].input, requestId: 'preview-revision-retry-after-reload', debugTraceEvents: [] });
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toEqual([]);
    // Retrying also records the retry turn; inspect the queued original request, not that notice.
    const write = writes.find(write => write.entries.some(entry => entry.requestId === queued[0].input.requestId))!;
    const entry = write.entries.find(entry => entry.kind === 'turn_diagnostic' && entry.requestId === queued[0].input.requestId)!;
    if (entry.kind !== 'turn_diagnostic') throw new Error('missing AB01 diagnostic');
    expect(entry.diagnostics).toMatchObject({ outcome: 'preview_ready', previewCount: 1 });
    expect(entry.aiInterpreter.structuredResults[0].structuredResult).toMatchObject({ graphRevision: revision, planningIntent: 'create_plan',
      authorizationDecision: { authorized: true, draftGenerationIntent: 'user_authorized' } });
    expect(JSON.stringify(entry)).toContain('keep-future-preview-revision');
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const server = prepareWeeklyPlanningTraceServerWrite({ session: write.session as unknown as Record<string, unknown>,
      entries: write.entries as unknown as Record<string, unknown>[] }, { token: `wpt_${'a'.repeat(43)}`, epoch: '106' },
    { sessionId: 'weekly-trace-423e4567-e89b-52d3-a456-426614174000', logicalConversationId: CONVERSATION }, NOW);
    expect(server.entries).toHaveLength(1);
    expect(server.entries[0].aiInterpreter).toMatchObject({ structuredResults: [expect.objectContaining({ structuredResult: expect.objectContaining({
      graphRevision: revision, planningIntent: 'create_plan', authorizationDecision: expect.objectContaining({ authorized: true }),
    }) })] });
    expect(JSON.stringify(server.entries[0])).toContain('keep-future-preview-revision');
    expect(measureWeeklyPlanningTraceJsonBytes(server.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    if (large) expect(JSON.stringify(server.entries[0])).toContain('truncat');
  });

  it.each([
    { repeat: false, large: false }, { repeat: false, large: true },
    { repeat: true, large: false }, { repeat: true, large: true },
  ])('persists V5 busy-only handoff and exact renderer instruction (repeat=$repeat, large=$large)', async ({ repeat, large }) => {
    const native = { planningIntent: 'discuss', conversationActs: [], answer: null, delta: { ...EMPTY, add: [
      { kind: 'task', localId: 'club', category: 'non_study', title: 'ゼミ' },
      { kind: 'temporal_constraint', localId: 'fixed', taskRef: { localId: 'club' }, targetRef: { localId: 'club' },
        constraintKind: 'fixed_interval', constraintLevel: 'hard', dateExpression: '2026-11-03', namedTimePeriod: null,
        startTime: '16:00', endTime: '17:30', precision: 'exact' },
    ] } };
    let expectedPrompt = ''; let actualInstruction: unknown;
    const h = harness({ nativeReadings: [native, { planningIntent: 'discuss', conversationActs: [], delta: EMPTY, answer: null }],
      createRenderer: () => {
        const renderer = createWeeklyPlanningStableV5DialogueRendererCore({ async createChatCompletion(request) {
          const prompt = JSON.parse(request.messages[1].content);
          actualInstruction = prompt.request;
          expect(prompt.request).toEqual(JSON.parse(expectedPrompt).request);
          const result = JSON.parse(await successfulWeeklyPlanningRendererCompletion(request));
          const manual = prompt.applicationDecision.communication.manualEntry;
          if (manual) result.text += `「${manual.navigationLabel}」から「${manual.actionLabel}」で入力してください。`;
          return JSON.stringify(result);
        } });
        return { render(input) {
          Object.assign(input.communication!, { futureHandoffSentinel: 'keep-future-handoff',
            ...(large ? { futureLargeHandoffMetadata: 'x'.repeat(48 * 1024) } : {}) });
          expectedPrompt = createWeeklyPlanningStableV5DialoguePrompt(input).userPrompt;
          return renderer.render(input);
        } };
      } });
    if (repeat) await h.submit('11月3日16時から17時半までゼミがあります。');
    failAppend = true;
    expect(await h.submit(repeat ? 'わかりました' : '11月3日16時から17時半までゼミがあります。')).toEqual({ accepted: true, draftCandidates: [] });
    const result = h.results[h.results.length - 1];
    const status = repeat ? 'no_additional_work' : 'fixed_event_manual_entry';
    expect(result.dialogueRendererTrace!.request!.promptContext).toMatchObject({ communication: { statusReason: status, askQuestion: false } });
    expect(actualInstruction).toBeDefined();
    if (!repeat) {
      expect(result.message).toContain('「予定」から「予定を追加」');
      expect(result.dialogueRendererTrace!.request!.promptContext).toMatchObject({ communication: {
        manualEntry: { navigationLabel: '予定', actionLabel: '予定を追加', eventCreatedByTurn: false } } });
    }
    expect(h.local.readCheckpoint()!.vnext.presentedQuestion).toBeNull(); expect(h.getState().previewCandidates).toEqual([]);
    const queued = listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION }); expect(queued).toHaveLength(1);
    expect(queued[0].input.debugTraceEvents).toEqual(result.debugTraceEvents);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace({ ...queued[0].input, requestId: 'handoff-retry-after-reload', debugTraceEvents: [] });
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toEqual([]);
    const write = writes.find(write => write.entries.some(entry => entry.requestId === queued[0].input.requestId))!;
    const entry = write.entries.find(entry => entry.kind === 'turn_diagnostic' && entry.requestId === queued[0].input.requestId)!;
    expect(JSON.stringify(entry)).toContain(status); expect(JSON.stringify(entry)).toContain('keep-future-handoff');
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const server = prepareWeeklyPlanningTraceServerWrite({ session: write.session as unknown as Record<string, unknown>,
      entries: write.entries as unknown as Record<string, unknown>[] }, { token: `wpt_${'a'.repeat(43)}`, epoch: '106' },
    { sessionId: 'weekly-trace-423e4567-e89b-52d3-a456-426614174000', logicalConversationId: CONVERSATION }, NOW);
    expect(server.entries).toHaveLength(1);
    expect(JSON.stringify(server.entries[0])).toContain(status); expect(JSON.stringify(server.entries[0])).toContain('keep-future-handoff');
    expect(measureWeeklyPlanningTraceJsonBytes(server.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    if (large) expect(JSON.stringify(server.entries[0])).toContain('truncat');
  });

  it.each([true, false])('binds the next answer to the actual retained presentation (verified recovery=%s)', async verified => {
    // A structured rejection: the only failure the renderer may recover (a provider failure gets the fixed notice).
    const failed: WeeklyPlanningVNextInterpretation = { status: 'failed', reason: 'rejected_after_repair', errors: [], metrics: { calls: 1, repairs: 0, latencyMs: 1 } };
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
        : { status: 'failed', reason: 'rejected_after_repair', errors: [], metrics: { calls: 1, repairs: 0, latencyMs: 1 } } }),
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
