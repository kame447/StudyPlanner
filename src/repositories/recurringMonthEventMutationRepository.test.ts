import { describe, expect, it } from 'vitest';
import { createLocalPlannerRepository } from './createLocalPlannerRepository';
import { createLocalPlannerStorageGateway } from './localStorageGateway';
import { createPlannerRepository } from './plannerRepository';
import {
  MemoryStorage, createLocalFixture, event, microtasks, mutation, pauseActualWrite, plan,
} from './localPersistenceConcurrency.testUtils';

class FaultStorage extends MemoryStorage {
  failKey: string | null = null;
  writes: string[] = [];
  override setItem(key: string, value: string): void {
    this.writes.push(key);
    if (key === this.failKey) {
      this.failKey = null;
      throw new Error('Storage write rejected');
    }
    super.setItem(key, value);
  }
  snapshot() { return [...this.values.entries()]; }
}

const source = event({ repeat: 'weekly' });
const changed = event({ repeat: 'weekly', excludedDates: ['2026-10-11'] });
const replacement = event({ id: 'replacement', date: '2026-10-11', endDate: '2026-10-11', title: 'Changed occurrence' });

for (const mode of ['canonical', 'legacy'] as const) {
  const storageKey = mode === 'canonical' ? 'studyplanner.scheduleEvents.v1' : 'studyplanner.monthEvents';
  async function setup() {
    const storage = new FaultStorage();
    const gateway = createLocalPlannerStorageGateway(storage);
    const repository = mode === 'canonical' ? createLocalPlannerRepository(storage) : createPlannerRepository(gateway);
    await repository.upsertMonthEvent(source);
    await repository.upsertMonthEvent(event({ id: 'unrelated' }));
    await repository.upsertMonthEvent(event({ id: 'foreign', userId: 'other-owner' }));
    await repository.upsertPlan(plan({ id: source.id }));
    storage.writes.length = 0;
    return { storage, repository };
  }

  describe(`${mode} local recurring MonthEvent persistence`, () => {
    it('saves both records in one physical collection write and preserves other records', async () => {
      const { storage, repository } = await setup();
      const previousPlans = await repository.getPlans('owner');
      const foreign = await repository.getMonthEvents('other-owner');
      await repository.applyRecurringMonthEventMutation('owner', [changed, replacement]);
      expect(storage.writes).toEqual([storageKey]);
      expect(await repository.getMonthEvents('owner')).toEqual([changed, event({ id: 'unrelated' }), replacement]);
      expect(await repository.getMonthEvents('other-owner')).toEqual(foreign);
      expect(await repository.getPlans('owner')).toEqual(previousPlans);
    });

    it('saves a first-occurrence future edit as one record without inserting another series', async () => {
      const { storage, repository } = await setup();
      const updated = { ...source, title: 'Updated from the first occurrence' };
      await repository.applyRecurringMonthEventMutation('owner', [updated]);
      expect(storage.writes).toEqual([storageKey]);
      expect(await repository.getMonthEvents('owner')).toEqual([updated, event({ id: 'unrelated' })]);
    });

    it('leaves all durable data unchanged when the one physical write fails', async () => {
      const { storage, repository } = await setup();
      const before = storage.snapshot();
      storage.failKey = storageKey;
      await expect(repository.applyRecurringMonthEventMutation('owner', [changed, replacement])).rejects.toThrow('Storage write rejected');
      expect(storage.writes).toEqual([storageKey]);
      expect(storage.snapshot()).toEqual(before);
      expect(await repository.getMonthEvents('owner')).toEqual([source, event({ id: 'unrelated' })]);
    });

    it.each([
      { name: 'mixed owner', rows: [changed, { ...replacement, userId: 'other-owner' }], message: '所有者が一致しません' },
      { name: 'duplicate id', rows: [changed, changed], message: 'IDが重複' },
      { name: 'empty', rows: [], message: '1〜2件' },
      { name: 'oversized', rows: [changed, replacement, event({ id: 'third' })], message: '1〜2件' },
      { name: 'existing foreign id', rows: [changed, { ...replacement, id: 'foreign' }], message: '所有者が一致しません' },
    ])('rejects $name before any write', async ({ rows, message }) => {
      const { storage, repository } = await setup();
      const before = storage.snapshot();
      await expect(repository.applyRecurringMonthEventMutation('owner', rows)).rejects.toThrow(message);
      expect(storage.writes).toEqual([]);
      expect(storage.snapshot()).toEqual(before);
    });
  });
}

describe('local recurring MonthEvent shared queue', () => {
  it('waits for a concurrent operation and rollback, then publishes both rows before a queued reader', async () => {
    const storage = new MemoryStorage();
    const first = createLocalFixture(storage);
    const second = createLocalPlannerRepository(storage);
    await first.repository.upsertMonthEvent(source);
    const pause = pauseActualWrite(first.gateway);
    const restoring = first.repository.restorePlanWithDependents(mutation()).catch(error => error);
    await pause.entered.promise;
    let saved = false;
    let read = false;
    const saving = second.applyRecurringMonthEventMutation('owner', [changed, replacement]).then(() => { saved = true; });
    const reading = first.repository.getMonthEvents('owner').then(rows => { read = true; return rows; });
    await microtasks();
    expect([saved, read]).toEqual([false, false]);
    const failure = new Error('Concurrent restore failed');
    pause.release.reject(failure);
    expect(await restoring).toBe(failure);
    await saving;
    expect(await reading).toEqual([changed, replacement]);
    expect(await first.repository.getPlans('owner')).toEqual([]);
  });

  it('releases the queue after the atomic write fails and preserves a later accepted write', async () => {
    const storage = new FaultStorage();
    const first = createLocalPlannerRepository(storage);
    const second = createLocalPlannerRepository(storage);
    await first.upsertMonthEvent(source);
    storage.failKey = 'studyplanner.scheduleEvents.v1';
    const failed = first.applyRecurringMonthEventMutation('owner', [changed, replacement]).catch(error => error);
    const later = event({ title: 'Later accepted title', repeat: 'weekly' });
    const saving = second.upsertMonthEvent(later);
    expect(await failed).toEqual(new Error('Storage write rejected'));
    await saving;
    expect(await first.getMonthEvents('owner')).toEqual([later]);
  });
});
