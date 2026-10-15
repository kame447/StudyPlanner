import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { buildQuickEntryPlanDraft, resolveQuickEntryEndTime } from '../lib/quickEntryDrafts';
import { addDays } from '../lib/date';
import { buildWeeklyStudySeries } from '../lib/studyAnalytics';
import { normalizeStudyRecordsForDisplay, sumStudyRecordMinutes } from '../lib/studyRecords';
import { createScheduleOccurrenceProjection } from '../domain/scheduleOccurrence';
import { createPlanDraftFromPlan } from '../domain/planner';
import { createLocalPlannerRepository } from '../repositories/createLocalPlannerRepository';
import { createLocalFixture } from '../repositories/localPersistenceConcurrency.testUtils';
import type { PlannerRepository } from '../repositories/repositoryContracts';
import type { ActualDraft } from '../types/domain';
import { usePlannerDataState, type UsePlannerDataStateResult } from './usePlannerDataState';

const boundary = vi.hoisted(() => ({ repository: null as unknown as PlannerRepository }));
vi.mock('../repositories', () => ({ plannerRepository: new Proxy({}, {
  get: (_target, key) => boundary.repository[key as keyof PlannerRepository],
}) }));
let state: UsePlannerDataStateResult;
let renderer: ReactTestRenderer | undefined;
function Harness() { state = usePlannerDataState({ userId: 'owner', showNotice: vi.fn() }); return null; }
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks(); });
async function mount() {
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await state.loadPlannerData('owner'); });
}
const planDraft = (date = '2026-10-15', startTime = '23:30', duration = 60) => buildQuickEntryPlanDraft({
  mode: 'scheduled', userId: 'owner', title: 'Overnight', subject: 'Math', type: 'study', memo: '',
  date, startTime, estimatedMinutes: duration, repeatKind: 'daily', weekdays: [],
})!;
const actualDraft = (date = '2026-10-15', startTime = '23:30', duration = 60): ActualDraft => ({
  userId: 'owner', planId: null, title: 'Overnight', subject: 'Math', occurrenceDate: date,
  actualStartTime: startTime, actualEndTime: resolveQuickEntryEndTime(startTime, duration), isAlignedToPlan: false, note: '',
});

for (const date of ['2026-10-15', '2026-10-31', '2026-12-31']) {
  for (const [startTime, duration, endTime] of [['19:00', 60, '20:00'], ['23:30', 60, '00:30'], ['23:30', 30, '00:00']] as const) {
    it(`saves and freshly reloads Plan/Actual ${date} ${startTime}–${endTime} with correct projection and a single total`, async () => {
      const fixture = createLocalFixture();
      boundary.repository = fixture.repository;
      await mount();
      await act(async () => {
        await state.createPlanDraft(planDraft(date, startTime, duration));
        await state.saveStandaloneActual(actualDraft(date, startTime, duration));
      });
      const fresh = createLocalPlannerRepository(fixture.storage);
      const plans = await fresh.getPlans('owner');
      const actuals = await fresh.getActuals('owner');
      expect(plans).toEqual([expect.objectContaining({ date, startTime, endTime })]);
      expect(actuals).toEqual([expect.objectContaining({ occurrenceDate: date, actualStartTime: startTime, actualEndTime: endTime })]);
      act(() => renderer?.unmount());
      boundary.repository = fresh;
      await mount();
      expect(state.plans).toEqual(plans);
      expect(state.actuals).toEqual(actuals);
      const projection = createScheduleOccurrenceProjection({ ownerId: 'owner', startDate: date, endDate: addDays(date, 1), plans });
      expect(projection.occurrences).toHaveLength(1);
      expect(projection.occurrences[0].start).toEqual({ date, time: startTime });
      expect(projection.occurrences[0].end).toEqual({ date: startTime === '19:00' ? date : addDays(date, 1), time: endTime });
      const nextDay = createScheduleOccurrenceProjection({ ownerId: 'owner', startDate: addDays(date, 1), endDate: addDays(date, 1), plans });
      expect(nextDay.occurrences).toHaveLength(endTime === '00:30' ? 1 : 0);
      const records = normalizeStudyRecordsForDisplay({ plans, actuals });
      expect(records).toHaveLength(1);
      expect(sumStudyRecordMinutes(records)).toBe(duration);
      const weekly = buildWeeklyStudySeries(date, plans, actuals);
      expect(weekly.find(day => day.date === date)?.minutes).toBe(duration);
      expect(weekly.filter(day => day.date !== date).every(day => day.minutes === 0)).toBe(true);
    });
  }
}

it('retains overnight duration and one identity through Plan and linked Actual edits', async () => {
  const fixture = createLocalFixture(); boundary.repository = fixture.repository; await mount();
  await act(async () => { await state.createPlanDraft(planDraft()); });
  const plan = state.plans[0];
  await act(async () => { await state.savePlanDraft({ ...createPlanDraftFromPlan(plan), memo: 'updated' }, plan.id); });
  await act(async () => { await state.saveActual(plan, { ...actualDraft(), planId: plan.id }); });
  const actual = state.actuals[0];
  await act(async () => { await state.saveActual(plan, { ...actualDraft(), planId: plan.id, note: 'edited' }, actual.id); });
  expect(await fixture.repository.getPlans('owner')).toEqual([expect.objectContaining({ id: plan.id, startTime: '23:30', endTime: '00:30', memo: 'updated' })]);
  expect(await fixture.repository.getActuals('owner')).toEqual([expect.objectContaining({ id: actual.id, planId: plan.id, actualStartTime: '23:30', actualEndTime: '00:30', note: 'edited' })]);
});

it('preserves the start-day recurrence and overnight tail after canonical persistence', async () => {
  const fixture = createLocalFixture(); boundary.repository = fixture.repository; await mount();
  const draft = planDraft('2026-12-31');
  await act(async () => { await state.createPlanDraft({ ...draft, repeat: 'daily' }); });
  const plans = await createLocalPlannerRepository(fixture.storage).getPlans('owner');
  const projection = createScheduleOccurrenceProjection({ ownerId: 'owner', startDate: '2027-01-01', endDate: '2027-01-01', plans });
  expect(projection.occurrences.map(row => [row.start, row.end])).toEqual([
    [{ date: '2026-12-31', time: '23:30' }, { date: '2027-01-01', time: '00:30' }],
    [{ date: '2027-01-01', time: '23:30' }, { date: '2027-01-02', time: '00:30' }],
  ]);
});

it.each([['24:00', '00:30'], ['23:60', '00:30'], ['23:30', '24:01'], ['bad', '00:30'], ['12:30', '12:30']])(
  'rejects invalid %s–%s at the real save boundary without mutation', async (startTime, endTime) => {
    const fixture = createLocalFixture(); boundary.repository = fixture.repository; await mount();
    await act(async () => {
      await expect(state.createPlanDraft({ ...planDraft(), startTime, endTime })).rejects.toThrow('有効な開始時刻と終了時刻を入力してください。');
      await expect(state.savePlanDraft({ ...planDraft(), startTime, endTime })).rejects.toThrow('有効な開始時刻と終了時刻を入力してください。');
      await expect(state.saveStandaloneActual({ ...actualDraft(), actualStartTime: startTime, actualEndTime: endTime })).rejects.toThrow('有効な開始時刻と終了時刻を入力してください。');
    });
    expect(await fixture.repository.getPlans('owner')).toEqual([]);
    expect(await fixture.repository.getActuals('owner')).toEqual([]);
  },
);
