import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { createLocalFixture, STAMP } from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import type { ScheduleTemplate } from '../types/domain';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
const showNotice = vi.fn();
function Harness() { state = usePlannerDataState({ userId: 'owner', showNotice }); return null; }
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks(); });
const template: ScheduleTemplate = {
  id: 'class', userId: 'owner', title: 'Class', subject: 'Math', type: 'school-event', weekday: 'mon',
  startTime: '14:00', endTime: '15:00', termId: 'default', memo: '', active: true,
  createdAt: STAMP, updatedAt: STAMP,
};

it.each([
  { interval: 2 as const, anchor: ' 2026-10-05 ', expected: '2026-10-05' },
  { interval: 1 as const, anchor: 'invalid', expected: null },
])('persists normalized anchor $expected for interval $interval', async ({ interval, anchor, expected }) => {
  boundary.repository = createLocalFixture().repository;
  const save = vi.spyOn(boundary.repository, 'upsertScheduleTemplate');
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.saveScheduleTemplate({ ...template, weekInterval: interval, weekIntervalAnchorDate: anchor }); });
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0][0].weekIntervalAnchorDate).toBe(expected);
  expect(state.scheduleTemplates[0].weekIntervalAnchorDate).toBe(expected);
});

it.each(['', '2026-02-30', 'not-a-date'])('rejects invalid fortnightly anchor %j before persistence', async anchor => {
  boundary.repository = createLocalFixture().repository;
  const save = vi.spyOn(boundary.repository, 'upsertScheduleTemplate');
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => {
    await expect(state.saveScheduleTemplate({ ...template, weekInterval: 2, weekIntervalAnchorDate: anchor }))
      .rejects.toThrow('隔週の授業は基準日を設定してください。');
  });
  expect(save).not.toHaveBeenCalled();
  expect(state.scheduleTemplates).toEqual([]);
});
