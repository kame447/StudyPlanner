import { createRef, forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createReadyPlannerDataAvailability } from '../testUtils/plannerDataAvailabilityTest';
import { useWeeklyPlanningApplication, type WeeklyPlanningApplication, type UseWeeklyPlanningApplicationInput } from './useWeeklyPlanningApplication';
import { createWeeklyPlanningApprovalMemoryState, createMemoryWeeklyPlanningApprovalPlanRepository } from './weeklyPlanningApprovalMemoryRepository';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from './weeklyPlanningStableV5RuntimeSession';
import { executeIsolatedWeeklyPlanningTurn, type IsolatedWeeklyPlanningTurnInput } from './weeklyPlanningIsolatedTurn';
import { DurableTurnJob, type DurableTurnRecord } from '../../../../workers/ai-proxy/src/durableTurns/durableTurnJob';
import type { WeeklyPlanningTurnSubmissionResult } from '../weeklyPlanningTurnExecutionTypes';
import * as aiConfig from '../../../lib/aiConfig';
import * as firebase from '../../../lib/firebaseClient';
import { readDurableWeeklyTurnReceipt } from './weeklyPlanningDurableTurnClient';
import { weeklyPlanningTurnRuntimeGateway } from './weeklyPlanningTurnRuntimeGateway';
import { durableReceipt } from './weeklyPlanningDurableTurn.testUtils';

