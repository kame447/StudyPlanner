// Selected starter targets (plan/todo/material) are typed, untrusted turn context for VNext, as in V5:
// the label names the item, the id is an external identity that is never a graph reference, and the
// target grants no effort, quantity or authority. Real controller → gateway → provider → trace path.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { measureWeeklyPlanningTraceJsonBytes, WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS } from '../../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
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
import { createWeeklyPlanningStableV5DialogueRendererCore, type WeeklyPlanningSelectedStarterTargetV5 } from '../weeklyPlanningVNextV5Boundary';
import type { VNextAddFact, VNextTurnDelta } from '../weeklyPlanningVNextTypes';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { parseWeeklyPlanningVNextSessionCheckpoint } from './weeklyPlanningVNextSessionCheckpoint';
import { createWeeklyPlanningVNextRuntimeGateway } from './weeklyPlanningVNextRuntimeGateway';

const OWNER = 'synthetic-starter-owner'; const WEEK = '2026-11-02'; const NOW = `${WEEK}T00:00:00.000Z`;
const CONVERSATION = 'weekly-conversation-523e4567-e89b-52d3-a456-426614174000';
const EMPTY: VNextTurnDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };
const TARGETS: WeeklyPlanningSelectedStarterTargetV5[] = [
  { kind: 'plan', id: 'plan-ext-1', label: 'ゼミ資料', targetDate: null },
  { kind: 'todo', id: 'todo-ext-1', label: '期末レポート', targetDate: '2026-11-09' },
  { kind: 'material', id: 'material-ext-1', label: '英単語ターゲット1900', targetDate: '2026-11-14' },
];
const reading = (title: string, extra: Record<string, unknown> = {}) => ({ planningIntent: 'create_plan', conversationActs: [],
  delta: { ...EMPTY, add: [{ kind: 'task', localId: 'task', category: 'study', title } as VNextAddFact,
    { kind: 'workload', localId: 'work', taskRef: { localId: 'task' }, componentRef: null, quantityRole: 'remaining', amount: 30,
      unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null } as VNextAddFact] },
  answer: null, ...extra });

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

