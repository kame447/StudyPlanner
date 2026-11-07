import { createRef, forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { createReadyPlannerDataAvailability } from '../../testUtils/plannerDataAvailabilityTest';
import type { WeeklyPlanningApplication, UseWeeklyPlanningApplicationInput } from '../../application/useWeeklyPlanningApplication';
import { useWeeklyPlanningVNextApplication, type WeeklyPlanningVNextLocalApplicationServices } from './useWeeklyPlanningVNextApplication';
import { conversationSyncFakeServer, conversationSyncMemoryStore, SYNC_TEST_NOW } from '../sync/conversationSyncTestFixture';
import { createInMemoryWeeklyPlanningTraceRepository } from '../../trace/weeklyPlanningTraceInMemoryRepository';
import { setWeeklyPlanningTraceRepositoryForTests } from '../../trace/weeklyPlanningTraceRepository';
import { resetWeeklyPlanningStableV5TraceRuntimeForTest } from '../../trace/weeklyPlanningStableV5TraceRuntime';
import { createWeeklyPlanningApprovalMemoryState, createMemoryWeeklyPlanningApprovalPlanRepository } from '../../application/weeklyPlanningApprovalMemoryRepository';
import { createWeeklyDraftBlocksFromPreviewCandidates } from '../../preview/weeklyPlanningPreviewBlocks';
import { validateConversationPayload, validateLocalConversationPayload } from '../sync/weeklyPlanningConversationPayload';

const OWNER = 'sync-app-owner', WEEK = '2026-11-02';
const Harness = forwardRef<WeeklyPlanningApplication, { input: UseWeeklyPlanningApplicationInput; services: WeeklyPlanningVNextLocalApplicationServices }>((props, ref) => {
  const application = useWeeklyPlanningVNextApplication(props.input, props.services);
  useImperativeHandle(ref, () => application, [application]); return null;
});
let mounted: ReactTestRenderer | undefined;
let restore: (() => void) | undefined;
function device(server = conversationSyncFakeServer()) {
  const storage = createMemoryStorageHarness(); const local = conversationSyncMemoryStore();
  const savedPlan = vi.fn(); const savedActuals = vi.fn(); const acquired = vi.fn(async () => () => {});
  const input: UseWeeklyPlanningApplicationInput = { userId: OWNER, selectedDate: WEEK, plans: [], actuals: [], scheduleTemplates: [],
    plannerDataAvailability: createReadyPlannerDataAvailability(OWNER), isPlannerDataSnapshotCurrent: () => true,
    saveWeeklyApprovedPlan: savedPlan, saveWeeklyActualRecords: savedActuals };
  const services: WeeklyPlanningVNextLocalApplicationServices = {
    storage: storage.storage, now: () => SYNC_TEST_NOW, client: () => ({} as never),
    conversationSync: async () => ({ local, remote: server.remote, keys: () => [...storage.values.keys()],
      online: () => true, acquire: acquired }),
    interpret: () => async () => ({ status: 'interpreted', planningIntent: 'create_plan', answer: null, conversationActs: [],
      delta: { add: [
        { kind: 'task', localId: 'math', category: 'study', title: '数学' },
        { kind: 'workload', localId: 'math-time', taskRef: { localId: 'math' }, componentRef: null,
          quantityRole: 'remaining', amount: 60, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null,
          perOccurrence: false, periodExpression: null },
      ], patch: [], remove: [], relate: [], defer: [] }, metrics: { calls: 1, repairs: 0, latencyMs: 1 } }),
    createRenderer: () => ({ render: async () => ({ status: 'rendered', text: '数学を60分の計画案です。', rawResponse: '' }) }),
  };
  const result = { storage, local, server, services, input, savedPlan, savedActuals, acquired };
  return result;
}
async function mount(fixture: ReturnType<typeof device>) {
  if (mounted) await act(async () => mounted!.unmount()); mounted = undefined;
  restore?.(); restore = installWeeklyPlanningTestStorage(fixture.storage.storage);
  const ref = createRef<WeeklyPlanningApplication>();
  await act(async () => { mounted = create(<Harness ref={ref} input={fixture.input} services={fixture.services} />); });
  await act(async () => { await vi.waitFor(() => expect(ref.current?.conversationSync?.status).not.toBe('checking')); });
  return ref;
}
async function waitSynced(ref: { current: WeeklyPlanningApplication | null }) {
  await act(async () => { await vi.waitFor(() => expect(ref.current?.conversationSync?.status).toBe('synced'), { timeout: 2500 }); });
}
beforeEach(() => { setWeeklyPlanningTraceRepositoryForTests(createInMemoryWeeklyPlanningTraceRepository()); resetWeeklyPlanningStableV5TraceRuntimeForTest(); });
afterEach(async () => {
  if (mounted) await act(async () => mounted!.unmount()); mounted = undefined; restore?.(); restore = undefined;
  setWeeklyPlanningTraceRepositoryForTests(undefined); resetWeeklyPlanningStableV5TraceRuntimeForTest();
});

describe('VNext actual application with shared conversation storage', () => {
  it.each(['not_committed', 'response_lost'] as const)('persists approval recovery locally, withholds it from cloud, and reconciles after reload (%s)', async failure => {
    const a = device();
    const memory = createWeeklyPlanningApprovalMemoryState();
    const repository = createMemoryWeeklyPlanningApprovalPlanRepository(memory);
    const save = vi.fn(repository.saveApprovedPlan).mockImplementationOnce(async draft => {
      if (failure === 'response_lost') await repository.saveApprovedPlan(draft);
      throw new Error('synthetic approval response unavailable');
    });
    a.input.saveWeeklyApprovedPlan = save;
    a.input.completeWeeklyApprovalOperation = repository.completeOperation;
    const ref = await mount(a);
    await act(async () => { await ref.current!.submitTurn('数学60分の計画'); });
    await act(async () => { ref.current!.createDraftBlocks(createWeeklyDraftBlocksFromPreviewCandidates({
      candidates: ref.current!.state.previewCandidates!, userId: OWNER, createdAt: SYNC_TEST_NOW })); });
    await act(async () => { await ref.current!.conversationSync!.enable(); }); await waitSynced(ref);
    expect(ref.current!.pendingDraftBlocks).toHaveLength(1);
    const writes = a.server.writes;
    await act(async () => { await expect(ref.current!.approveDraftBlocks()).rejects.toThrow(); });
    const recovery = ref.current!.state.approvalRecovery;
    expect(recovery).toBeDefined(); expect(memory.metrics.planWrites).toBe(failure === 'response_lost' ? 1 : 0);
    const row = (await a.local.listOwner(OWNER))[0];
    expect(JSON.parse(row.working!.ui).payload.state.approvalRecovery).toEqual(recovery);
    expect(validateLocalConversationPayload(row.scope, row.working!)).toBe(true);
    expect(validateConversationPayload(row.scope, row.working!)).toBe(false);
    expect(a.server.writes).toBe(writes);
    expect(JSON.parse(row.confirmed!.payload!.ui).payload.state.approvalRecovery).toBeUndefined();
    const reloaded = await mount(a);
    expect(reloaded.current!.state.approvalRecovery).toEqual(recovery);
    await act(async () => { await reloaded.current!.approveDraftBlocks(); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[0][0].sourceId).toEqual(expect.any(String));
    expect(save.mock.calls[1][0].sourceId).toBe(save.mock.calls[0][0].sourceId);
    expect(memory.metrics.planWrites).toBe(1); expect(memory.plans.size).toBe(1);
    expect(reloaded.current!.state.approvalRecovery).toBeUndefined();
    const completed = (await a.local.listOwner(OWNER))[0];
    expect(JSON.parse(completed.working!.ui).payload.state.approvalRecovery).toBeUndefined();
    expect(validateConversationPayload(completed.scope, completed.working!)).toBe(true);
    await waitSynced(reloaded);
  });
  it('requires explicit sync consent, migrates a real turn, and restores the same facts/preview on another device', async () => {
    const a = device(); const first = await mount(a);
    expect(first.current!.conversationSync?.status).toBe('disabled');
    await act(async () => { expect((await first.current!.submitTurn('数学を60分、この条件で予定を作って')).accepted).toBe(true); });
    const candidates = first.current!.state.previewCandidates;
    expect(candidates).toHaveLength(1); expect(a.server.writes).toBe(0);
    const legacy = new Map(a.storage.values);
    await act(async () => { await first.current!.conversationSync!.enable(); });
    await waitSynced(first);
    expect(a.acquired).toHaveBeenCalledOnce(); expect(a.server.writes).toBe(1);
    for (const [key, value] of legacy) if (key.includes('weeklyPlanning.vnext.')) expect(a.storage.storage.getItem(key)).toBe(value);
    const activeChatId = first.current!.chat.index.activeChatId;
    const rows = await a.local.listOwner(OWNER);
    expect(rows).toHaveLength(1); expect(rows[0].confirmed?.payload?.core).not.toBeNull();
    expect(a.savedPlan).not.toHaveBeenCalled(); expect(a.savedActuals).not.toHaveBeenCalled();

    const b = device(a.server); const second = await mount(b); await waitSynced(second);
    expect(second.current!.chat.index.activeChatId).toBe(activeChatId);
    expect(second.current!.state.messages.map(row => row.content)).toContain('数学を60分、この条件で予定を作って');
    expect(second.current!.state.previewCandidates).toEqual(candidates);
    expect((await b.local.listOwner(OWNER))[0].confirmed?.payload?.core).toBe(rows[0].confirmed?.payload?.core);
    expect(b.savedPlan).not.toHaveBeenCalled(); expect(b.savedActuals).not.toHaveBeenCalled();
  });
  it('persists post-migration UI changes to IndexedDB without writing the old localStorage snapshot', async () => {
    const a = device(); const ref = await mount(a);
    await act(async () => { await ref.current!.submitTurn('数学60分の計画'); });
    await act(async () => { await ref.current!.conversationSync!.enable(); }); await waitSynced(ref);
    const legacy = new Map(a.storage.values);
    await act(async () => { ref.current!.appendMessage({ id: 'extra', role: 'user', content: 'この内容を覚えて', createdAt: SYNC_TEST_NOW }); });
    await waitSynced(ref);
    expect((await a.local.listOwner(OWNER))[0].working?.ui).toContain('この内容を覚えて');
    for (const [key, value] of legacy) if (key.includes('weeklyPlanning.vnext.')) expect(a.storage.storage.getItem(key)).toBe(value);
    const reloaded = await mount(a); await waitSynced(reloaded);
    expect(reloaded.current!.state.messages.some(row => row.id === 'extra')).toBe(true);
  });
  it('follows an explicit week switch without replacing the previous week conversation', async () => {
    const a = device(); const ref = await mount(a);
    await act(async () => { await ref.current!.submitTurn('数学60分'); });
    await act(async () => { await ref.current!.conversationSync!.enable(); }); await waitSynced(ref);
    const previous = ref.current!.state.messages;
    await act(async () => { mounted!.update(<Harness ref={ref} input={{ ...a.input, selectedDate: '2026-11-09' }} services={a.services} />); });
    expect(ref.current!.state.weekStartDate).toBe('2026-11-09');
    expect(ref.current!.state.messages).toEqual([]);
    await act(async () => { mounted!.update(<Harness ref={ref} input={a.input} services={a.services} />); });
    expect(ref.current!.state.weekStartDate).toBe(WEEK);
    expect(ref.current!.state.messages).toEqual(previous);
  });
  it('shows a locked state rather than opening a second writable browser replica', async () => {
    const a = device(); a.acquired.mockRejectedValue(new Error('conversation-open-in-another-tab'));
    const ref = await mount(a); await act(async () => { await ref.current!.conversationSync!.enable(); });
    expect(ref.current!.conversationSync?.status).toBe('locked');
    expect((await ref.current!.submitTurn('数学')).accepted).toBe(false);
    expect(a.server.writes).toBe(0); expect(a.savedPlan).not.toHaveBeenCalled();
  });
});