const OWNER = 'durable-owner'; const DATE = '2026-10-14';
const Harness = forwardRef<WeeklyPlanningApplication, UseWeeklyPlanningApplicationInput>((props, ref) => {
  const app = useWeeklyPlanningApplication(props); useImperativeHandle(ref, () => app, [app]); return null;
});
let restoreStorage: (() => void) | undefined; let renderer: ReactTestRenderer | undefined;
let job: DurableTurnJob; let record: DurableTurnRecord | undefined; let methods: string[]; let providerCalls: number;
let windowEvents: EventTarget;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime('2026-10-13T21:00:00Z');
  vi.stubEnv('VITE_DURABLE_WEEKLY_TURNS', 'enabled'); vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'false');
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  windowEvents = new EventTarget();
  Object.assign(window, { addEventListener: windowEvents.addEventListener.bind(windowEvents), removeEventListener: windowEvents.removeEventListener.bind(windowEvents) });
  const documentEvents = new EventTarget(); vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: documentEvents.addEventListener.bind(documentEvents), removeEventListener: documentEvents.removeEventListener.bind(documentEvents) });
  vi.spyOn(aiConfig, 'getCloudflareAiProxyUrl').mockReturnValue('https://proxy.fixture.test');
  vi.spyOn(firebase, 'getFirebaseAuth').mockReturnValue({ currentUser: { uid: OWNER, getIdToken: async () => 'synthetic' } } as never);
  record = undefined; methods = []; providerCalls = 0;
  job = new DurableTurnJob({ read: async () => record && structuredClone(record), write: async (value) => { record = structuredClone(value); }, alarmAt: async () => {} });
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (!String(url).includes('/weekly-planning/turns')) return Response.json({ ok: true });
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
  const ref = createRef<WeeklyPlanningApplication>();
  await act(async () => { renderer = create(<Harness ref={ref} userId={OWNER} selectedDate={DATE} plans={[]} scheduleTemplates={[]}
    isPlannerDataSnapshotCurrent={() => true} plannerDataAvailability={createReadyPlannerDataAvailability(OWNER)}
    saveWeeklyApprovedPlan={repository.saveApprovedPlan} completeWeeklyApprovalOperation={repository.completeOperation} />); });
  await act(async () => { ref.current!.chat.initialize(); });
  await act(async () => { expect((await ref.current!.prepareTurn()).ready).toBe(true); });
  return { ref, database };
}
async function runAlarm() {
  await job.run(async (payload, dispatch) => JSON.stringify(await executeIsolatedWeeklyPlanningTurn(JSON.parse(payload) as IsolatedWeeklyPlanningTurnInput,
    { createChatCompletion: (input) => dispatch(JSON.stringify(input), async () => {
      providerCalls += 1;
      if (input.purpose === 'weekly_planning_semantic_normalizer') return JSON.stringify({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan',
        planningWindow: { localId: 'window', kind: 'absolute', value: DATE, start: DATE, end: DATE, sourceText: '10月14日' }, tasks: [], relations: [],
        availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [] });
      const prompt = JSON.parse(input.messages[input.messages.length - 1].content);
      return JSON.stringify({ actionId: prompt.actionId, actionKind: prompt.applicationDecision.actionKind,
        questionCode: prompt.applicationDecision.questionCode, groundingAcknowledgement: null, text: 'どの学習を計画しましょうか？' });
    }) })));
}
it('keeps an invocation-local semantic observer out of persisted receipts and server payloads', async () => {
  const fixture = durableReceipt();
  const observer = { client: { createChatCompletion: vi.fn(async () => 'must not be used') },
    finish: vi.fn(), privateMarker: 'local-only-observer-sentinel' };
  const result = weeklyPlanningTurnRuntimeGateway.execute({
    snapshot: fixture.snapshot,
    pending: { ...fixture.pending, startedAt: new Date().toISOString() },
    userText: '10月14日の計画を立てたい', selectedDate: DATE, userId: OWNER,
    plans: [], scheduleTemplates: [], semanticObservation: observer,
  });
  await vi.waitFor(() => expect(record?.status).toBe('queued'));
  expect(readDurableWeeklyTurnReceipt(OWNER)?.payload.input).not.toHaveProperty('semanticObservation');
  expect(JSON.parse(record!.payload!).input).not.toHaveProperty('semanticObservation');
  expect(record!.payload).not.toContain(observer.privateMarker);
  await runAlarm(); await vi.advanceTimersByTimeAsync(10_000);
  expect((await result).message).toBe('どの学習を計画しましょうか？');
  expect(providerCalls).toBe(2); expect(observer.client.createChatCompletion).not.toHaveBeenCalled();
  expect(observer.finish).not.toHaveBeenCalled();
});
it('finishes while detached and restores exactly one reply through the real controller without another AI call or save', async () => {
  const first = await mount(); let submitted!: Promise<WeeklyPlanningTurnSubmissionResult>;
  await act(async () => { submitted = first.ref.current!.submitTurn('10月14日の計画を立てたい'); await vi.waitFor(() => expect(record?.status).toBe('queued'));  });
  expect(record?.status).toBe('queued'); expect(methods).toEqual(['POST']); expect(first.ref.current!.state.pendingTurn).toBeDefined();
  const receipt = readDurableWeeklyTurnReceipt(OWNER)!; expect(receipt).not.toBeNull();
  await act(async () => renderer!.unmount()); renderer = undefined;
  await runAlarm(); expect(record?.status).toBe('completed'); expect(providerCalls).toBe(2);
  // The new application has no JS runtime sessions; only durable local receipt + saved conversation survive.
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  const second = await mount();
  await act(async () => { windowEvents.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(10_000); });
  expect((await submitted).accepted).toBe(false);
  expect(second.ref.current!.state.pendingTurn).toBeUndefined();
  expect(second.ref.current!.state.messages.filter((m) => m.role === 'user')).toHaveLength(1);
  expect(second.ref.current!.state.messages.filter((m) => m.role === 'assistant')).toEqual([expect.objectContaining({ content: 'どの学習を計画しましょうか？' })]);
  expect(methods.filter((method) => method === 'POST')).toHaveLength(1); expect(providerCalls).toBe(2);
  expect(second.database.metrics).toEqual({ planWrites: 0, itemWrites: 0, operationWrites: 0 });
  await act(async () => renderer!.unmount()); renderer = undefined; resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  const third = await mount(); await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(third.ref.current!.state.messages.filter((m) => m.role === 'assistant')).toHaveLength(1);
  expect(providerCalls).toBe(2); expect(methods.filter((method) => method === 'POST')).toHaveLength(1);
});

it('only explicit cancellation stops accepted work and is not resumed after reload', async () => {
  const first = await mount(); let submitted!: Promise<WeeklyPlanningTurnSubmissionResult>;
  await act(async () => { submitted = first.ref.current!.submitTurn('10月14日の計画を立てたい'); await vi.waitFor(() => expect(record?.status).toBe('queued')); });
  await act(async () => { expect(first.ref.current!.cancelTurn()).toBe(true); await vi.waitFor(() => expect(record?.failure).toBe('cancelled')); });
  await runAlarm(); expect(providerCalls).toBe(0);
  await act(async () => { windowEvents.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(10_000); });
  expect((await submitted).accepted).toBe(false); expect(readDurableWeeklyTurnReceipt(OWNER)).toBeNull();
  await act(async () => renderer!.unmount()); renderer = undefined; resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  const second = await mount(); await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(second.ref.current!.state.pendingTurn).toBeUndefined(); expect(providerCalls).toBe(0);
  expect(methods.filter((method) => method === 'POST')).toHaveLength(1);
  expect(methods).toContain('DELETE');
});
