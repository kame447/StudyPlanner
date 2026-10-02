import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { Actual, Plan, StudyMaterial } from '../types/domain';

const mocks = vi.hoisted(() => ({
  batchSet: vi.fn(),
  batchDelete: vi.fn(),
  batchCommit: vi.fn(),
  getDocs: vi.fn(),
  writeBatch: vi.fn(),
  setDoc: vi.fn(),
  deletedField: Symbol('deleteField'),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ name })),
  deleteField: vi.fn(() => mocks.deletedField),
  deleteDoc: vi.fn(),
  doc: vi.fn((_db, collectionName, id) => ({ collectionName, id })),
  getDocs: mocks.getDocs,
  query: vi.fn((...parts) => ({ parts })),
  setDoc: mocks.setDoc,
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
    })).rejects.toThrow('所有者が一致しません');
    expect(mocks.writeBatch).not.toHaveBeenCalled();
  });

  it.each([499, 500])('commits %i dependent delete operations in one batch', async (count) => {
    mocks.getDocs.mockResolvedValue({
      docs: Array.from({ length: count - 1 }, (_, index) => ({
        id: `actual-${index}`, data: () => actual(),
      })),
    });
    const repository = createFirebasePlannerRepository({} as Firestore);

    await repository.applyRecurringPlanMutation('user-1', {
      planUpserts: [], planDeletes: [plan()], actualUpserts: [], actualDeletes: [],
    });

    expect(mocks.writeBatch).toHaveBeenCalledTimes(1);
    expect(mocks.batchDelete).toHaveBeenCalledTimes(count);
    expect(mocks.batchCommit).toHaveBeenCalledTimes(1);
  });

  it('rejects 501 operations without creating or committing a partial batch', async () => {
    mocks.getDocs.mockResolvedValue({
      docs: Array.from({ length: 500 }, (_, index) => ({
        id: `actual-${index}`, data: () => actual(),
      })),
    });
    const repository = createFirebasePlannerRepository({} as Firestore);

    await expect(repository.applyRecurringPlanMutation('user-1', {
      planUpserts: [], planDeletes: [plan()], actualUpserts: [], actualDeletes: [],
    })).rejects.toThrow('Recurring plan mutation exceeds the Firestore batch limit.');

    expect(mocks.writeBatch).not.toHaveBeenCalled();
    expect(mocks.batchDelete).not.toHaveBeenCalled();
    expect(mocks.batchCommit).not.toHaveBeenCalled();
  });

  it('does not create a batch for an empty mutation', async () => {
    const repository = createFirebasePlannerRepository({} as Firestore);

    await repository.applyRecurringPlanMutation('user-1', {
      planUpserts: [], planDeletes: [], actualUpserts: [], actualDeletes: [],
    });

    expect(mocks.writeBatch).not.toHaveBeenCalled();
  });

  it('keeps merge semantics while omitting undefined plan and actual fields', async () => {
    const nextPlan = plan({ seriesId: undefined });
    const nextActual = actual({ note: undefined });
    const repository = createFirebasePlannerRepository({} as Firestore);

    await repository.applyRecurringPlanMutation('user-1', {
      planUpserts: [nextPlan], planDeletes: [], actualUpserts: [nextActual], actualDeletes: [],
    });

    const { seriesId: _seriesId, ...expectedPlan } = nextPlan;
    const { note: _note, ...expectedActual } = nextActual;
    expect(mocks.batchSet).toHaveBeenNthCalledWith(
      1, { collectionName: 'plans', id: nextPlan.id }, expectedPlan, { merge: true },
    );
    expect(mocks.batchSet).toHaveBeenNthCalledWith(
      2, { collectionName: 'actuals', id: nextActual.id }, expectedActual, { merge: true },
    );
  });
});

describe('Firebase planner material write payloads', () => {
  it.each([true, false, undefined])(
    'preserves merge and explicit field deletions when paceEnabled is %s',
    async (paceEnabled) => {
      const material: StudyMaterial = {
        id: 'material-1', userId: 'user-1', name: 'Math', subjectId: 'math', subjectName: 'Math',
        createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
        paceEnabled, coverImageUrl: undefined, progressUnit: 'page', progressUnitLabel: 'pages',
        totalUnits: 100, currentUnit: 20, targetDate: '2026-10-01',
        estimatedMinutesPerUnit: 5, maxUnitsPerDay: 10,
      };
      const repository = createFirebasePlannerRepository({} as Firestore);

      const saved = await repository.upsertStudyMaterial(material);

      const { coverImageUrl: _coverImageUrl, paceEnabled: _paceEnabled, ...fields } = material;
      const sanitized = paceEnabled === undefined ? fields : { ...fields, paceEnabled };
      const payload = paceEnabled === true ? sanitized : {
        ...sanitized,
        progressUnit: mocks.deletedField,
        progressUnitLabel: mocks.deletedField,
        totalUnits: mocks.deletedField,
        currentUnit: mocks.deletedField,
        targetDate: mocks.deletedField,
        estimatedMinutesPerUnit: mocks.deletedField,
        maxUnitsPerDay: mocks.deletedField,
      };
      expect(mocks.setDoc).toHaveBeenCalledWith(
        { collectionName: 'study_materials', id: material.id }, payload, { merge: true },
      );
      expect(saved).toEqual(sanitized);
    },
  );
});
