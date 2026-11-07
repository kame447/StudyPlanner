import { createRef, forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferred, createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../../../../src/features/weeklyPlanning/testUtils/weeklyPlanningApplicationTestHarness';
import { createReadyPlannerDataAvailability } from '../../../../src/features/weeklyPlanning/testUtils/plannerDataAvailabilityTest';
import type { WeeklyPlanningApplication, UseWeeklyPlanningApplicationInput } from '../../../../src/features/weeklyPlanning/application/useWeeklyPlanningApplication';
import { useWeeklyPlanningVNextApplication, type WeeklyPlanningVNextLocalApplicationServices } from '../../../../src/features/weeklyPlanning/vnext/application/useWeeklyPlanningVNextApplication';
import { createWeeklyPlanningVNextLocalSession } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextLocalSession';
import { createWeeklyDraftBlocksFromPreviewCandidates } from '../../../../src/features/weeklyPlanning/preview/weeklyPlanningPreviewBlocks';
import { createWeeklyPlanningApprovalMemoryState, createMemoryWeeklyPlanningApprovalPlanRepository } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningApprovalMemoryRepository';
import { loadWeeklyPlanningApprovalOperations } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningApprovalLedgerStorage';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeSession';
import { resetWeeklyPlanningStableV5TraceRuntimeForTest } from '../../../../src/features/weeklyPlanning/trace/weeklyPlanningStableV5TraceRuntime';
import { readDurableWeeklyTurnReceipt } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningDurableTurnClient';
import { successfulWeeklyPlanningRendererCompletion } from '../../../../src/features/weeklyPlanning/testUtils/__tests__/weeklyPlanningRendererCompletionFixture';
import { DurableTurnJob, type DurableTurnRecord } from './durableTurnJob';
import { executeDurableVNextJob } from './durableVNextTurn';
import type { VNextAddFact, VNextTurnDelta } from '../../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextTypes';
import * as aiConfig from '../../../../src/lib/aiConfig';
import * as firebase from '../../../../src/lib/firebaseClient';
import { getEntryDurationMinutes } from '../../../../src/lib/entryTimeRange';

const OWNER = 'a66-owner'; const WEEK = '2026-11-02'; const NOW = `${WEEK}T00:00:00.000Z`;
const env = { OPENAI_API_KEY: 'synthetic-server-key', ALLOWED_CHAT_MODELS: 'gpt-6-luna',
  AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) }) } } as never;
const work = (id = 'math', title = '数学', minutes = 30): VNextAddFact[] => [
  { kind: 'task', localId: id, category: 'study', title },
  { kind: 'workload', localId: `${id}-work`, taskRef: { localId: id }, componentRef: null,
    quantityRole: 'target', amount: minutes, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null },
];
const reading = (add = work(), patch: VNextTurnDelta['patch'] = []) => ({ planningIntent: 'create_plan', conversationActs: [], answer: null,
  delta: { add, patch, remove: [], relate: [], defer: [] } });
type NativeContext = { activeFacts: { workloads: { id: string }[] } };
type Step = ReturnType<typeof reading> | ((context: NativeContext) => ReturnType<typeof reading>) | 'provider-failure';
const Harness = forwardRef<WeeklyPlanningApplication, { input: UseWeeklyPlanningApplicationInput; services: WeeklyPlanningVNextLocalApplicationServices }>((props, ref) => {
  const app = useWeeklyPlanningVNextApplication(props.input, props.services); useImperativeHandle(ref, () => app, [app]); return null;
});

let storage: ReturnType<typeof createMemoryStorageHarness>; let restore: () => void;
let renderer: ReactTestRenderer | undefined; let authOwner: string; let windowEvents: EventTarget;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime(NOW);
  vi.stubEnv('VITE_DURABLE_WEEKLY_TURNS', 'enabled'); vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'false');
  storage = createMemoryStorageHarness(); restore = installWeeklyPlanningTestStorage(storage.storage);
  windowEvents = new EventTarget(); Object.assign(window, { addEventListener: windowEvents.addEventListener.bind(windowEvents), removeEventListener: windowEvents.removeEventListener.bind(windowEvents) });
  const events = new EventTarget(); vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) });
  authOwner = OWNER;
  vi.spyOn(aiConfig, 'getCloudflareAiProxyUrl').mockReturnValue('https://a66.fixture.test');
  vi.spyOn(firebase, 'getFirebaseAuth').mockImplementation(() => ({ currentUser: { uid: authOwner, getIdToken: async () => `synthetic:${authOwner}` } }) as never);
  resetWeeklyPlanningStableV5RuntimeSessionsForTest(); resetWeeklyPlanningStableV5TraceRuntimeForTest();
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount()); renderer = undefined;
  resetWeeklyPlanningStableV5RuntimeSessionsForTest(); resetWeeklyPlanningStableV5TraceRuntimeForTest();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); restore();
});

