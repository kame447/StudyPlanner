import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { Plan, PlanDraft } from '../../../types/domain';
import { createScheduleEventMigrationState } from '../../../domain/scheduleEvent';
import type { WeeklyDraftApprovalOperation } from '../planning/weeklyPlanningApprovalTypes';
import { buildWeeklyPlanningPlanSourceId } from '../planning/weeklyPlanningPlanProvenance';
import { WeeklyPlanningApprovalPersistenceError } from './weeklyPlanningApprovalPersistencePolicy';

const mocks = vi.hoisted(() => ({
  getDoc: vi.fn(),
  transactionGet: vi.fn(),
  transactionSet: vi.fn(),
  runTransaction: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((parent, collectionName, id) => ({ parent, collectionName, id })),
  getDoc: mocks.getDoc,
  runTransaction: mocks.runTransaction,
}));

import { createFirestoreWeeklyPlanningApprovalPlanRepository } from './weeklyPlanningApprovalFirestoreRepository';

const USER_ID = 'user-1';
const OPERATION_ID = 'operation-1';

type MockSnapshot = {
  id: string;
  exists: () => boolean;
  data: () => unknown;
};

function draft(): PlanDraft {
  return {
    userId: USER_ID,
    title: '英語ワーク',
    subject: '英語',
    date: '2026-09-03',
    startTime: '19:00',
    endTime: '20:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'study',
    memo: '',
    sourceType: 'weekly-planning',
    sourceId: buildWeeklyPlanningPlanSourceId({
      approvalOperationId: OPERATION_ID,
      sourceDraftBlockId: 'block-1',
    }),
  };
}

function missingSnapshot(id = 'missing'): MockSnapshot {
  return {
    id,
    exists: () => false,
    data: () => undefined,
  };
}

function existingSnapshot(id: string, data: object): MockSnapshot {
  return {
    id,
    exists: () => true,
    data: () => data,
  };
}

