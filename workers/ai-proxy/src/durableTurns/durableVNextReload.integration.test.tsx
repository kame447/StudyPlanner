import { createRef, forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../../../../src/features/weeklyPlanning/testUtils/weeklyPlanningApplicationTestHarness';
import { createReadyPlannerDataAvailability } from '../../../../src/features/weeklyPlanning/testUtils/plannerDataAvailabilityTest';
import { successfulWeeklyPlanningRendererCompletion } from '../../../../src/features/weeklyPlanning/testUtils/__tests__/weeklyPlanningRendererCompletionFixture';
import type { WeeklyPlanningApplication, UseWeeklyPlanningApplicationInput } from '../../../../src/features/weeklyPlanning/application/useWeeklyPlanningApplication';
import { createWeeklyPlanningApprovalMemoryState, createMemoryWeeklyPlanningApprovalPlanRepository } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningApprovalMemoryRepository';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeSession';
import { DURABLE_CLIENT_TIMING, readDurableWeeklyTurnReceipt } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningDurableTurnClient';
import type { WeeklyPlanningTurnSubmissionResult } from '../../../../src/features/weeklyPlanning/weeklyPlanningTurnExecutionTypes';
import { useWeeklyPlanningVNextApplication, type WeeklyPlanningVNextLocalApplicationServices } from '../../../../src/features/weeklyPlanning/vnext/application/useWeeklyPlanningVNextApplication';
import { createWeeklyPlanningVNextLocalSession } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextLocalSession';
import { VNEXT_PROVIDER_RESPONSE_FORMAT } from '../../../../src/features/weeklyPlanning/vnext/semantic/weeklyPlanningVNextProviderSchema';
import { DURABLE_TURN_LIMITS, DurableTurnConflict, DurableTurnJob, type DurableTurnRecord } from './durableTurnJob';
import { executeDurableVNextTurn } from './durableVNextTurn';
import { serializeWeeklyPlanningTurnResult } from './weeklyPlanningTurnResult';
import type { AiProxyWorkerEnv } from '../worker';
import * as aiConfig from '../../../../src/lib/aiConfig';
import * as firebase from '../../../../src/lib/firebaseClient';

const OWNER = 'durable-vnext-owner'; const WEEK = '2026-11-02'; const NOW = '2026-11-02T00:00:00.000Z';
const empty = { add: [], patch: [], remove: [], relate: [], defer: [] };
const reading = JSON.stringify({ planningIntent: 'discuss', conversationActs: [], answer: null, delta: { ...empty, add: [
  { kind: 'task', localId: 'task', category: 'study', title: '数学' },
  { kind: 'workload', localId: 'work', taskRef: { localId: 'task' }, componentRef: null, quantityRole: 'remaining', amount: 7,
    unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null }] } });
const workerEnv = { OPENAI_API_KEY: 'server-key', ALLOWED_CHAT_MODELS: 'gpt-6-luna',
  AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) }) } } as unknown as AiProxyWorkerEnv;

