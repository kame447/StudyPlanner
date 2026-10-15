import { describe, expect, it, vi } from 'vitest';
import { addDays } from '../lib/date';
import { buildStudyStreakModel } from '../lib/studyStreak';
import { createLocalStudyStreakRepository } from './studyStreakRepository';
import { actual, createLocalFixture } from './localPersistenceConcurrency.testUtils';

async function fixture() {
  const local = createLocalFixture();
  await Promise.all(Array.from({ length: 7 }, (_, index) => local.repository.upsertActual(actual({
    id: `actual-${index}`, planId: null, occurrenceDate: addDays('2026-10-01', index),
  }))));
  let queue = Promise.resolve();
  const lock = <T,>(_name: string, work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work); queue = result.then(() => undefined, () => undefined); return result;
  };
  return { ...local, lock, streak: createLocalStudyStreakRepository(local.storage, local.repository, lock) };
}

describe('rest-date persistence', () => {
  it('survives recreation, never writes Actuals, and makes exact-date retries idempotent', async () => {
    const f = await fixture(), before = await f.repository.getActuals('owner');
    const history = await f.streak.read('owner');
    await f.streak.useRestDay(history, '2026-10-08', '2026-10-09');
    await f.streak.useRestDay(history, '2026-10-08', '2026-10-09');
    const reopened = createLocalStudyStreakRepository(f.storage, f.repository, f.lock);
    expect((await reopened.read('owner')).restDays).toEqual([{ date: '2026-10-08' }]);
    expect(await f.repository.getActuals('owner')).toEqual(before);
    expect((await reopened.read('other')).restDays).toEqual([]);
  });

  it('serializes two independent consumers and recalculates the latest used dates', async () => {
    const f = await fixture();
    const other = createLocalStudyStreakRepository(f.storage, f.repository, f.lock);
    const history = await f.streak.read('owner');
    const outcomes = await Promise.allSettled([
      f.streak.useRestDay(history, '2026-10-08', '2026-10-09'),
      other.useRestDay(history, '2026-10-09', '2026-10-10'),
    ]);
    expect(outcomes.map(row => row.status)).toEqual(['fulfilled', 'rejected']);
    expect(buildStudyStreakModel({ ...await f.streak.read('owner'), today: '2026-10-09' }).availableTickets).toBe(0);
  });

  it('does not overwrite corrupt history or claim quota failures succeeded', async () => {
    const f = await fixture(), history = await f.streak.read('owner');
    vi.spyOn(f.storage, 'setItem').mockImplementationOnce(() => { throw new Error('quota'); });
    await expect(f.streak.useRestDay(history, '2026-10-08', '2026-10-09')).rejects.toThrow('quota');
    expect((await f.streak.read('owner')).restDays).toEqual([]);
    f.storage.setItem('studyplanner.studyRestDays.v1:owner', '{bad');
    await expect(f.streak.read('owner')).rejects.toThrow();
    await expect(f.streak.useRestDay(history, '2026-10-08', '2026-10-09')).rejects.toThrow();
    expect(f.storage.getItem('studyplanner.studyRestDays.v1:owner')).toBe('{bad');
    f.storage.removeItem('studyplanner.studyRestDays.v1:owner');
    f.storage.setItem('studyplanner.actuals', '{bad actuals');
    await expect(f.streak.read('owner')).rejects.toThrow();
    await expect(f.streak.useRestDay(history, '2026-10-08', '2026-10-09')).rejects.toThrow();
    expect(f.storage.getItem('studyplanner.actuals')).toBe('{bad actuals');
  });

  it('does not offer unsafe multi-tab spending without a lock and rechecks corrected Actuals before writing', async () => {
    const f = await fixture(), history = await f.streak.read('owner');
    const unsupported = createLocalStudyStreakRepository(f.storage, f.repository, null);
    expect(unsupported.canUseRestDays).toBe(false);
    await expect(unsupported.useRestDay(history, '2026-10-08', '2026-10-09')).rejects.toThrow();
    await f.repository.deleteActual('owner', 'actual-2');
    await expect(f.streak.useRestDay(history, '2026-10-08', '2026-10-09')).rejects.toThrow();
  });
});

it('reads complete local major-event sources, preserves rest storage, and refuses corrupt legacy event storage', async () => {
  const f = await fixture();
  const job = { id: 'job', userId: 'owner', title: '塾バイト', date: '2026-10-07', startTime: '17:00', endTime: '21:30',
    repeat: 'none' as const, repeatUntil: null, excludedDates: [], url: '', memo: '', checklist: [], locationTags: [], createdAt: '', updatedAt: '' };
  await f.repository.upsertMonthEvent(job);
  await f.repository.upsertActual(actual({ id: 'actual-6', planId: job.id, occurrenceDate: '2026-10-07' }));
  const restKey = 'studyplanner.studyRestDays.v1:owner';
  const storedRest = JSON.stringify({ schemaVersion: 1, userId: 'owner', revision: 1, dates: ['2026-10-08'] });
  f.storage.setItem(restKey, storedRest);
  const actuals = await f.repository.getActuals('owner');
  const history = await f.streak.read('owner');
  expect(history.monthEvents).toEqual([expect.objectContaining(job)]);
  expect(buildStudyStreakModel({ ...history, today: '2026-10-09' }))
    .toMatchObject({ earnedTickets: 0, protectedDates: [], unprotectedRestDates: ['2026-10-08'] });
  expect(f.storage.getItem(restKey)).toBe(storedRest);
  expect(await f.repository.getActuals('owner')).toEqual(actuals);
  f.storage.setItem('studyplanner.monthEvents', '{invalid');
  await expect(f.streak.read('owner')).rejects.toThrow();
  expect(f.storage.getItem('studyplanner.monthEvents')).toBe('{invalid');
  expect(f.storage.getItem(restKey)).toBe(storedRest);
});