function harness(nativeReading: unknown) {
  const local = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: createMemoryStorageHarness().storage });
  let state = createInitialPlanningState(WEEK);
  const controller = createWeeklyPlanningControllerSession(OWNER, WEEK, CONVERSATION);
  const requests: { messages: { role: string; content: string }[] }[] = [];
  const results: WeeklyPlanningTurnExecutionResult[] = [];
  const client = { async createChatCompletion(input: never) { requests.push(structuredClone(input)); return JSON.stringify(nativeReading); } };
  const gateway = createWeeklyPlanningVNextRuntimeGateway({ session: local, ports: () => ({ client,
    interpret: createWeeklyPlanningVNextProviderInterpreter(), checkpoint: local.checkpoint,
    legacyV5Checkpoint: local.legacyV5Checkpoint, now: () => NOW,
    approvalLedger: { read: () => null, write: () => { throw new Error('no approval in this test'); } },
    plans: { findExistingPlanId: async () => undefined, saveBlock: async () => { throw new Error('no save in this test'); } },
    calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
    createRenderer: () => createWeeklyPlanningStableV5DialogueRendererCore({ createChatCompletion: successfulWeeklyPlanningRendererCompletion }),
  }) });
  const submit = (userText: string, selectedStarterTarget?: WeeklyPlanningSelectedStarterTargetV5) =>
    submitWeeklyPlanningControlledTurn({ session: controller, ownerId: OWNER, userText, selectedStarterTarget, now: () => NOW,
      getState: () => state, dispatch: action => { state = weeklyPlanningReducer(state, action); return state; },
      async execute(input) {
        const result = await gateway.runtimeGateway.execute({ ...input, userId: OWNER, selectedDate: WEEK, plans: [], scheduleTemplates: [],
          timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' });
        results.push(result); return result;
      },
      prepareExecutionCommit: ({ pending }) => gateway.stagingLifecycle.prepare({ ownerId: OWNER, pending }),
      discardExecutionResult: async ({ pending, result, userText: text, reason }) => {
        gateway.stagingLifecycle.discard(pending);
        if (reason !== 'failed') await recordDiscardedWeeklyPlanningApplicationTurn({ ownerId: OWNER, pending, result, userText: text, reason });
      },
      onCommittedTurn: async input => { await recordCommittedWeeklyPlanningApplicationTurn({ ...input, ownerId: OWNER }); },
      onFailedTurn: async input => { await recordFailedWeeklyPlanningApplicationTurn({ ...input, ownerId: OWNER }); },
    });
  return { local, submit, requests, results };
}
const userPayload = (request: { messages: { content: string }[] }) => JSON.parse(request.messages[1].content);

describe('VNext selected starter targets', () => {
  it.each(TARGETS)('sends a $kind target to the provider as typed context and keeps the label as the task title', async target => {
    const h = harness(reading(target.label));
    const submitted = await h.submit(`${target.label}を計画したい`, target);
    expect(submitted).toMatchObject({ accepted: true, draftCandidates: [expect.objectContaining({ field: target.label, title: `${target.label} 30分` })] });
    expect(h.requests).toHaveLength(1);
    expect(userPayload(h.requests[0]).selectedStarterTarget).toEqual(target);
    expect(h.requests[0].messages[0].content).toContain('selectedStarterTarget');
    // The external id never becomes a graph identity or a saved field (V5 saves materialId: null).
    const checkpoint = JSON.stringify(h.local.readCheckpoint());
    expect(checkpoint).not.toContain(target.id);
    expect(JSON.stringify(submitted)).not.toContain(target.id);
  });

  it('leaves a turn without a target unchanged', async () => {
    const h = harness(reading('数学'));
    await h.submit('数学を30分');
    expect(userPayload(h.requests[0]).selectedStarterTarget).toBeNull();
  });

  it('accepts starter dates beyond the selected week', async () => {
    const target = TARGETS[2]; // +12 days, as the product E2E uses
    const h = harness(reading(target.label));
    expect(await h.submit(`${target.label}を計画したい`, target)).toMatchObject({ accepted: true, draftCandidates: [expect.anything()] });
    expect(userPayload(h.requests[0]).selectedStarterTarget.targetDate).toBe('2026-11-14');
  });

  it('rejects a checkpoint written by a starter turn when read for another owner or week', async () => {
    const h = harness(reading(TARGETS[0].label));
    await h.submit('これを計画したい', TARGETS[0]);
    const raw = h.local.checkpoint.read()!;
    const read = (ownerId: string, weekStartDate: string) => parseWeeklyPlanningVNextSessionCheckpoint({ raw, ownerId, weekStartDate });
    expect(read(OWNER, WEEK)).not.toBeNull();
    expect(read('another-owner', WEEK)).toBeNull();
    expect(read(OWNER, '2026-11-09')).toBeNull();
  });

  it('never accepts an external id as a Fact Graph reference', async () => {
    const target = TARGETS[2];
    const patch = { planningIntent: 'create_plan', conversationActs: [], answer: null, delta: { ...EMPTY, patch: [{ kind: 'workload',
      localId: 'bad', targetFactId: target.id, amountDelta: null,
      changes: { amount: 5, unitCode: null, unitLabel: null, quantityRole: null, rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null } }] } };
    const h = harness(patch);
    await h.submit(`${target.label}を計画したい`, target);
    expect(h.local.readCheckpoint()!.vnext.state.graph.workloads).toEqual([]);
    expect(h.results[0].debugTraceEvents!.some(event => event.stage === 'semantic_provider_request')).toBe(true);
  });

  it.each([false, true])('persists the provider request carrying the target through outbox, reload and Worker (large=%s)', async large => {
    const target = { ...TARGETS[1], label: large ? `期末レポート${'z'.repeat(48 * 1024)}` : '期末レポート-future-starter-sentinel' };
    const h = harness(reading('期末レポート'));
    failAppend = true;
    await h.submit('これを計画したい', target);
    const sent = h.requests[0];
    const events = h.results[0].debugTraceEvents!;
    const requestEvent = events.find(event => event.stage === 'semantic_provider_request')!.data;
    expect(requestEvent).toMatchObject(large ? { traceProjectionTruncated: true, availableKeys: expect.arrayContaining(['request', 'requestBytes']) }
      : { request: { messages: sent.messages }, requestBytes: new TextEncoder().encode(JSON.stringify(sent)).byteLength });
    const queued = listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION });
    expect(queued).toHaveLength(1); expect(queued[0].input.debugTraceEvents).toEqual(events);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toHaveLength(1);
    await recordWeeklyPlanningStableV5TurnTrace({ ...queued[0].input, requestId: 'starter-retry-after-reload', debugTraceEvents: [] });
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: CONVERSATION })).toEqual([]);
    const write = writes[0]; const entry = write.entries.find(item => item.kind === 'turn_diagnostic')!;
    if (entry.kind !== 'turn_diagnostic') throw new Error('missing starter diagnostic');
    expect(entry.aiInterpreter.input.requests).toHaveLength(1);
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const server = prepareWeeklyPlanningTraceServerWrite({ session: write.session as unknown as Record<string, unknown>,
      entries: write.entries as unknown as Record<string, unknown>[] }, { token: `wpt_${'a'.repeat(43)}`, epoch: '106' },
    { sessionId: 'weekly-trace-523e4567-e89b-52d3-a456-426614174000', logicalConversationId: CONVERSATION }, NOW);
    expect(server.entries).toHaveLength(1);
    const saved = JSON.stringify(server.entries[0]);
    // An oversized request is bounded by the shared trace collector (same as V5): the turn is kept, the giant value is not.
    if (large) expect(saved).not.toContain('z'.repeat(48 * 1024));
    else { expect(saved).toContain('todo-ext-1'); expect(saved).toContain('future-starter-sentinel'); }
    expect(measureWeeklyPlanningTraceJsonBytes(server.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
  });
});
