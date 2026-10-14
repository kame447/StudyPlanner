import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { addDays } from '../lib/date';
import { actual } from './localPersistenceConcurrency.testUtils';
import { buildStudyStreakModel } from '../lib/studyStreak';
import type { StudyRestState } from './studyStreakRepository';

const mocks = vi.hoisted(() => ({ getDoc: vi.fn(), getDocs: vi.fn(), transaction: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  collection: (_db: unknown, collection: string) => ({ collection }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  query: (source: object, ...conditions: object[]) => ({ ...source, conditions }),
  getDocFromServer: mocks.getDoc,
  getDocsFromServer: mocks.getDocs,
  runTransaction: (_db: unknown, callback: unknown) => mocks.transaction(callback),
}));
import { createFirebaseStudyStreakRepository } from './firebaseStudyStreakRepository';

const metadata = { fromCache: false, hasPendingWrites: false };
const snapshot = (data: unknown) => ({ metadata, exists: () => data !== null, data: () => data });
const rows = (owner = 'owner') => Array.from({ length: 7 }, (_, index) => actual({ id: `a${index}`, userId: owner, planId: null, occurrenceDate: addDays('2026-10-01', index) }));
let stored: StudyRestState | null;
beforeEach(() => {
  vi.clearAllMocks(); stored = null;
  mocks.getDoc.mockImplementation(async reference => reference.collection === 'schedule_event_migrations'
    ? snapshot({ schemaVersion: 1, migrationVersion: 1, status: 'completed' }) : snapshot(stored));
  mocks.getDocs.mockImplementation(async query => ({ metadata, docs: query.collection === 'actuals'
    ? rows(query.conditions.find((item: { field: string }) => item.field === 'userId').value).map(row => ({ id: row.id, data: () => row })) : [] }));
  mocks.transaction.mockImplementation(async callback => {
    let next: StudyRestState | null = null;
    const result = await callback({ get: async () => snapshot(stored), set: (_ref: unknown, value: StudyRestState) => { next = value; } });
    if (next) stored = next;
    return result;
  });
});

describe('server-confirmed streak history and serialized rest dates', () => {
  it('reuses complete history on same-owner reopen, reads only the rest document, and isolates other owners', async () => {
    const repository = createFirebaseStudyStreakRepository({} as Firestore), hint = { plans: [], actuals: rows() };
    await repository.read('owner', { hint });
    const reads = mocks.getDocs.mock.calls.length;
    await repository.read('owner', { hint: JSON.parse(JSON.stringify(hint)) });
    expect(mocks.getDocs).toHaveBeenCalledTimes(reads);
    expect(mocks.getDoc.mock.calls.filter(call => call[0].collection === 'study_rest_days')).toHaveLength(2);
    const other = await repository.read('other', { hint: { plans: [], actuals: rows('other') } });
    expect(other.actuals.every(row => row.userId === 'other')).toBe(true);
    expect(mocks.getDocs).toHaveBeenCalledTimes(reads + 2);
    await repository.read('other', { hint: { plans: [], actuals: rows('other') }, refresh: true });
    expect(mocks.getDocs).toHaveBeenCalledTimes(reads + 4);
  });

  it('rejects permission failure and cache-only/pending history rather than returning an authoritative empty result', async () => {
    const repository = createFirebaseStudyStreakRepository({} as Firestore);
    mocks.getDoc.mockRejectedValueOnce(new Error('permission-denied'));
    await expect(repository.read('owner')).rejects.toThrow('permission-denied');
    for (const uncertain of [{ ...metadata, fromCache: true }, { ...metadata, hasPendingWrites: true }]) {
      mocks.getDocs.mockResolvedValueOnce({ metadata: uncertain, docs: [] });
      await expect(repository.read('owner')).rejects.toThrow('最新');
    }
    mocks.getDoc.mockImplementation(async reference => {
      if (reference.collection === 'study_rest_days') throw new Error('permission-denied');
      return snapshot({ schemaVersion: 1, migrationVersion: 1, status: 'completed' });
    });
    await expect(repository.read('owner')).rejects.toThrow('permission-denied');
  });

  it('retries the exact date without another debit and does not reread every Actual during spending', async () => {
    const repository = createFirebaseStudyStreakRepository({} as Firestore), history = await repository.read('owner');
    await repository.useRestDay(history, '2026-10-08', '2026-10-09');
    await repository.useRestDay(history, '2026-10-08', '2026-10-09');
    expect(stored).toMatchObject({ revision: 1, dates: ['2026-10-08'] });
    expect(mocks.getDocs).toHaveBeenCalledTimes(2);
    const reloaded = await repository.read('owner');
    expect(buildStudyStreakModel({ ...reloaded, today: '2026-10-09' }).availableTickets).toBe(0);
  });

  it('recalculates after a transaction conflict so a second device cannot spend the same remaining ticket', async () => {
    const repository = createFirebaseStudyStreakRepository({} as Firestore), history = await repository.read('owner');
    history.actuals.push(actual({ id: 'later', planId: null, occurrenceDate: '2026-10-10' }));
    mocks.transaction.mockImplementationOnce(async callback => {
      await callback({ get: async () => snapshot(null), set: vi.fn() });
      // Another device committed first; Firestore reruns the callback with that state.
      stored = { schemaVersion: 1, userId: 'owner', revision: 1, dates: ['2026-10-08'] };
      return callback({ get: async () => snapshot(stored), set: vi.fn() });
    });
    await expect(repository.useRestDay(history, '2026-10-11', '2026-10-11')).rejects.toThrow('チケット');
    expect(stored).toMatchObject({ revision: 1, dates: ['2026-10-08'] });
  });
});