function installTransaction(migrationSnapshot: MockSnapshot) {
  mocks.transactionGet.mockImplementation(async (reference) => {
    if (reference.collectionName === 'schedule_event_migrations') {
      return migrationSnapshot;
    }
    return missingSnapshot(reference.id);
  });
  mocks.runTransaction.mockImplementation(async (_firestore, handler) =>
    handler({
      get: mocks.transactionGet,
      set: mocks.transactionSet,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transactionSet.mockReset();
  mocks.getDoc.mockResolvedValue(missingSnapshot('user-1'));
  installTransaction(missingSnapshot('user-1'));
});

describe('weekly planning Firestore approval schedule authority', () => {
  it.each([1, 5])('bounds %i approved items plus completion to ledger reads, including idempotent replay', async count => {
    // Execute the real persistence policy and transaction callback; only the SDK
    // is substituted. These are logical reads, not transport or billed reads.
    const stored = new Map<string, object>();
    const key = (reference: { collectionName: string; id: string }) => `${reference.collectionName}/${reference.id}`;
    const migration = createScheduleEventMigrationState({ userId: USER_ID, sourcePlanCount: 0,
      sourceMonthEventCount: 0, eventCount: 0, completedAt: '2026-09-03T00:00:00.000Z' });
    stored.set(`schedule_event_migrations/${USER_ID}`, migration);
    mocks.getDoc.mockImplementation(async reference => existingSnapshot(reference.id, migration));
    mocks.transactionGet.mockImplementation(async reference => {
      const value = stored.get(key(reference));
      return value ? existingSnapshot(reference.id, value) : missingSnapshot(reference.id);
    });
    mocks.transactionSet.mockImplementation((reference, value) => { stored.set(key(reference), structuredClone(value)); });
    const repository = createFirestoreWeeklyPlanningApprovalPlanRepository({} as Firestore);
    const drafts = Array.from({ length: count }, (_, index) => ({ ...draft(), sourceId: buildWeeklyPlanningPlanSourceId({
      approvalOperationId: OPERATION_ID, sourceDraftBlockId: `block-${index + 1}`,
    }) }));
    const saved: Plan[] = [];
    for (const item of drafts) saved.push(await repository.saveApprovedPlan(item));
    const operation: WeeklyDraftApprovalOperation = {
      approvalOperationId: OPERATION_ID, userId: USER_ID, previewId: 'preview', previewStateRevision: 1,
      startedAt: '2026-09-03T00:00:00.000Z', status: 'completed',
      items: saved.map((plan, index) => ({ sourceDraftBlockId: `block-${index + 1}`, savedPlanId: plan.id,
        status: 'saved', attemptCount: 1, updatedAt: '2026-09-03T00:00:00.000Z' })),
    };
    await repository.completeOperation(operation);
    function expectReadFootprint() {
      expect(mocks.getDoc).toHaveBeenCalledTimes(count + 1);
      expect(mocks.getDoc.mock.calls.every(([reference]) => reference.collectionName === 'schedule_event_migrations'
        && reference.id === USER_ID)).toBe(true);
      expect(mocks.transactionGet).toHaveBeenCalledTimes(6 * count + 2);
      const collections = mocks.transactionGet.mock.calls.map(([reference]) => reference.collectionName);
      expect(collections.filter(name => name === 'schedule_event_migrations')).toHaveLength(count + 1);
      expect(collections.filter(name => name === 'weekly_planning_approval_operations')).toHaveLength(count + 1);
      expect(collections.filter(name => name === 'weekly_planning_approval_items')).toHaveLength(2 * count);
      expect(collections.filter(name => name === 'schedule_events')).toHaveLength(2 * count);
      expect(mocks.runTransaction).toHaveBeenCalledTimes(count + 1);
    }
    expectReadFootprint();
    expect(mocks.transactionSet.mock.calls.filter(([reference]) => reference.collectionName === 'schedule_events')).toHaveLength(count);
    expect([...stored.values()]).toContainEqual(expect.objectContaining({ approvalOperationId: OPERATION_ID, status: 'completed' }));

    mocks.getDoc.mockClear(); mocks.transactionGet.mockClear(); mocks.transactionSet.mockClear(); mocks.runTransaction.mockClear();
    for (const [index, item] of drafts.entries()) expect(await repository.saveApprovedPlan(item)).toEqual(saved[index]);
    await repository.completeOperation(operation);
    expectReadFootprint();
    expect(mocks.transactionSet.mock.calls.filter(([reference]) => reference.collectionName === 'schedule_events')).toEqual([]);
    expect([...stored.keys()].filter(path => path.startsWith('schedule_events/'))).toHaveLength(count);
  });

  it('uses the legacy plans collection only before ScheduleEvent migration starts', async () => {
    const repository = createFirestoreWeeklyPlanningApprovalPlanRepository({} as Firestore);

    const saved = await repository.saveApprovedPlan(draft());

    expect(saved.sourceType).toBe('weekly-planning');
    const planWrite = mocks.transactionSet.mock.calls.find(
      ([reference]) => reference.collectionName === 'plans',
    );
    expect(planWrite).toBeDefined();
    expect(
      mocks.transactionSet.mock.calls.some(
        ([reference]) => reference.collectionName === 'schedule_events',
      ),
    ).toBe(false);
  });

  it('keeps the approval transaction on legacy authority while old Rules hide migration state', async () => {
    mocks.getDoc.mockRejectedValueOnce({
      code: 'permission-denied',
      message: 'Missing or insufficient permissions.',
    });
    const repository = createFirestoreWeeklyPlanningApprovalPlanRepository({} as Firestore);

    await repository.saveApprovedPlan(draft());

    expect(
      mocks.transactionSet.mock.calls.some(
        ([reference]) => reference.collectionName === 'plans',
      ),
    ).toBe(true);
    expect(
      mocks.transactionSet.mock.calls.some(
        ([reference]) => reference.collectionName === 'schedule_events',
      ),
    ).toBe(false);
    expect(
      mocks.transactionGet.mock.calls.some(
        ([reference]) => reference.collectionName === 'schedule_event_migrations',
      ),
    ).toBe(false);
  });

  it('writes approved plans to canonical schedule_events after migration completes', async () => {
    // The capability probe can precede cutover. Only the transaction's marker
    // decides where this plan is saved; the two reads are not interchangeable.
    mocks.getDoc.mockResolvedValue(missingSnapshot(USER_ID));
    installTransaction(
      existingSnapshot('user-1', {
        schemaVersion: 1,
        migrationVersion: 1,
        userId: USER_ID,
        status: 'completed',
        sourcePlanCount: 0,
        sourceMonthEventCount: 0,
        eventCount: 0,
        completedAt: '2026-09-03T00:00:00.000Z',
      }),
    );
    const repository = createFirestoreWeeklyPlanningApprovalPlanRepository({} as Firestore);

    const saved = await repository.saveApprovedPlan(draft());

    expect(mocks.getDoc).toHaveBeenCalledOnce();
    expect(mocks.transactionGet.mock.calls.filter(([reference]) => reference.collectionName === 'schedule_event_migrations')).toHaveLength(1);
    const canonicalWrite = mocks.transactionSet.mock.calls.find(
      ([reference]) => reference.collectionName === 'schedule_events',
    );
    expect(canonicalWrite).toBeDefined();
    expect(canonicalWrite?.[1]).toMatchObject({
      id: `plan:${saved.id}`,
      userId: USER_ID,
      kind: 'study',
      busy: true,
      provenance: {
        legacy: { kind: 'plan', id: saved.id },
        sourceType: 'weekly-planning',
      },
    });
    expect(canonicalWrite?.[1]).toEqual(
      JSON.parse(JSON.stringify(canonicalWrite?.[1])),
    );
    expect(
      mocks.transactionSet.mock.calls.some(
        ([reference]) => reference.collectionName === 'plans',
      ),
    ).toBe(false);
  });

  it('stops retryably while migration is in progress instead of writing either truth', async () => {
    installTransaction(
      existingSnapshot('user-1', {
        schemaVersion: 1,
        migrationVersion: 1,
        userId: USER_ID,
        status: 'migrating',
        operationId: `schedule-event-migration-v1:${USER_ID}`,
        revision: 1,
        startedAt: '2026-09-03T00:00:00.000Z',
        completedAt: null,
      }),
    );
    const repository = createFirestoreWeeklyPlanningApprovalPlanRepository({} as Firestore);

    let caught: unknown;
    try {
      await repository.saveApprovedPlan(draft());
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(WeeklyPlanningApprovalPersistenceError);
    expect(caught).toMatchObject({
      code: 'transaction_failed',
      retryable: true,
    });
    expect(
      mocks.transactionSet.mock.calls.some(
        ([reference]) =>
          reference.collectionName === 'plans' ||
          reference.collectionName === 'schedule_events',
      ),
    ).toBe(false);
  });
});