const Harness = forwardRef<WeeklyPlanningApplication, { input: UseWeeklyPlanningApplicationInput; services: WeeklyPlanningVNextLocalApplicationServices }>((props, ref) => {
  const app = useWeeklyPlanningVNextApplication(props.input, props.services); useImperativeHandle(ref, () => app, [app]); return null;
});
let restoreStorage: (() => void) | undefined; let renderer: ReactTestRenderer | undefined; let storage: ReturnType<typeof createMemoryStorageHarness>;
let methods: string[]; let providerCalls: number; let windowTarget: EventTarget;
/** One Durable Object per chat, as in production (named by owner and conversation): a turn can only ever reach its own. */
let objects: Map<string, { job: DurableTurnJob; record?: DurableTurnRecord }>;
let lastConversation: string;
let outstanding: Promise<unknown>[]; let conflicts: unknown[]; let unhandled: unknown[];
let windowListeners: Set<unknown>; let documentListeners: Set<unknown>;
const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
const objectFor = (conversationId: string) => {
  let entry = objects.get(conversationId);
  if (!entry) {
    const created: { job: DurableTurnJob; record?: DurableTurnRecord } = { job: undefined as never };
    created.job = new DurableTurnJob({ read: async () => created.record && structuredClone(created.record),
      write: async value => { created.record = structuredClone(value); }, alarmAt: async () => {} });
    const { accept, cancel } = created.job;
    // A conflict is a protocol violation in every test of this file; record it where it is raised.
    created.job.accept = async input => { try { return await accept.call(created.job, input); } catch (error) { if (error instanceof DurableTurnConflict) conflicts.push(error.code); throw error; } };
    created.job.cancel = async identity => { try { return await cancel.call(created.job, identity); } catch (error) { if (error instanceof DurableTurnConflict) conflicts.push(error.code); throw error; } };
    objects.set(conversationId, created); entry = created;
  }
  lastConversation = conversationId;
  return entry;
};
/** The job record of the chat the last turn addressed. */
const currentRecord = () => objects.get(lastConversation)?.record;
const activePolls = () => windowListeners.size + documentListeners.size;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime('2026-11-02T00:00:00Z');
  vi.stubEnv('VITE_DURABLE_WEEKLY_TURNS', 'enabled'); vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'false');
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  storage = createMemoryStorageHarness(); restoreStorage = installWeeklyPlanningTestStorage(storage.storage);
  methods = []; providerCalls = 0; objects = new Map(); lastConversation = ''; outstanding = []; conflicts = []; unhandled = [];
  windowListeners = new Set(); documentListeners = new Set();
  process.on('unhandledRejection', onUnhandled);
  const registry = (target: EventTarget, listeners: Set<unknown>) => ({
    // Only the client's poll registers these; a leftover registration is a leftover poll.
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => { listeners.add(listener); target.addEventListener(type, listener); },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => { listeners.delete(listener); target.removeEventListener(type, listener); },
  });
  const windowEvents = new EventTarget(); const documentEvents = new EventTarget();
  windowTarget = windowEvents;
  Object.assign(window, registry(windowEvents, windowListeners));
  vi.stubGlobal('document', { visibilityState: 'visible', ...registry(documentEvents, documentListeners) });
  vi.spyOn(aiConfig, 'getCloudflareAiProxyUrl').mockReturnValue('https://proxy.fixture.test');
  vi.spyOn(firebase, 'getFirebaseAuth').mockReturnValue({ currentUser: { uid: OWNER, getIdToken: async () => 'synthetic' } } as never);
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).includes('/observability/')) return Response.json({ ok: true });
    if (!String(url).includes('/weekly-planning/turns')) {
      // The Worker's own provider call, answered by the shared healthy-renderer fixture.
      providerCalls += 1;
      const body = JSON.parse(String(init!.body)) as { response_format?: { json_schema?: { name?: string } }; messages: { content: string }[] };
      const content = body.response_format?.json_schema?.name === VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema.name
        ? reading : await successfulWeeklyPlanningRendererCompletion(body);
      return Response.json({ model: 'gpt-6-luna', choices: [{ message: { content } }] });
    }
    methods.push(init?.method ?? 'GET');
    if (init?.method === 'POST') {
      const input = JSON.parse(String(init.body));
      return Response.json(await objectFor(input.conversationId).job.accept({ ...input, ownerId: OWNER, payload: JSON.stringify(input.payload) }), { status: 202 });
    }
    const query = new URL(String(url)).searchParams; const conversationId = query.get('conversationId')!;
    if (init?.method === 'DELETE') return Response.json(await objectFor(conversationId).job.cancel({ ownerId: OWNER, conversationId,
      requestId: query.get('requestId')!, baseRevision: Number(query.get('baseRevision')), startedAt: Number(query.get('startedAt')) }));
    const state = await objectFor(conversationId).job.status({ ownerId: OWNER, conversationId, requestId: query.get('requestId')! });
    return state ? Response.json(state) : new Response(null, { status: 404 });
  }));
});
afterEach(async () => {
  // Teardown at the cause: nothing started by a test may outlive it. The page goes away, then every turn it
  // started settles and every client poll deregisters before the next test (or a failure report) begins.
  try {
    await act(async () => renderer?.unmount()); renderer = undefined;
    await until(() => outstanding.every(turn => turnState.get(turn)?.done === true) && activePolls() === 0);
    await passEveryInterval();
    expect(conflicts, 'no durable conflict may be raised').toEqual([]);
    expect(unhandled, 'no unhandled rejection may occur').toEqual([]);
  } finally {
    process.off('unhandledRejection', onUnhandled);
    restoreStorage?.(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  }
});

async function mount() {
  const database = createWeeklyPlanningApprovalMemoryState(); const repository = createMemoryWeeklyPlanningApprovalPlanRepository(database);
  const input: UseWeeklyPlanningApplicationInput = { userId: OWNER, selectedDate: WEEK, plans: [], scheduleTemplates: [],
    plannerDataAvailability: createReadyPlannerDataAvailability(OWNER), isPlannerDataSnapshotCurrent: () => true,
    saveWeeklyApprovedPlan: repository.saveApprovedPlan, completeWeeklyApprovalOperation: repository.completeOperation };
  // Neither browser interpretation nor the browser provider may run: the durable Worker owns the turn.
  const services: WeeklyPlanningVNextLocalApplicationServices = { storage: storage.storage, now: () => NOW,
    client: () => ({ createChatCompletion: async () => { throw new Error('browser provider must not run'); } }),
    interpret: () => async () => { throw new Error('browser interpretation must not run'); },
    createRenderer: () => ({ render: async () => { throw new Error('browser renderer must not run'); } }) };
  const ref = createRef<WeeklyPlanningApplication>();
  await act(async () => { renderer = create(<Harness ref={ref} input={input} services={services} />); });
  await act(async () => { ref.current!.chat.initialize(); });
  await act(async () => { expect((await ref.current!.prepareTurn()).ready).toBe(true); });
  return { ref, database };
}
/** The alarm of one chat's Durable Object (default: the chat the last turn addressed). */
async function runAlarm(conversationId = lastConversation) {
  await objects.get(conversationId)!.job.run(async (payload, dispatch, sourceIp, deadline) => serializeWeeklyPlanningTurnResult(
    await executeDurableVNextTurn(workerEnv, JSON.parse(payload), dispatch, sourceIp, deadline)));
}
const checkpointOf = (chatId: string) => createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: storage.storage, chatId }).readCheckpoint();
/**
 * Waits for a condition the way a user would: fake client timers advance (10ms at a time) while real macrotasks
 * run, bounded by real elapsed time. A tick count is not a bound: the first turn also waits on real module and
 * I/O latency, which differs between machines (a slow CI runner needs far more than a fast one).
 */
