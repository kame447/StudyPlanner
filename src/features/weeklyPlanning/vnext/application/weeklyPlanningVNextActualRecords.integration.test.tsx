import { forwardRef, createRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { createReadyPlannerDataAvailability } from '../../testUtils/plannerDataAvailabilityTest';
import type { WeeklyPlanningApplication, UseWeeklyPlanningApplicationInput } from '../../application/useWeeklyPlanningApplication';
import { useWeeklyPlanningVNextApplication, type WeeklyPlanningVNextLocalApplicationServices } from './useWeeklyPlanningVNextApplication';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from '../../application/weeklyPlanningStableV5RuntimeSession';

const OWNER = 'exam-owner'; const WEEK = '2026-10-26'; const NOW = '2026-11-03T00:00:00.000Z';
const Harness = forwardRef<WeeklyPlanningApplication, { input: UseWeeklyPlanningApplicationInput; services: WeeklyPlanningVNextLocalApplicationServices }>((props, ref) => {
  const app = useWeeklyPlanningVNextApplication(props.input, props.services);
  useImperativeHandle(ref, () => app, [app]);
  return null;
});

describe('VNext application: study records waiting for confirmation (#973)', () => {
  let storage: ReturnType<typeof createMemoryStorageHarness>;
  let restore: () => void;
  let renderer: ReactTestRenderer | undefined;
  beforeEach(() => {
    storage = createMemoryStorageHarness(); restore = installWeeklyPlanningTestStorage(storage.storage);
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  });
  afterEach(async () => {
    if (renderer) await act(async () => renderer!.unmount());
    renderer = undefined; resetWeeklyPlanningStableV5RuntimeSessionsForTest(); restore();
  });

  it('offers no records and never calls the save port when the conversation proposed none', async () => {
    const saveWeeklyActualRecords = vi.fn(() => Promise.resolve());
    const input: UseWeeklyPlanningApplicationInput = { userId: OWNER, selectedDate: WEEK, plans: [], scheduleTemplates: [],
      plannerDataAvailability: createReadyPlannerDataAvailability(OWNER), isPlannerDataSnapshotCurrent: () => true,
      saveWeeklyApprovedPlan: vi.fn(), saveWeeklyActualRecords };
    const services: WeeklyPlanningVNextLocalApplicationServices = { storage: storage.storage, client: () => ({} as never),
      interpret: () => async () => { throw new Error('no provider turn in this test'); }, now: () => NOW,
      createRenderer: () => ({ render: async () => ({ status: 'rendered', text: '', rawResponse: '' }) }) };
    const ref = createRef<WeeklyPlanningApplication>();
    await act(async () => { renderer = create(<Harness ref={ref} input={input} services={services} />); });
    expect(ref.current!.pendingActualRecords).toEqual([]);
    await act(async () => { await ref.current!.approveActualRecords!(); });
    expect(saveWeeklyActualRecords).not.toHaveBeenCalled();
  });
});
