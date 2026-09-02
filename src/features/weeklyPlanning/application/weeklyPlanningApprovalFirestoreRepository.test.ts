import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { PlanDraft } from '../../../types/domain';
import { buildWeeklyPlanningPlanSourceId } from '../planning/weeklyPlanningPlanProvenance';
import { WeeklyPlanningApprovalPersistenceError } from './weeklyPlanningApprovalPersistencePolicy';

const mocks = vi.hoisted(() => ({
  transactionGet: vi.fn(),
  transactionSet: vi.fn(),
  runTransaction: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((parent, collectionName, id) => ({ parent, collectionName, id })),
  runTransaction: mocks.runTransaction,
}));

import { createFirestoreWeeklyPlanningApprovalPlanRepository } from './weeklyPlanningApprovalFirestoreRepository';

const USER_ID = 'user-1';
const OPERATION_ID = 'operation-1';

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

function missingSnapshot(id = 'missing') {
  return {
    id,
    exists: () => false,
    data: () => undefined,
  };
}

function existingSnapshot(id: string, data: object) {
  return {
    id,
    exists: () => true,
    data: () => data,
  };
}

function installTransaction(migrationSnapshot: ReturnType<typeof missingSnapshot>) {
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
  installTransaction(missingSnapshot('user-1'));
});

describe('weekly planning Firestore approval schedule authority', () => {
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

  it('writes approved plans to canonical schedule_events after migration completes', async () => {
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