// Only transport, the model and persistence are synthetic. The production hook, durable client,
// journal/job, Worker interpreter/renderer, staging controller and approval application run unchanged.
async function fixture(steps: Step[] = [reading()], options: { queued?: boolean; failSaveAt?: number } = {}) {
  const memory = createWeeklyPlanningApprovalMemoryState(); const repository = createMemoryWeeklyPlanningApprovalPlanRepository(memory);
  const ref = createRef<WeeklyPlanningApplication>(); const methods: string[] = []; let nativeCalls = 0;
  let providerGate: ReturnType<typeof createDeferred<void>> | undefined;
  let providerStarted = createDeferred<void>(); let saveGate: ReturnType<typeof createDeferred<void>> | undefined;
  let saveAttempts = 0;
  const save = vi.fn(async (draft: Parameters<typeof repository.saveApprovedPlan>[0]) => {
    saveAttempts++;
    if (saveAttempts === options.failSaveAt) throw new Error('synthetic interrupted save');
    if (saveGate) await saveGate.promise;
    return repository.saveApprovedPlan(draft);
  });
  const services: WeeklyPlanningVNextLocalApplicationServices = { storage: storage.storage, now: () => new Date().toISOString(),
    client: () => { throw new Error('browser must not invoke the provider'); },
    interpret: () => { throw new Error('browser must not interpret'); },
    createRenderer: () => { throw new Error('browser must not render the Worker result'); } };
  let input: UseWeeklyPlanningApplicationInput = { userId: OWNER, selectedDate: WEEK, plans: [], scheduleTemplates: [],
    plannerDataAvailability: createReadyPlannerDataAvailability(OWNER), isPlannerDataSnapshotCurrent: () => true,
    saveWeeklyApprovedPlan: save, completeWeeklyApprovalOperation: repository.completeOperation };
  const jobs = new Map<string, { job: DurableTurnJob; record?: DurableTurnRecord }>();
  async function run(entry: { job: DurableTurnJob }) {
    await entry.job.run((raw, dispatch) => executeDurableVNextJob(env, JSON.parse(raw), dispatch));
  }
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).startsWith('https://a66.fixture.test/weekly-planning/turns')) {
      const ownerId = String((init!.headers as Record<string, string>).Authorization).replace('Bearer synthetic:', '');
      methods.push(init?.method ?? 'GET');
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)); const key = `${ownerId}:${body.conversationId}`;
        let entry = jobs.get(key);
        if (!entry) {
          const slot: { record?: DurableTurnRecord } = {};
          const job = new DurableTurnJob({ read: async () => slot.record && structuredClone(slot.record),
            write: async value => { slot.record = structuredClone(value); }, alarmAt: async () => {} });
          entry = { job, get record() { return slot.record; } }; jobs.set(key, entry);
        }
        const accepted = await entry.job.accept({ ...body, ownerId, payload: JSON.stringify(body.payload) });
        if (options.queued) return Response.json(accepted, { status: 202 });
        await run(entry);
        return Response.json(await entry.job.status({ ownerId, conversationId: body.conversationId, requestId: body.requestId }));
      }
      const query = new URL(String(url)).searchParams; const conversationId = query.get('conversationId')!;
      const entry = jobs.get(`${ownerId}:${conversationId}`);
      if (!entry) return new Response(null, { status: 404 });
      const identity = { ownerId, conversationId, requestId: query.get('requestId')! };
      if (init?.method === 'DELETE') return Response.json(await entry.job.cancel({ ...identity, baseRevision: Number(query.get('baseRevision')), startedAt: Number(query.get('startedAt')) }));
      const status = await entry.job.status(identity);
      return status ? Response.json(status) : new Response(null, { status: 404 });
    }
    const body = JSON.parse(String(init?.body)); const schema = body.response_format?.json_schema?.name;
    let content: string;
    if (schema === 'weekly_planning_vnext_native_v1') {
      nativeCalls++; providerStarted.resolve(); if (providerGate) await providerGate.promise;
      const step = steps.shift(); if (!step) throw new Error('unexpected native request/repair');
      if (step === 'provider-failure') throw new TypeError('synthetic provider failure');
      const context = body.messages.map((m: { content: string }) => { try { return JSON.parse(m.content); } catch { return null; } }).find((v: NativeContext | null) => v?.activeFacts);
      content = JSON.stringify(typeof step === 'function' ? step(context) : step);
    } else content = await successfulWeeklyPlanningRendererCompletion(body);
    return Response.json({ model: 'gpt-6-luna', choices: [{ message: { content } }] });
  }));
  const view = () => <Harness ref={ref} input={input} services={services} />;
  async function mount() { await act(async () => { renderer = create(view()); }); await act(async () => { ref.current!.chat.initialize(); }); }
  await mount();
  return { ref, memory, save, methods, jobs, nativeCalls: () => nativeCalls,
    pauseProvider() { providerGate = createDeferred<void>(); providerStarted = createDeferred<void>(); return { started: providerStarted.promise, release: () => { providerGate!.resolve(); providerGate = undefined; } }; },
    pauseSave() { saveGate = createDeferred<void>(); return () => { saveGate!.resolve(); saveGate = undefined; }; },
    async reload() { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; resetWeeklyPlanningStableV5RuntimeSessionsForTest(); await mount(); },
    async update(overrides: Partial<UseWeeklyPlanningApplicationInput>) {
      input = { ...input, ...overrides, ...(overrides.userId ? { plannerDataAvailability: createReadyPlannerDataAvailability(overrides.userId) } : {}) };
      authOwner = input.userId!; await act(async () => renderer!.update(view()));
    },
    core() { return createWeeklyPlanningVNextLocalSession({ ownerId: input.userId!, weekStartDate: ref.current!.state.weekStartDate,
      chatId: ref.current!.chat.index.activeChatId, storage: storage.storage }).readCheckpoint(); },
    async promote() {
      const candidates = ref.current!.state.previewCandidates!;
      const blocks = createWeeklyDraftBlocksFromPreviewCandidates({ candidates, userId: input.userId!, createdAt: NOW });
      await act(async () => { expect(ref.current!.createDraftBlocks(blocks)).toBe(true); candidates.forEach(c => ref.current!.removePreviewCandidate(c.stableKey)); });
      return blocks;
    },
    async runQueued() { for (const entry of jobs.values()) await run(entry); },
  };
}

