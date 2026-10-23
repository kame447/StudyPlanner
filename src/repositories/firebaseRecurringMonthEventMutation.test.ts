import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { scheduleEventFromMonthEvent } from '../domain/scheduleEvent';
import type { MonthEvent } from '../types/domain';

const mocks = vi.hoisted(() => ({
  records: new Map<string, unknown>(),
  batchSet: vi.fn(), batchCommit: vi.fn(), writeBatch: vi.fn(), setDoc: vi.fn(), getDocs: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ name })),
  deleteDoc: vi.fn(), deleteField: vi.fn(() => 'DELETE_FIELD'),
  doc: vi.fn((_db, collectionName, id) => ({ collectionName, id })),
  getDocs: mocks.getDocs, getDocsFromServer: vi.fn(), getDocFromServer: vi.fn(),
  query: vi.fn((...parts) => ({ parts })), runTransaction: vi.fn(),
  setDoc: mocks.setDoc, where: vi.fn((...parts) => ({ parts })), writeBatch: mocks.writeBatch,
}));

import { createFirebasePlannerRepository } from './firebasePlannerRepository';
import { createFirebaseScheduleEventAuthority } from './firebaseScheduleEventAuthority';

const source: MonthEvent = {
  id: 'source', userId: 'owner', date: '2026-10-04', endDate: '2026-10-04', title: 'Original',
  startTime: '09:00', endTime: '10:00', repeat: 'weekly', repeatUntil: null, excludedDates: [],
  url: '', memo: '', checklist: [], locationTags: [], createdAt: '2026-10-04T00:00:00.000Z', updatedAt: '2026-10-04T00:00:00.000Z',
};
const changed = { ...source, repeatUntil: '2026-10-10' };
const replacement: MonthEvent = { ...source, id: 'replacement', date: '2026-10-11', endDate: '2026-10-11', title: 'Future series', busy: undefined };

type Ref = { collectionName: string; id: string };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.records.clear();
  mocks.batchCommit.mockReset().mockResolvedValue(undefined);
  mocks.writeBatch.mockImplementation(() => {
    const pending: [string, unknown][] = [];
    return {
      set: (ref: Ref, value: unknown, options?: { merge: boolean }) => {
        mocks.batchSet(ref, value, ...(options ? [options] : []));
        pending.push([`${ref.collectionName}/${ref.id}`, value]);
      },
      commit: async () => {
        await mocks.batchCommit();
        pending.forEach(([key, value]) => mocks.records.set(key, value));
      },
    };
  });
});

for (const mode of ['canonical', 'legacy'] as const) {
  const collectionName = mode === 'canonical' ? 'schedule_events' : 'month_events';
  const stored = (row: MonthEvent) => mode === 'canonical' ? scheduleEventFromMonthEvent(row) : row;
  const key = (row: MonthEvent) => `${collectionName}/${mode === 'canonical' ? 'month-event:' : ''}${row.id}`;
  function setup() {
    mocks.records.set(key(source), stored(source));
    mocks.records.set(`${collectionName}/unrelated`, { userId: 'owner', title: 'Unrelated' });
    mocks.records.set(`${collectionName}/foreign`, { userId: 'other-owner', title: 'Foreign' });
    mocks.records.set('plans/plan', { userId: 'owner', title: 'Plan' });
    return mode === 'canonical' ? createFirebaseScheduleEventAuthority({} as Firestore) : createFirebasePlannerRepository({} as Firestore);
  }

  describe(`${mode} Firestore recurring MonthEvent batch`, () => {
    it.each([1, 2])('commits %i upserts once to the existing authority with its established set semantics', async count => {
      const repository = setup();
      const unrelated = [...mocks.records.entries()].slice(1);
      const rows = [changed, replacement].slice(0, count);
      await repository.applyRecurringMonthEventMutation('owner', rows);
      expect(mocks.writeBatch).toHaveBeenCalledOnce();
      expect(mocks.batchSet).toHaveBeenCalledTimes(count);
      expect(mocks.batchCommit).toHaveBeenCalledOnce();
      rows.forEach((row, index) => {
        const ref = { collectionName, id: mode === 'canonical' ? `month-event:${row.id}` : row.id };
        const payload = JSON.parse(JSON.stringify(stored(row)));
        expect(mocks.batchSet.mock.calls[index]).toEqual(mode === 'canonical' ? [ref, payload] : [ref, payload, { merge: true }]);
        expect(mocks.records.get(key(row))).toEqual(payload);
      });
      expect([...mocks.records.entries()].filter(([id]) => unrelated.some(([other]) => other === id))).toEqual(unrelated);
      expect(mocks.setDoc).not.toHaveBeenCalled();
      expect(mocks.getDocs).not.toHaveBeenCalled();
    });

    it.each(['blue', undefined] as const)('writes the selected color %s through normal and recurring persistence boundaries', async color => {
      const repository = setup();
      const row = { ...source, color };
      await repository.upsertMonthEvent(row);
      const normalPayload = mocks.setDoc.mock.calls[0][1];
      await repository.applyRecurringMonthEventMutation('owner', [row]);
      const batchPayload = mocks.batchSet.mock.calls[0][1];
      for (const payload of [normalPayload, batchPayload]) {
        if (mode === 'canonical') {
          if (color) expect(payload.general.color).toBe(color);
          else expect(payload.general).not.toHaveProperty('color');
        } else {
          expect(payload.color).toBe(color ?? 'DELETE_FIELD');
        }
      }
    });

    it('rejects an atomic commit failure without independently saving either row or falling back', async () => {
      const repository = setup();
      const before = [...mocks.records.entries()];
      mocks.batchCommit.mockRejectedValueOnce(new Error('Firestore batch rejected'));
      await expect(repository.applyRecurringMonthEventMutation('owner', [changed, replacement])).rejects.toThrow('Firestore batch rejected');
      expect([...mocks.records.entries()]).toEqual(before);
      expect(mocks.batchCommit).toHaveBeenCalledOnce();
      expect(mocks.setDoc).not.toHaveBeenCalled();
    });

    it.each([
      { rows: [changed, { ...replacement, userId: 'foreign' }], message: '所有者が一致しません' },
      { rows: [changed, changed], message: 'IDが重複' },
      { rows: [], message: '1〜2件' },
      { rows: [changed, replacement, { ...replacement, id: 'third' }], message: '1〜2件' },
    ])('rejects invalid input without creating a batch', async ({ rows, message }) => {
      const repository = setup();
      await expect(repository.applyRecurringMonthEventMutation('owner', rows)).rejects.toThrow(message);
      expect(mocks.writeBatch).not.toHaveBeenCalled();
      expect(mocks.batchCommit).not.toHaveBeenCalled();
    });
  });
}