const realSetTimeout = globalThis.setTimeout;
const realYield = () => new Promise<void>(resolve => { realSetTimeout(resolve, 2); });
async function until(condition: () => boolean, limitMs = 60_000) {
  const started = performance.now();
  while (!condition()) {
    if (performance.now() - started > limitMs) throw new Error('Condition not reached within the real-time limit.');
    await vi.advanceTimersByTimeAsync(10); await realYield();
  }
}
const turnState = new WeakMap<Promise<unknown>, { done: boolean }>();
/** Every turn a test starts is tracked so teardown can await it. */
function track<T extends Promise<unknown>>(promise: T): { done: boolean } {
  const state = turnState.get(promise) ?? { done: false };
  if (!turnState.has(promise)) { turnState.set(promise, state); outstanding.push(promise); void promise.then(() => { state.done = true; }, () => { state.done = true; }); }
  return state;
}
const rawOf = (chatId: string) => createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: storage.storage, chatId }).checkpoint.read();
async function submit(app: { current: WeeklyPlanningApplication | null }, text: string) {
  let submitted!: Promise<WeeklyPlanningTurnSubmissionResult>;
  await act(async () => { submitted = app.current!.submitTurn(text); track(submitted);
    await until(() => currentRecord()?.status === 'queued'); expect(currentRecord()?.status).toBe('queued'); });
  // Boxed: returning the promise itself would make the caller wait for the turn to finish.
  return { submitted };
}