describe('#978 A66 public operations through the actual VNext Worker', () => {
  it('A01/A14: concurrent send is admitted once and sequential turns preserve ordering', async () => {
    const h = await fixture([reading(), { ...reading([]), planningIntent: 'discuss' }]); const gate = h.pauseProvider();
    let first!: ReturnType<WeeklyPlanningApplication['submitTurn']>;
    await act(async () => { first = h.ref.current!.submitTurn('数学30分の計画案を作って'); await gate.started; });
    await act(async () => { expect((await h.ref.current!.submitTurn('二重送信')).accepted).toBe(false); gate.release(); await first; });
    await act(async () => { expect((await h.ref.current!.submitTurn('ありがとうございます')).accepted).toBe(true); });
    expect(h.ref.current!.state.messages.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(h.methods.filter(m => m === 'POST')).toHaveLength(2); expect(h.nativeCalls()).toBe(2);
    expect(h.ref.current!.state.previewCandidates).toHaveLength(1); expect(h.memory.plans.size).toBe(0);
  });

  it('A02/A03: cancellation discards a late Worker result and a new turn starts from the accepted checkpoint', async () => {
    const h = await fixture([reading(), reading()]); const gate = h.pauseProvider();
    let pending!: ReturnType<WeeklyPlanningApplication['submitTurn']>;
    await act(async () => { pending = h.ref.current!.submitTurn('数学30分の計画案を作って'); await gate.started; });
    await act(async () => { expect(h.ref.current!.cancelTurn()).toBe(true); gate.release(); expect((await pending).accepted).toBe(false); });
    expect(h.ref.current!.state.previewCandidates).toEqual([]); expect(h.core()).toBeNull(); expect(h.methods).toContain('DELETE');
    await act(async () => { expect((await h.ref.current!.submitTurn('もう一度、数学30分の計画案を作って')).accepted).toBe(true); });
    expect(h.core()!.vnext.state.graph.revision).toBe(1);
    expect(h.core()!.vnext.state.graph.workloads.map(w => w.amount)).toEqual([30]); expect(h.memory.plans.size).toBe(0);
  });

  it('A04/A05/A28: a detached client resumes one completed Worker reply without another POST or provider call', async () => {
    const h = await fixture([reading()], { queued: true }); let pending!: ReturnType<WeeklyPlanningApplication['submitTurn']>;
    await act(async () => { pending = h.ref.current!.submitTurn('数学30分の計画案を作って'); await vi.waitFor(() => expect(h.methods).toEqual(['POST'])); });
    expect(readDurableWeeklyTurnReceipt(OWNER, 'vnext')).not.toBeNull();
    await act(async () => renderer!.unmount()); renderer = undefined;
    await h.runQueued();
    await h.reload();
    await act(async () => { windowEvents.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(10_000); });
    expect((await pending).accepted).toBe(false);
    expect(h.ref.current!.state.messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(h.ref.current!.state.previewCandidates).toHaveLength(1);
    await h.reload();
    expect(h.ref.current!.state.messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(h.nativeCalls()).toBe(1); expect(h.methods.filter(m => m === 'POST')).toHaveLength(1); expect(h.memory.plans.size).toBe(0);
  });

  it('A08/A09/A10/A11-A13/A17-A23: explicit promotion then Save writes once across pending approval and reload', async () => {
    const h = await fixture(); await act(async () => { await h.ref.current!.submitTurn('数学30分の計画案を作って'); });
    expect(h.ref.current!.state.draftBlocks).toEqual([]); await act(async () => h.ref.current!.approveDraftBlocks());
    expect(h.save).not.toHaveBeenCalled();
    const candidates = h.ref.current!.state.previewCandidates!; expect(candidates).toHaveLength(1);
    await h.reload(); expect(h.ref.current!.state.previewCandidates).toEqual(candidates); expect(h.nativeCalls()).toBe(1);
    await h.promote(); expect(h.save).not.toHaveBeenCalled();
    const release = h.pauseSave(); let approval!: Promise<void>;
    await act(async () => { approval = h.ref.current!.approveDraftBlocks(); await vi.waitFor(() => expect(h.save).toHaveBeenCalledTimes(1)); });
    expect(h.ref.current!.state.pendingApproval).toBeDefined();
    await act(async () => { await h.ref.current!.approveDraftBlocks(); release(); await approval; });
    expect(h.memory.plans.size).toBe(1); expect(h.memory.metrics.planWrites).toBe(1);
    const operationId = loadWeeklyPlanningApprovalOperations(OWNER)[0].approvalOperationId;
    await h.reload(); await act(async () => h.ref.current!.approveDraftBlocks());
    expect(h.save).toHaveBeenCalledTimes(1); expect(h.memory.metrics.planWrites).toBe(1);
    expect(loadWeeklyPlanningApprovalOperations(OWNER)[0]).toMatchObject({ approvalOperationId: operationId, status: 'completed' });
  });

  it('A16: partial Save resumes the original operation after reload without saving the acknowledged block again', async () => {
    const h = await fixture([reading([...work(), ...work('english', '英語', 20)])], { failSaveAt: 2 });
    await act(async () => { await h.ref.current!.submitTurn('数学30分と英語20分の計画案を作って'); }); await h.promote();
    await act(async () => { await expect(h.ref.current!.approveDraftBlocks()).rejects.toThrow(); });
    expect(h.memory.plans.size).toBe(1); const operationId = loadWeeklyPlanningApprovalOperations(OWNER)[0].approvalOperationId;
    await h.reload(); await act(async () => h.ref.current!.approveDraftBlocks());
    expect(h.memory.plans.size).toBe(2); expect(h.memory.metrics.planWrites).toBe(2); expect(h.save).toHaveBeenCalledTimes(3);
    expect(loadWeeklyPlanningApprovalOperations(OWNER)[0]).toMatchObject({ approvalOperationId: operationId, status: 'completed' });
    await act(async () => h.ref.current!.approveDraftBlocks()); expect(h.save).toHaveBeenCalledTimes(3);
  });

  it('owner fence: an in-flight Worker result cannot publish into the next owner', async () => {
    const h = await fixture(); const gate = h.pauseProvider(); let pending!: ReturnType<WeeklyPlanningApplication['submitTurn']>;
    await act(async () => { pending = h.ref.current!.submitTurn('数学30分の計画案を作って'); await gate.started; });
    await h.update({ userId: 'a66-other-owner' });
    await act(async () => { gate.release(); expect((await pending).accepted).toBe(false); });
    expect(h.ref.current!.state.messages).toEqual([]); expect(h.ref.current!.state.previewCandidates).toEqual([]);
    expect(h.core()).toBeNull(); expect(h.memory.plans.size).toBe(0);
  });

  it('A06: clearing message history retains the Worker preview across reload without another model request', async () => {
    const h = await fixture(); await act(async () => { await h.ref.current!.submitTurn('数学30分の計画案を作って'); });
    const candidates = h.ref.current!.state.previewCandidates!;
    expect(candidates).toHaveLength(1);
    await act(async () => { expect(h.ref.current!.clearConversation()).toBe(true); });
    expect(h.ref.current!.state.messages).toEqual([]); expect(h.ref.current!.state.previewCandidates).toEqual(candidates);
    await h.reload();
    expect(h.ref.current!.state.messages).toEqual([]); expect(h.ref.current!.state.previewCandidates).toEqual(candidates);
    expect(h.nativeCalls()).toBe(1); expect(h.memory.plans.size).toBe(0);
  });

  it('A07: weekly reset archives the Worker conversation and preserves already saved plans', async () => {
    const h = await fixture(); await act(async () => { await h.ref.current!.submitTurn('数学30分の計画案を作って'); });
    const chatId = h.ref.current!.chat.index.activeChatId!;
    await h.promote(); await act(async () => h.ref.current!.approveDraftBlocks());
    const planIds = [...h.memory.plans.keys()]; expect(planIds).toHaveLength(1);
    const savedMessages = h.ref.current!.state.messages;
    await act(async () => { h.ref.current!.resetSession(); });
    expect(h.ref.current!.state.messages).toEqual([]); expect(h.ref.current!.state.previewCandidates).toEqual([]);
    expect(h.ref.current!.state.draftBlocks).toEqual([]);
    expect(h.ref.current!.chat.index.chats).toHaveLength(2);
    await act(async () => { expect(h.ref.current!.chat.select(chatId).status).toBe('saved'); });
    expect(h.ref.current!.state.messages).toEqual(savedMessages);
    await h.reload(); expect([...h.memory.plans.keys()]).toEqual(planIds);
    expect(h.nativeCalls()).toBe(1); expect(h.save).toHaveBeenCalledTimes(1);
  });

  it('A15: a Worker provider failure clears pending state and the next explicit turn succeeds', async () => {
    const h = await fixture(['provider-failure', reading()]);
    await act(async () => { await h.ref.current!.submitTurn('数学30分の計画案を作って'); });
    expect(h.ref.current!.state.pendingTurn).toBeUndefined(); expect(h.ref.current!.state.previewCandidates).toEqual([]);
    expect(h.memory.plans.size).toBe(0);
    await act(async () => { expect((await h.ref.current!.submitTurn('もう一度、数学30分の計画案を作って')).accepted).toBe(true); });
    expect(h.ref.current!.state.pendingTurn).toBeUndefined(); expect(h.ref.current!.state.previewCandidates).toHaveLength(1);
    expect(h.core()!.vnext.state.graph.workloads.map(w => w.amount)).toEqual([30]);
    expect(h.nativeCalls()).toBe(2); expect(h.memory.plans.size).toBe(0);
  });

  it('A24/A25: invalid duration exhausts one repair without a preview; a later valid hour saves once across reload', async () => {
    const invalid = reading(work('math', '数学', -60));
    const h = await fixture([invalid, invalid, reading(work('math', '数学', 60))]);
    await act(async () => { await expect(h.ref.current!.submitTurn('数学を1時間勉強する計画案を作って')).rejects.toThrow(); });
    expect(h.nativeCalls()).toBe(2); expect(h.ref.current!.state.previewCandidates).toEqual([]);
    expect(h.memory.plans.size).toBe(0);
    await act(async () => { expect((await h.ref.current!.submitTurn('改めて数学60分の計画案を作って')).accepted).toBe(true); });
    expect(h.ref.current!.state.previewCandidates!.map(c => c.durationMinutes)).toEqual([60]);
    await h.promote(); expect(h.save).not.toHaveBeenCalled();
    await act(async () => h.ref.current!.approveDraftBlocks()); await h.reload();
    await act(async () => h.ref.current!.approveDraftBlocks());
    expect(h.memory.metrics.planWrites).toBe(1); expect(h.save).toHaveBeenCalledTimes(1);
    const saved = [...h.memory.plans.values()][0]; expect(getEntryDurationMinutes(saved.startTime, saved.endTime)).toBe(60);
  });

  it('stale revision fence: an old draft cannot save after a Worker correction, while the fresh preview can', async () => {
    const h = await fixture([reading(), context => reading([], [{ kind: 'workload', localId: 'twenty',
      targetFactId: context.activeFacts.workloads[0].id, amountDelta: null, changes: { amount: 20, quantityRole: null,
        unitCode: null, unitLabel: null, rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null } }])]);
    await act(async () => { await h.ref.current!.submitTurn('数学30分の計画案を作って'); });
    const old = createWeeklyDraftBlocksFromPreviewCandidates({ candidates: h.ref.current!.state.previewCandidates!, userId: OWNER, createdAt: NOW });
    const revision = h.core()!.vnext.state.graph.revision;
    await act(async () => { expect((await h.ref.current!.submitTurn('数学を20分に訂正した計画案を作って')).accepted).toBe(true); });
    expect(h.ref.current!.state.previewCandidates!.map(c => c.durationMinutes)).toEqual([20]);
    expect(h.core()!.vnext.state.graph.revision).toBeGreaterThan(revision);
    const fresh = createWeeklyDraftBlocksFromPreviewCandidates({ candidates: h.ref.current!.state.previewCandidates!, userId: OWNER, createdAt: NOW });
    await act(async () => { expect(h.ref.current!.createDraftBlocks(old)).toBe(true); });
    // The old block IDs are absent from the accepted preview, so no runtime can authorize them.
    expect(h.ref.current!.approvalAvailability).toMatchObject({ kind: 'recompute_required', reason: 'session_runtime_unavailable' });
    await act(async () => { await expect(h.ref.current!.approveDraftBlocks()).rejects.toThrow(); });
    expect(h.save).not.toHaveBeenCalled(); expect(h.memory.plans.size).toBe(0);
    await act(async () => { h.ref.current!.clearDraftBlocks(); expect(h.ref.current!.createDraftBlocks(fresh)).toBe(true); });
    await act(async () => h.ref.current!.approveDraftBlocks());
    expect(h.memory.plans.size).toBe(1);
    const saved = [...h.memory.plans.values()][0]; expect(getEntryDurationMinutes(saved.startTime, saved.endTime)).toBe(20);
  });

  it('A47-A52: removing one Worker candidate before promotion saves only the retained candidate', async () => {
    const h = await fixture([reading([...work(), ...work('english', '英語', 20)])]);
    await act(async () => { await h.ref.current!.submitTurn('数学30分と英語20分の計画案を作って'); });
    const candidates = h.ref.current!.state.previewCandidates!; expect(candidates).toHaveLength(2);
    const [removed, retained] = candidates;
    await act(async () => h.ref.current!.removePreviewCandidate(removed.stableKey));
    expect(h.ref.current!.state.previewCandidates).toEqual([retained]); expect(h.memory.plans.size).toBe(0);
    await h.promote(); await act(async () => h.ref.current!.approveDraftBlocks());
    expect(h.memory.plans.size).toBe(1); expect(h.memory.items.size).toBe(1);
    expect([...h.memory.plans.values()][0].title).toBe(retained.title);
    expect(h.save).toHaveBeenCalledTimes(1); expect(h.nativeCalls()).toBe(1);
  });
});
