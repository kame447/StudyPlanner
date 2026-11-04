import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalFixture } from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import type { DurationActualInput } from '../domain/durationActuals';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';
import type { ShowNotice } from './useNoticeState';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));

const showNotice = vi.fn<ShowNotice>();
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
function Harness() { state = usePlannerDataState({ userId: 'owner', showNotice }); return null; }
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks(); });

const week: DurationActualInput[] = [
  { id: 'wp-actual-c1-2026-10-26-math', occurrenceDate: '2026-10-26', subject: '数学', title: '数学', minutes: 60 },
  { id: 'wp-actual-c1-2026-10-27-english', occurrenceDate: '2026-10-27', subject: '英語', title: '英語', minutes: 45 },
];
async function mount(override: Partial<PlannerRepository> = {}) {
  const fixture = createLocalFixture();
  boundary.repository = { ...fixture.repository, ...override };
  showNotice.mockClear();
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner'); });
  return fixture;
}

describe('usePlannerDataState.saveDurationActualsBatch', () => {
  it('publishes the saved records for the signed-in owner, time-only, and a repeat adds none', async () => {
    const fixture = await mount();
    await act(async () => { await state.saveDurationActualsBatch(week); });
    expect(state.actuals.map((actual) => [actual.id, actual.userId, actual.actualDurationMinutes])).toEqual(
      expect.arrayContaining([[week[0].id, 'owner', 60], [week[1].id, 'owner', 45]]));
    expect(state.actuals).toHaveLength(2);
    expect(state.actuals.every((actual) => actual.actualStartTime === undefined && actual.planId === null)).toBe(true);
    await act(async () => { await state.saveDurationActualsBatch(week); });
    expect(state.actuals).toHaveLength(2);
    expect((await fixture.repository.getActuals('owner'))).toHaveLength(2);
  });

  it('leaves the state unchanged, reports the failure and rejects when the save fails', async () => {
    await mount({ saveDurationActualsBatch: vi.fn(async () => { throw new Error('boom'); }) });
    await act(async () => { await expect(state.saveDurationActualsBatch(week)).rejects.toThrow(); });
    expect(state.actuals).toEqual([]);
    expect(showNotice).toHaveBeenCalledWith(expect.any(String), 'error');
  });

  it('saves nothing and rejects an invalid batch', async () => {
    const save = vi.fn();
    await mount({ saveDurationActualsBatch: save });
    await act(async () => { await expect(state.saveDurationActualsBatch([week[0], { ...week[1], minutes: 0 }])).rejects.toThrow(); });
    expect(save).not.toHaveBeenCalled();
    expect(state.actuals).toEqual([]);
  });
});
