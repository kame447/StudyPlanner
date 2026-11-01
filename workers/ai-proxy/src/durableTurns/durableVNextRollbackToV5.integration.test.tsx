// Rollback safety (#926): a durable VNext receipt left in localStorage when Pages goes back to the V5 build.
import { createRef, forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../../../../src/features/weeklyPlanning/testUtils/weeklyPlanningApplicationTestHarness';
import { createReadyPlannerDataAvailability } from '../../../../src/features/weeklyPlanning/testUtils/plannerDataAvailabilityTest';
import { successfulWeeklyPlanningRendererCompletion } from '../../../../src/features/weeklyPlanning/testUtils/__tests__/weeklyPlanningRendererCompletionFixture';
import { useWeeklyPlanningApplication, type WeeklyPlanningApplication, type UseWeeklyPlanningApplicationInput } from '../../../../src/features/weeklyPlanning/application/useWeeklyPlanningApplication';
import { createWeeklyPlanningApprovalMemoryState, createMemoryWeeklyPlanningApprovalPlanRepository } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningApprovalMemoryRepository';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeSession';
import { readDurableWeeklyTurnReceipt } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningDurableTurnClient';
import type { WeeklyPlanningTurnSubmissionResult } from '../../../../src/features/weeklyPlanning/weeklyPlanningTurnExecutionTypes';
import { useWeeklyPlanningVNextApplication, type WeeklyPlanningVNextLocalApplicationServices } from '../../../../src/features/weeklyPlanning/vnext/application/useWeeklyPlanningVNextApplication';
import { createWeeklyPlanningVNextLocalSession } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextLocalSession';
import { VNEXT_PROVIDER_RESPONSE_FORMAT } from '../../../../src/features/weeklyPlanning/vnext/semantic/weeklyPlanningVNextProviderSchema';
import { DurableTurnJob, type DurableTurnRecord } from './durableTurnJob';
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
const V5Harness = forwardRef<WeeklyPlanningApplication, UseWeeklyPlanningApplicationInput>((props, ref) => {
  const app = useWeeklyPlanningApplication(props); useImperativeHandle(ref, () => app, [app]); return null;
});
let restoreStorage: (() => void) | undefined; let renderer: ReactTestRenderer | undefined; let storage: ReturnType<typeof createMemoryStorageHarness>;
let job: DurableTurnJob; let record: DurableTurnRecord | undefined; let methods: string[]; let providerCalls: number; let windowEvents: EventTarget;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime('2026-11-02T00:00:00Z');
  vi.stubEnv('VITE_DURABLE_WEEKLY_TURNS', 'enabled'); vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'false');
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  storage = createMemoryStorageHarness(); restoreStorage = installWeeklyPlanningTestStorage(storage.storage);
  windowEvents = new EventTarget();
  Object.assign(window, { addEventListener: windowEvents.addEventListener.bind(windowEvents), removeEventListener: windowEvents.removeEventListener.bind(windowEvents) });
  const documentEvents = new EventTarget();
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: documentEvents.addEventListener.bind(documentEvents), removeEventListener: documentEvents.removeEventListener.bind(documentEvents) });
  vi.spyOn(aiConfig, 'getCloudflareAiProxyUrl').mockReturnValue('https://proxy.fixture.test');
  vi.spyOn(firebase, 'getFirebaseAuth').mockReturnValue({ currentUser: { uid: OWNER, getIdToken: async () => 'synthetic' } } as never);
  record = undefined; methods = []; providerCalls = 0;
  job = new DurableTurnJob({ read: async () => record && structuredClone(record), write: async value => { record = structuredClone(value); }, alarmAt: async () => {} });
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
    if (init?.method === 'POST') { const input = JSON.parse(String(init.body)); return Response.json(await job.accept({ ...input, ownerId: OWNER, payload: JSON.stringify(input.payload) }), { status: 202 }); }
    const query = new URL(String(url)).searchParams;
    if (init?.method === 'DELETE') return Response.json(await job.cancel({ ownerId: OWNER, conversationId: query.get('conversationId')!,
      requestId: query.get('requestId')!, baseRevision: Number(query.get('baseRevision')), startedAt: Number(query.get('startedAt')) }));
    const state = await job.status({ ownerId: OWNER, conversationId: query.get('conversationId')!, requestId: query.get('requestId')! });
    return state ? Response.json(state) : new Response(null, { status: 404 });
  }));
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; restoreStorage?.(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); resetWeeklyPlanningStableV5RuntimeSessionsForTest(); });

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
async function runAlarm() {
  await job.run(async (payload, dispatch, sourceIp, deadline) => serializeWeeklyPlanningTurnResult(
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
/** For a claim that nothing more happens: every client poll interval passes and real tasks drain. */
async function quiesce() { await vi.advanceTimersByTimeAsync(10_000); for (let i = 0; i < 25; i += 1) await realYield(); }
const track = (promise: Promise<unknown>) => { const state = { done: false }; void promise.then(() => { state.done = true; }, () => { state.done = true; }); return state; };
const rawOf = (chatId: string) => createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: storage.storage, chatId }).checkpoint.read();
async function submit(app: { current: WeeklyPlanningApplication | null }, text: string) {
  let submitted!: Promise<WeeklyPlanningTurnSubmissionResult>;
  await act(async () => { submitted = app.current!.submitTurn(text); await until(() => record?.status === 'queued'); expect(record?.status).toBe('queued'); });
  // Boxed: returning the promise itself would make the caller wait for the turn to finish.
  return { submitted };
}


async function mountV5() {
  const repository = createMemoryWeeklyPlanningApprovalPlanRepository(createWeeklyPlanningApprovalMemoryState());
  const input: UseWeeklyPlanningApplicationInput = { userId: OWNER, selectedDate: WEEK, plans: [], scheduleTemplates: [],
    plannerDataAvailability: createReadyPlannerDataAvailability(OWNER), isPlannerDataSnapshotCurrent: () => true,
    saveWeeklyApprovedPlan: repository.saveApprovedPlan, completeWeeklyApprovalOperation: repository.completeOperation };
  const ref = createRef<WeeklyPlanningApplication>();
  await act(async () => { renderer = create(<V5Harness ref={ref} {...input} />); });
  await act(async () => { ref.current!.chat.initialize(); });
  return ref;
}

it('a stale VNext receipt lives under its own key: a V5 build, even one without any VNext guard, finds nothing to resume, and rolling forward resumes it once', async () => {
  // The conversation was started in the V5 build and VNext took it over under the same conversation identity,
  // so the receipt really belongs to the conversation the V5 build loads after the rollback. The V5 state is still at
  // the receipt's base revision, which is exactly the case in which V5 would otherwise resume the request itself.
  const seeded = await mountV5();
  await act(async () => { expect(seeded.current!.chat.checkpoint().status).toBe('saved'); });
  const v5ChatId = seeded.current!.chat.index.activeChatId;
  await act(async () => renderer!.unmount()); renderer = undefined; resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  const first = await mount();
  const { submitted } = await submit(first.ref, '数学を7ページ');
  expect(methods).toEqual(['POST']);
  const receipt = readDurableWeeklyTurnReceipt(OWNER, 'vnext');
  expect(receipt?.payload).toMatchObject({ core: 'vnext' });
  // The Stable V5 key, the only one an older build reads, stays empty.
  expect(storage.storage.getItem(`studyplanner.durableWeeklyTurn.v1:${encodeURIComponent(OWNER)}`)).toBeNull();
  expect(readDurableWeeklyTurnReceipt(OWNER)).toBeNull();
  const v5Conversation = JSON.parse(storage.storage.getItem(`studyplanner.aiPlanning.chat.v1.${OWNER}.${v5ChatId}`)!).conversationId;
  expect(receipt?.pending.conversationId).toBe(v5Conversation);
  const vnextReceiptKey = `studyplanner.durableWeeklyTurn.vnext.v1:${encodeURIComponent(OWNER)}`;
  const receiptBytes = storage.storage.getItem(vnextReceiptKey);
  expect(receiptBytes).not.toBeNull();
  await act(async () => renderer!.unmount()); renderer = undefined; resetWeeklyPlanningStableV5RuntimeSessionsForTest();

  // Pages rolled back: the V5 build mounts with durable turns enabled and the VNext receipt in storage.
  const v5 = await mountV5();
  await act(async () => { windowEvents.dispatchEvent(new Event('focus')); await quiesce(); });
  expect(methods).toEqual(['POST']);          // nothing resubmitted, polled or cancelled against the Worker
  expect(providerCalls).toBe(0);
  expect(v5.current!.state.pendingTurn).toBeUndefined();
  expect(storage.storage.getItem(vnextReceiptKey)).toBe(receiptBytes);
  expect(storage.storage.getItem(`studyplanner.durableWeeklyTurn.v1:${encodeURIComponent(OWNER)}`)).toBeNull();
  await act(async () => renderer!.unmount()); renderer = undefined; resetWeeklyPlanningStableV5RuntimeSessionsForTest();

  // Rolled forward again: the same receipt reads the same job (no second POST, no second AI run).
  await runAlarm(); const calls = providerCalls; expect(calls).toBeGreaterThan(0);
  const detached = track(submitted);
  const second = await mount();
  await act(async () => { windowEvents.dispatchEvent(new Event('focus'));
    await until(() => detached.done && second.ref.current!.state.messages.some(m => m.role === 'assistant')); });
  expect(methods.filter(method => method === 'POST')).toHaveLength(1);
  expect(providerCalls).toBe(calls);
});