/** Past every interval the code defines for polling, request timeout, reconciliation, acceptance and the alarm watchdog. */
const LONGEST_DEFINED_INTERVAL_MS = Math.max(DURABLE_CLIENT_TIMING.pollMaxMs, DURABLE_CLIENT_TIMING.requestTimeoutMs,
  DURABLE_CLIENT_TIMING.reconcileWindowMs, DURABLE_TURN_LIMITS.acceptanceAgeMs, DURABLE_TURN_LIMITS.executionMs);
/** Time passes beyond every defined interval and every object's alarm is delivered again, then the real queue drains. */
async function passEveryInterval() {
  await vi.advanceTimersByTimeAsync(LONGEST_DEFINED_INTERVAL_MS);
  for (const conversationId of objects.keys()) await runAlarm(conversationId);
  for (let i = 0; i < 10; i += 1) await realYield();
}
/**
 * "Nothing more can happen" from observable facts of the existing mechanisms, not from a wait: the job reached
 * a terminal state, its receipt is consumed or cleared, the client poll is deregistered (no listener, no pending
 * timer), and the requests, provider calls and saves stay fixed while time passes beyond every defined interval
 * and the alarm is delivered again. Late duplicates are also covered by the idempotent-accept tests in
 * durableTurnJob.test.ts (lost acceptance response / repeated request) and by the other-chat case below.
 */
async function expectNoLateExecution(database: { metrics: unknown }) {
  expect(['completed', 'failed', 'expired'], 'the job is terminal').toContain(currentRecord()?.status);
  expect(readDurableWeeklyTurnReceipt(OWNER, 'vnext'), 'the receipt is consumed or cleared').toBeNull();
  expect(activePolls(), 'the client poll is deregistered').toBe(0);
  expect(vi.getTimerCount(), 'no poll or request timer is pending').toBe(0);
  const before = { methods: [...methods], providerCalls, metrics: structuredClone(database.metrics) };
  await passEveryInterval();
  expect(methods, 'no further request').toEqual(before.methods);
  expect(providerCalls, 'no further provider call').toBe(before.providerCalls);
  expect(database.metrics, 'no further save').toEqual(before.metrics);
  expect(activePolls()).toBe(0); expect(vi.getTimerCount()).toBe(0);
}

it('finishes while detached and restores exactly one reply and its checkpoint without another AI call or save', async () => {
  const first = await mount(); const chatId = first.ref.current!.chat.index.activeChatId;
  const { submitted } = await submit(first.ref, '数学を7ページ');
  expect(methods).toEqual(['POST']); expect(first.ref.current!.state.pendingTurn).toBeDefined();
  expect(readDurableWeeklyTurnReceipt(OWNER, 'vnext')?.payload).toMatchObject({ core: 'vnext', checkpoint: null });
  await act(async () => renderer!.unmount()); renderer = undefined;
  await runAlarm(); expect(currentRecord()?.status).toBe('completed'); const callsAfterAlarm = providerCalls; expect(callsAfterAlarm).toBeGreaterThan(0);
  expect(checkpointOf(chatId)).toBeNull();
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  const second = await mount();
  const detached = track(submitted);
  await act(async () => { windowTarget.dispatchEvent(new Event('focus'));
    await until(() => detached.done && second.ref.current!.state.messages.some(m => m.role === 'assistant')); });
  expect((await submitted).accepted).toBe(false);
  const state = second.ref.current!.state;
  expect(state.pendingTurn).toBeUndefined();
  expect(state.messages.filter(m => m.role === 'user')).toHaveLength(1);
  expect(state.messages.filter(m => m.role === 'assistant')).toHaveLength(1);
  expect(checkpointOf(chatId)!.vnext.state.graph.tasks.map(task => task.title)).toEqual(['数学']);
  expect(methods.filter(method => method === 'POST')).toHaveLength(1); expect(providerCalls).toBe(callsAfterAlarm);
  expect(second.database.metrics).toEqual({ planWrites: 0, itemWrites: 0, operationWrites: 0 });
  await expectNoLateExecution(second.database);
  // A later load reads the persisted answer; the old receipt does not apply it again.
  await act(async () => renderer!.unmount()); renderer = undefined; resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  const third = await mount();
  await expectNoLateExecution(third.database);
  expect(third.ref.current!.state.messages.filter(m => m.role === 'assistant')).toHaveLength(1);
  expect(providerCalls).toBe(callsAfterAlarm); expect(methods.filter(method => method === 'POST')).toHaveLength(1);
});

