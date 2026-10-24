import { expect, it } from 'vitest';
import { createPlanFromDraft } from './planner';
import { buildRecurringPlanDeleteMutation } from './recurringPlanMutation';
import { expandPlansForDate } from '../lib/planRecurrence';
import { createLocalPlannerRepository } from '../repositories/createLocalPlannerRepository';
import { MemoryStorage } from '../repositories/localPersistenceConcurrency.testUtils';
import type { Actual } from '../types/domain';

const date = '2026-10-18';
function makeSource(dates = [date], isOverride = false) {
  return createPlanFromDraft({
    userId: 'owner', title: 'One date', subject: 'Math', memo: 'Keep source identity',
    date: dates[0], startTime: '09:00', endTime: '10:00', type: 'study', repeat: 'none',
    repeatUntil: null, excludedDates: [], recurrenceRules: [{
      id: 'explicit-dates', kind: 'date', dates, startDate: dates[0], until: dates[dates.length - 1],
      weekdays: [], dayType: null, isOverride, startTime: '09:00', endTime: '10:00',
    }],
  });
}
async function deleteSingle(storage: MemoryStorage, targetDate = date) {
  const repository = createLocalPlannerRepository(storage);
  const plans = await repository.getPlans('owner');
  const actuals = await repository.getActuals('owner');
  const mutation = buildRecurringPlanDeleteMutation(plans, actuals, plans[0], targetDate, 'single');
  await repository.applyRecurringPlanMutation('owner', mutation);
  return mutation;
}

it.each([false, true])('does not recreate a one-off after deleting its only date and reloading (override=%s)', async isOverride => {
  const source = makeSource([date], isOverride);
  const storage = new MemoryStorage();
  const repository = createLocalPlannerRepository(storage);
  await repository.upsertPlan(source);
  const original = await repository.getPlans(source.userId);
  expect(expandPlansForDate(original, date)).toHaveLength(1);
  const mutation = await deleteSingle(storage);
  expect(mutation.planDeletes).toEqual([]);
  const reloaded = await createLocalPlannerRepository(storage).getPlans(source.userId);
  expect(expandPlansForDate(reloaded, date)).toEqual([]);
  expect(reloaded[0]).toMatchObject({ id: source.id, seriesId: source.seriesId, recurrenceRules: original[0].recurrenceRules, excludedDates: [date] });
});

it('does not resurrect the original anchor after sequentially deleting every explicit date', async () => {
  const dates = ['2026-10-04', '2026-10-11', date];
  const source = makeSource(dates);
  const storage = new MemoryStorage();
  await createLocalPlannerRepository(storage).upsertPlan(source);
  for (const target of dates) {
    await deleteSingle(storage, target);
    const reloaded = await createLocalPlannerRepository(storage).getPlans(source.userId);
    expect(dates.filter(value => expandPlansForDate(reloaded, value).length > 0)).toEqual(dates.filter(value => value > target));
  }
});

it('keeps the existing non-final date deletion and other occurrence values', async () => {
  const dates = ['2026-10-04', '2026-10-11', date];
  const source = makeSource(dates);
  const storage = new MemoryStorage();
  await createLocalPlannerRepository(storage).upsertPlan(source);
  await deleteSingle(storage, '2026-10-11');
  const plans = await createLocalPlannerRepository(storage).getPlans(source.userId);
  expect(plans[0].recurrenceRules[0].dates).toEqual(['2026-10-04', date]);
  expect(expandPlansForDate(plans, '2026-10-11')).toEqual([]);
  for (const target of ['2026-10-04', date]) expect(expandPlansForDate(plans, target)[0]).toMatchObject({ id: source.id, title: source.title, subject: source.subject, memo: source.memo });
});

function makeActual(planId: string, id: string, occurrenceDate = date, userId = 'owner'): Actual {
  return { id, userId, planId, occurrenceDate, actualStartTime: '09:05', actualEndTime: '09:55', subject: 'Recorded Math', note: 'Keep history', updatedAt: '2026-10-18T10:00:00.000Z' };
}

it('deletes only target-occurrence Actuals without moving IDs or cascading other history', async () => {
  const source = makeSource();
  const storage = new MemoryStorage();
  const repository = createLocalPlannerRepository(storage);
  await repository.upsertPlan(source);
  const target = makeActual(source.id, 'target');
  const duplicate = makeActual(source.id, 'target-duplicate');
  const past = makeActual(source.id, 'past', '2026-10-04');
  past.progressSource = { kind: 'study', sourceId: source.id, planType: 'study' };
  const unrelated = makeActual('other-plan', 'unrelated');
  const foreign = makeActual(source.id, 'foreign', date, 'other-owner');
  storage.setItem('studyplanner.actuals', JSON.stringify([target, duplicate, past, unrelated, foreign]));
  const mutation = await deleteSingle(storage);
  expect(mutation.actualDeletes).toHaveLength(1);
  expect(mutation.actualDeletes[0]).toMatchObject({ planId: source.id, occurrenceDate: date });
  expect(mutation.actualUpserts).toEqual([]);
  const reloaded = createLocalPlannerRepository(storage);
  expect(await reloaded.getActuals('owner')).toEqual(expect.arrayContaining([past, unrelated]));
  expect(await reloaded.getActuals('owner')).toHaveLength(2);
  expect(await reloaded.getActuals('other-owner')).toEqual([foreign]);
  expect((await reloaded.getPlans('owner'))[0].id).toBe(source.id);
  expect(JSON.parse(storage.getItem('studyplanner.actuals')!)).toEqual(expect.arrayContaining([past, unrelated, foreign]));
  expect(JSON.parse(storage.getItem('studyplanner.actuals')!)).toHaveLength(3);
});

it.each(['studyplanner.scheduleEvents.v1', 'studyplanner.actuals'])('rolls back on %s rejection and permits retry', async failKey => {
  class FailingStorage extends MemoryStorage {
    failingKey: string | null = null;
    override setItem(key: string, value: string) {
      if (key === this.failingKey) { this.failingKey = null; throw new Error('injected rejection'); }
      super.setItem(key, value);
    }
  }
  const storage = new FailingStorage();
  const source = makeSource();
  const repository = createLocalPlannerRepository(storage);
  await repository.upsertPlan(source);
  const target = makeActual(source.id, 'target');
  storage.setItem('studyplanner.actuals', JSON.stringify([target]));
  const before = await repository.getPlans('owner');
  storage.failingKey = failKey;
  await expect(deleteSingle(storage)).rejects.toThrow('injected rejection');
  const reloaded = createLocalPlannerRepository(storage);
  expect(await reloaded.getPlans('owner')).toEqual(before);
  expect(await reloaded.getActuals('owner')).toEqual([target]);
  await deleteSingle(storage);
  expect(expandPlansForDate(await createLocalPlannerRepository(storage).getPlans('owner'), date)).toEqual([]);
  expect(await reloaded.getActuals('owner')).toEqual([]);
});
