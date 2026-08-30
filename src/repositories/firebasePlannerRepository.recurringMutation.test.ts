import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { Actual, Plan } from '../types/domain';

const mocks = vi.hoisted(() => ({
  batchSet: vi.fn(),
  batchDelete: vi.fn(),
  batchCommit: vi.fn(),
  getDocs: vi.fn(),
  writeBatch: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ name })),
  deleteField: vi.fn(() => Symbol('deleteField')),
  deleteDoc: vi.fn(),
  doc: vi.fn((_db, collectionName, id) => ({ collectionName, id })),
  getDocs: mocks.getDocs,
  query: vi.fn((...parts) => ({ parts })),
  setDoc: vi.fn(),
  where: vi.fn((...parts) => ({ parts })),
  writeBatch: mocks.writeBatch,
}));

import { createFirebasePlannerRepository } from './firebasePlannerRepository';

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1', seriesId: 'series-1', userId: 'user-1', title: 'Math', subject: 'Math',
    date: '2026-09-01', startTime: '09:00', endTime: '10:00', repeat: 'none', repeatUntil: null,
    excludedDates: [], recurrenceRules: [], type: 'study', memo: '',
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', ...overrides,
  };
}

function actual(overrides: Partial<Actual> = {}): Actual {
  return {
    id: 'actual-1', userId: 'user-1', planId: 'plan-1', occurrenceDate: '2026-09-01',
    actualStartTime: '09:00', actualEndTime: '10:00', subject: 'Math', note: '',
    updatedAt: '2026-09-01T10:00:00.000Z', ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDocs.mockResolvedValue({ docs: [] });
  mocks.writeBatch.mockReturnValue({
    set: mocks.batchSet,
    delete: mocks.batchDelete,
    commit: mocks.batchCommit,
  });
  mocks.batchCommit.mockResolvedValue(undefined);
});

describe('Firebase recurring mutation boundary', () => {
  it('queues Plan and Actual writes in one Firestore batch commit', async () => {
    const repository = createFirebasePlannerRepository({} as Firestore);
    await repository.applyRecurringPlanMutation('user-1', {
      planUpserts: [plan({ id: 'replacement' })],
      planDeletes: [],
      actualUpserts: [actual({ planId: 'replacement' })],
      actualDeletes: [],
    });
    expect(mocks.writeBatch).toHaveBeenCalledTimes(1);
    expect(mocks.batchSet).toHaveBeenCalledTimes(2);
    expect(mocks.batchCommit).toHaveBeenCalledTimes(1);
  });

  it('deletes all stored duplicates for an explicit occurrence delete', async () => {
    const target = actual({ id: 'visible', occurrenceDate: '2026-09-03' });
    mocks.getDocs.mockResolvedValue({
      docs: [
        { id: 'visible', data: () => ({ ...target }) },
        { id: 'hidden', data: () => ({ ...target, id: undefined }) },
      ],
    });
    const repository = createFirebasePlannerRepository({} as Firestore);

    await repository.applyRecurringPlanMutation('user-1', {
      planUpserts: [],
      planDeletes: [],
      actualUpserts: [],
      actualDeletes: [target],
    });

    expect(mocks.batchDelete).toHaveBeenCalledTimes(2);
    expect(mocks.batchCommit).toHaveBeenCalledTimes(1);
  });

  it('keeps a rebound Actual out of the old Plan cascade delete', async () => {
    const linked = actual();
    mocks.getDocs.mockResolvedValue({
      docs: [{ id: linked.id, data: () => ({ ...linked }) }],
    });
    const repository = createFirebasePlannerRepository({} as Firestore);
    await repository.applyRecurringPlanMutation('user-1', {
      planUpserts: [],
      planDeletes: [plan()],
      actualUpserts: [actual({ planId: 'replacement' })],
      actualDeletes: [],
    });
    expect(mocks.batchDelete).toHaveBeenCalledTimes(1);
    expect(mocks.batchSet).toHaveBeenCalledTimes(1);
    expect(mocks.batchCommit).toHaveBeenCalledTimes(1);
  });

  it('rejects cross-owner records before creating a batch', async () => {
    const repository = createFirebasePlannerRepository({} as Firestore);
    await expect(repository.applyRecurringPlanMutation('user-1', {
      planUpserts: [],
      planDeletes: [plan({ userId: 'user-2' })],
      actualUpserts: [],
      actualDeletes: [],
    })).rejects.toThrow('another user');
    expect(mocks.writeBatch).not.toHaveBeenCalled();
  });
});
