import { createRef, forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../../../../src/features/weeklyPlanning/testUtils/weeklyPlanningApplicationTestHarness';
import { createReadyPlannerDataAvailability } from '../../../../src/features/weeklyPlanning/testUtils/plannerDataAvailabilityTest';
import { successfulWeeklyPlanningRendererCompletion } from '../../../../src/features/weeklyPlanning/testUtils/__tests__/weeklyPlanningRendererCompletionFixture';
import type { WeeklyPlanningApplication, UseWeeklyPlanningApplicationInput } from '../../../../src/features/weeklyPlanning/application/useWeeklyPlanningApplication';
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
/** Lets the controller's async admission and the fake-timer client run until the condition holds. */
async function until(condition: () => boolean) { for (let i = 0; i < 400 && !condition(); i += 1) await vi.advanceTimersByTimeAsync(10); }
const rawOf = (chatId: string) => createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: storage.storage, chatId }).checkpoint.read();
async function submit(app: { current: WeeklyPlanningApplication | null }, text: string) {
  let submitted!: Promise<WeeklyPlanningTurnSubmissionResult>;
  await act(async () => { submitted = app.current!.submitTurn(text); await until(() => record?.status === 'queued'); expect(record?.status).toBe('queued'); });
  // Boxed: returning the promise itself would make the caller wait for the turn to finish.
  return { submitted };
}

it('finishes while detached and restores exactly one reply and its checkpoint without another AI call or save', async () => {
  const first = await mount(); const chatId = first.ref.current!.chat.index.activeChatId;
  const { submitted } = await submit(first.ref, '数学を7ページ');
  expect(methods).toEqual(['POST']); expect(first.ref.current!.state.pendingTurn).toBeDefined();
  expect(readDurableWeeklyTurnReceipt(OWNER)?.payload).toMatchObject({ core: 'vnext', checkpoint: null });
  await act(async () => renderer!.unmount()); renderer = undefined;
  await runAlarm(); expect(record?.status).toBe('completed'); const callsAfterAlarm = providerCalls; expect(callsAfterAlarm).toBeGreaterThan(0);
  expect(checkpointOf(chatId)).toBeNull();
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  const second = await mount();
  await act(async () => { windowEvents.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(10_000); });
  expect((await submitted).accepted).toBe(false);
  const state = second.ref.current!.state;
  expect(state.pendingTurn).toBeUndefined();
  expect(state.messages.filter(m => m.role === 'user')).toHaveLength(1);
  expect(state.messages.filter(m => m.role === 'assistant')).toHaveLength(1);
  expect(checkpointOf(chatId)!.vnext.state.graph.tasks.map(task => task.title)).toEqual(['数学']);
  expect(methods.filter(method => method === 'POST')).toHaveLength(1); expect(providerCalls).toBe(callsAfterAlarm);
  expect(second.database.metrics).toEqual({ planWrites: 0, itemWrites: 0, operationWrites: 0 });
  // A later load reads the persisted answer; the old receipt does not apply it again.
  await act(async () => renderer!.unmount()); renderer = undefined; resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  const third = await mount(); await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(third.ref.current!.state.messages.filter(m => m.role === 'assistant')).toHaveLength(1);
  expect(providerCalls).toBe(callsAfterAlarm); expect(methods.filter(method => method === 'POST')).toHaveLength(1);
});

it('only explicit cancellation stops accepted work, and it is not resumed after reload', async () => {
  const first = await mount(); const chatId = first.ref.current!.chat.index.activeChatId;
  const { submitted } = await submit(first.ref, '数学を7ページ');
  await act(async () => { expect(first.ref.current!.cancelTurn()).toBe(true); await until(() => record?.failure === 'cancelled'); expect(record?.failure).toBe('cancelled'); });
  await runAlarm(); expect(providerCalls).toBe(0);
  await act(async () => { windowEvents.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(10_000); });
  expect((await submitted).accepted).toBe(false); expect(readDurableWeeklyTurnReceipt(OWNER)).toBeNull();
  await act(async () => renderer!.unmount()); renderer = undefined; resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  const second = await mount(); await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(second.ref.current!.state.pendingTurn).toBeUndefined(); expect(providerCalls).toBe(0);
  expect(checkpointOf(chatId)).toBeNull(); expect(methods.filter(method => method === 'POST')).toHaveLength(1); expect(methods).toContain('DELETE');
});

it('resumes into the chat that owns the receipt and leaves another chat\'s checkpoint untouched', async () => {
  const first = await mount(); const chatA = first.ref.current!.chat.index.activeChatId;
  let a!: Promise<WeeklyPlanningTurnSubmissionResult>;
  await act(async () => { a = first.ref.current!.submitTurn('数学を7ページ'); await until(() => record?.status === 'queued'); expect(record?.status).toBe('queued'); });
  await runAlarm(); await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect((await a).accepted).toBe(true);
  const chatABytes = rawOf(chatA);
  expect(chatABytes).not.toBeNull();
  await act(async () => { first.ref.current!.startConversation(); });
  const chatB = first.ref.current!.chat.index.activeChatId; expect(chatB).not.toBe(chatA);
  record = undefined as DurableTurnRecord | undefined; // One Durable Object exists per chat; this harness models the new chat's object.
  const { submitted } = await submit(first.ref, '英語を7ページ');
  await act(async () => renderer!.unmount()); renderer = undefined;
  await runAlarm(); expect(record?.status).toBe('completed');
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  const second = await mount();
  expect(second.ref.current!.chat.index.activeChatId).toBe(chatB);
  await act(async () => { windowEvents.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(10_000); });
  expect((await submitted).accepted).toBe(false);
  expect(second.ref.current!.state.messages.filter(m => m.role === 'user')).toHaveLength(1);
  expect(checkpointOf(chatB)).not.toBeNull();
  expect(rawOf(chatA)).toBe(chatABytes);
});
