import { createRef, forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { createReadyPlannerDataAvailability } from '../../testUtils/plannerDataAvailabilityTest';
import type { WeeklyPlanningApplication, UseWeeklyPlanningApplicationInput } from '../../application/useWeeklyPlanningApplication';
import { useWeeklyPlanningVNextApplication, type WeeklyPlanningVNextLocalApplicationServices } from './useWeeklyPlanningVNextApplication';
import { WeeklyPlanningRuntimeModuleError } from '../../application/weeklyPlanningRuntimeLoader';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from '../../application/weeklyPlanningStableV5RuntimeSession';
import { createWeeklyPlanningApprovalMemoryState, createMemoryWeeklyPlanningApprovalPlanRepository } from '../../application/weeklyPlanningApprovalMemoryRepository';
import { createInMemoryWeeklyPlanningTraceRepository } from '../../trace/weeklyPlanningTraceInMemoryRepository';
import { setWeeklyPlanningTraceRepositoryForTests } from '../../trace/weeklyPlanningTraceRepository';
import { resetWeeklyPlanningStableV5TraceRuntimeForTest } from '../../trace/weeklyPlanningStableV5TraceRuntime';

// The VNext preparation is the V5 sequence: stale planner data is reported as stale (before and after the
// preflight), and a failed lazy runtime chunk rejects before any OCR, interpretation or provider work.
const chunk = vi.hoisted(() => ({ load: vi.fn<() => Promise<unknown>>(async () => ({})) }));
vi.mock('./weeklyPlanningVNextRuntimeLoader', () => ({ loadWeeklyPlanningVNextRuntimeModule: () => chunk.load() }));

const OWNER = 'prepare-owner'; const WEEK = '2026-11-02'; const NOW = '2026-11-02T00:00:00.000Z';
const Harness = forwardRef<WeeklyPlanningApplication, { input: UseWeeklyPlanningApplicationInput; services: WeeklyPlanningVNextLocalApplicationServices }>((props, ref) => {
  const app = useWeeklyPlanningVNextApplication(props.input, props.services); useImperativeHandle(ref, () => app, [app]); return null;
});

describe('VNext prepareTurn and submit admission', () => {
  let storage: ReturnType<typeof createMemoryStorageHarness>; let restore: () => void; let renderer: ReactTestRenderer | undefined;
  beforeEach(() => { chunk.load.mockReset().mockResolvedValue({});
    storage = createMemoryStorageHarness(); restore = installWeeklyPlanningTestStorage(storage.storage);
    vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'false');
    resetWeeklyPlanningStableV5RuntimeSessionsForTest(); resetWeeklyPlanningStableV5TraceRuntimeForTest();
    setWeeklyPlanningTraceRepositoryForTests(createInMemoryWeeklyPlanningTraceRepository()); });
  afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined;
    resetWeeklyPlanningStableV5RuntimeSessionsForTest(); resetWeeklyPlanningStableV5TraceRuntimeForTest();
    setWeeklyPlanningTraceRepositoryForTests(undefined); vi.unstubAllEnvs(); restore(); });

  async function mount(lease: { current: boolean }) {
    const repository = createMemoryWeeklyPlanningApprovalPlanRepository(createWeeklyPlanningApprovalMemoryState());
    const paid = { client: vi.fn(() => ({} as never)), interpret: vi.fn(() => async () => { throw new Error('no interpretation expected'); }),
      createRenderer: vi.fn(() => ({ render: async () => { throw new Error('no renderer expected'); } })) };
    const services: WeeklyPlanningVNextLocalApplicationServices = { storage: storage.storage, now: () => NOW,
      client: paid.client as never, interpret: paid.interpret as never, createRenderer: paid.createRenderer as never };
    const input: UseWeeklyPlanningApplicationInput = { userId: OWNER, selectedDate: WEEK, plans: [], scheduleTemplates: [],
      plannerDataAvailability: createReadyPlannerDataAvailability(OWNER), isPlannerDataSnapshotCurrent: () => lease.current,
      saveWeeklyApprovedPlan: repository.saveApprovedPlan, completeWeeklyApprovalOperation: repository.completeOperation };
    const ref = createRef<WeeklyPlanningApplication>();
    await act(async () => { renderer = create(<Harness ref={ref} input={input} services={services} />); });
    await act(async () => { ref.current!.chat.initialize(); });
    return { ref, paid };
  }

  it('is ready when the data is current and the runtime chunk loads', async () => {
    const { ref } = await mount({ current: true });
    expect(await ref.current!.prepareTurn()).toEqual({ ready: true });
    expect(chunk.load).toHaveBeenCalledTimes(1);
  });

  it('reports planner-data-changed when the bound data is already stale, without loading the chunk', async () => {
    const { ref } = await mount({ current: false });
    expect(await ref.current!.prepareTurn()).toEqual({ ready: false, reason: 'planner-data-changed' });
    expect(chunk.load).not.toHaveBeenCalled();
    expect(await ref.current!.submitTurn('数学を30分')).toMatchObject({ accepted: false, rejectionReason: 'planner-data-changed' });
  });

  it('reports planner-data-changed when the data goes stale while the chunk loads', async () => {
    const lease = { current: true };
    const { ref, paid } = await mount(lease);
    chunk.load.mockImplementation(async () => { lease.current = false; return {}; });
    expect(await ref.current!.prepareTurn()).toEqual({ ready: false, reason: 'planner-data-changed' });
    chunk.load.mockClear(); lease.current = true;
    chunk.load.mockImplementation(async () => { lease.current = false; return {}; });
    expect(await ref.current!.submitTurn('数学を30分')).toMatchObject({ accepted: false, rejectionReason: 'planner-data-changed' });
    expect(paid.client).not.toHaveBeenCalled();
  });

  it('rejects with the module error before any provider or interpretation work when the chunk fails', async () => {
    const { ref, paid } = await mount({ current: true });
    chunk.load.mockRejectedValue(new WeeklyPlanningRuntimeModuleError(new Error('chunk failed')));
    await expect(ref.current!.prepareTurn()).rejects.toBeInstanceOf(WeeklyPlanningRuntimeModuleError);
    await expect(ref.current!.submitTurn('数学を30分')).rejects.toBeInstanceOf(WeeklyPlanningRuntimeModuleError);
    expect(paid.client).not.toHaveBeenCalled(); expect(paid.interpret).not.toHaveBeenCalled(); expect(paid.createRenderer).not.toHaveBeenCalled();
    expect(ref.current!.state.messages).toEqual([]);
    expect(ref.current!.state.pendingTurn).toBeUndefined();
  });
});