it('only explicit cancellation stops accepted work, and it is not resumed after reload', async () => {
  const first = await mount(); const chatId = first.ref.current!.chat.index.activeChatId;
  const { submitted } = await submit(first.ref, '数学を7ページ');
  await act(async () => { expect(first.ref.current!.cancelTurn()).toBe(true); await until(() => currentRecord()?.failure === 'cancelled'); expect(currentRecord()?.failure).toBe('cancelled'); });
  await runAlarm(); expect(providerCalls).toBe(0);
  const detached = track(submitted);
  await act(async () => { windowTarget.dispatchEvent(new Event('focus')); await until(() => detached.done); });
  expect((await submitted).accepted).toBe(false); expect(readDurableWeeklyTurnReceipt(OWNER, 'vnext')).toBeNull();
  await act(async () => renderer!.unmount()); renderer = undefined; resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  const second = await mount();
  await expectNoLateExecution(second.database);
  expect(second.ref.current!.state.pendingTurn).toBeUndefined(); expect(providerCalls).toBe(0);
  expect(checkpointOf(chatId)).toBeNull(); expect(methods.filter(method => method === 'POST')).toHaveLength(1); expect(methods).toContain('DELETE');
});

it('resumes into the chat that owns the receipt and leaves another chat\'s checkpoint untouched', async () => {
  const first = await mount(); const chatA = first.ref.current!.chat.index.activeChatId;
  let a!: Promise<WeeklyPlanningTurnSubmissionResult>;
  await act(async () => { a = first.ref.current!.submitTurn('数学を7ページ'); track(a); await until(() => currentRecord()?.status === 'queued'); expect(currentRecord()?.status).toBe('queued'); });
  await runAlarm(); const firstDone = track(a); await act(async () => { await until(() => firstDone.done); });
  expect((await a).accepted).toBe(true);
  const chatABytes = rawOf(chatA);
  expect(chatABytes).not.toBeNull();
  await act(async () => { first.ref.current!.startConversation(); });
  const chatB = first.ref.current!.chat.index.activeChatId; expect(chatB).not.toBe(chatA);
  const { submitted } = await submit(first.ref, '英語を7ページ');
  await act(async () => renderer!.unmount()); renderer = undefined;
  await runAlarm(); expect(currentRecord()?.status).toBe('completed');
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  const second = await mount();
  expect(second.ref.current!.chat.index.activeChatId).toBe(chatB);
  const detachedB = track(submitted);
  await act(async () => { windowTarget.dispatchEvent(new Event('focus'));
    await until(() => detachedB.done && second.ref.current!.state.messages.some(m => m.role === 'assistant')); });
  expect((await submitted).accepted).toBe(false);
  expect(second.ref.current!.state.messages.filter(m => m.role === 'user')).toHaveLength(1);
  expect(checkpointOf(chatB)).not.toBeNull();
  expect(rawOf(chatA)).toBe(chatABytes);
  // Each chat has its own object, and the earlier chat's finished turn stays finished.
  expect(objects.size).toBe(2);
  await expectNoLateExecution(second.database);
  expect(rawOf(chatA)).toBe(chatABytes);
});
