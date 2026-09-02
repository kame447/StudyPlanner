import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { MonthEvent, Plan } from '../types/domain';
import { scheduleEventFromPlan } from '../domain/scheduleEvent';

const mocks = vi.hoisted(() => ({
  batchSet: vi.fn(),
  batchDelete: vi.fn(),
  batchCommit: vi.fn(),
  deleteDoc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  setDoc: vi.fn(),
  writeBatch: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ name })),
  deleteDoc: mocks.deleteDoc,
  doc: vi.fn((_db, collectionName, id) => ({ collectionName, id })),
  getDoc: mocks.getDoc,
  getDocs: mocks.getDocs,
  query: vi.fn((...parts) => ({ parts })),
  setDoc: mocks.setDoc,
  where: vi.fn((...parts) => ({ parts })),
  writeBatch: mocks.writeBatch,
}));

import { createFirebaseScheduleEventAuthority } from './firebaseScheduleEventAuthority';

const CREATED_AT = '2026-09-01T00:00:00.000Z';

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    seriesId: 'plan-1',
    userId: 'user-1',
    title: 'Math',
    subject: 'Math',
    date: '2026-09-01',
    startTime: '09:00',
    endTime: '10:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'study',
    memo: '',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function monthEvent(overrides: Partial<MonthEvent> = {}): MonthEvent {
  return {
    id: 'event-1',
    userId: 'user-1',
    date: '2026-09-02',
    endDate: '2026-09-02',
    title: 'Appointment',
    startTime: '18:00',
    endTime: '19:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    url: '',
    memo: '',
    checklist: [],
    locationTags: [],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function firestoreDoc(id: string, value: object) {
  return {
    id,
    data: () => value,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDoc.mockResolvedValue({ exists: () => false });
  mocks.getDocs.mockResolvedValue({ docs: [] });
  mocks.setDoc.mockResolvedValue(undefined);
  mocks.deleteDoc.mockResolvedValue(undefined);
  mocks.batchCommit.mockResolvedValue(undefined);
  mocks.writeBatch.mockReturnValue({
    set: mocks.batchSet,
    delete: mocks.batchDelete,
    commit: mocks.batchCommit,
  });
});

describe('Firebase ScheduleEvent authority', () => {
  it('freezes with a migration lease, backfills canonical events, verifies them, then completes', async () => {
    const sourcePlan = plan();
    const sourceEvent = monthEvent();
    const canonicalPlan = scheduleEventFromPlan(sourcePlan);
    const authority = createFirebaseScheduleEventAuthority({} as Firestore);
    const loadLegacy = vi.fn().mockResolvedValue({
      plans: [sourcePlan],
      monthEvents: [sourceEvent],
    });

    mocks.getDocs
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({
        docs: [
          firestoreDoc('plan:plan-1', canonicalPlan),
          firestoreDoc('month-event:event-1', {
            schemaVersion: 1,
            id: 'month-event:event-1',
            userId: 'user-1',
            title: 'Appointment',
            date: '2026-09-02',
            endDate: '2026-09-02',
            startTime: '18:00',
            endTime: '19:00',
            recurrence: {
              repeat: 'none',
              repeatUntil: null,
              excludedDates: [],
              rules: [],
            },
            category: 'other',
            busy: true,
            memo: '',
            provenance: {
              legacy: { kind: 'month-event', id: 'event-1' },
              sourceType: 'month-event',
              sourceId: null,
            },
            createdAt: CREATED_AT,
            updatedAt: CREATED_AT,
            kind: 'general',
            plan: null,
            general: { url: '', checklist: [], locationTags: [] },
          }),
        ],
      });

    await authority.ensureMigrated('user-1', loadLegacy);

    expect(loadLegacy).toHaveBeenCalledTimes(1);
    expect(mocks.setDoc).toHaveBeenCalledTimes(2);
    expect(mocks.setDoc.mock.calls[0][1]).toMatchObject({
      status: 'migrating',
      userId: 'user-1',
      migrationVersion: 1,
    });
    expect(mocks.setDoc.mock.calls[1][1]).toMatchObject({
      status: 'completed',
      sourcePlanCount: 1,
      sourceMonthEventCount: 1,
      eventCount: 2,
    });
    expect(mocks.batchSet).toHaveBeenCalledTimes(2);
    expect(mocks.batchSet.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ collectionName: 'schedule_events', id: 'plan:plan-1' }),
        expect.objectContaining({ collectionName: 'schedule_events', id: 'month-event:event-1' }),
      ]),
    );
    expect(mocks.batchCommit).toHaveBeenCalledTimes(1);
  });

  it('does not load frozen legacy records when the current migration marker already exists', async () => {
    mocks.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        schemaVersion: 1,
        migrationVersion: 1,
        userId: 'user-1',
        status: 'completed',
        sourcePlanCount: 1,
        sourceMonthEventCount: 0,
        eventCount: 1,
        completedAt: CREATED_AT,
        operationId: 'schedule-event-migration-v1:user-1',
        revision: 1,
        startedAt: CREATED_AT,
      }),
    });
    const loadLegacy = vi.fn();
    const authority = createFirebaseScheduleEventAuthority({} as Firestore);

    await authority.ensureMigrated('user-1', loadLegacy);

    expect(loadLegacy).not.toHaveBeenCalled();
    expect(mocks.setDoc).not.toHaveBeenCalled();
    expect(mocks.writeBatch).not.toHaveBeenCalled();
  });

  it('writes recurring Plan changes to schedule_events, not the legacy plans collection', async () => {
    const authority = createFirebaseScheduleEventAuthority({} as Firestore);

    await authority.applyRecurringPlanMutation('user-1', {
      planUpserts: [plan({ id: 'replacement' })],
      planDeletes: [plan({ id: 'old' })],
      actualUpserts: [],
      actualDeletes: [],
    });

    expect(mocks.batchSet).toHaveBeenCalledWith(
      expect.objectContaining({ collectionName: 'schedule_events', id: 'plan:replacement' }),
      expect.objectContaining({ id: 'plan:replacement' }),
    );
    expect(mocks.batchDelete).toHaveBeenCalledWith(
      expect.objectContaining({ collectionName: 'schedule_events', id: 'plan:old' }),
    );
    expect(
      mocks.batchSet.mock.calls.some(([reference]) => reference.collectionName === 'plans'),
    ).toBe(false);
    expect(
      mocks.batchDelete.mock.calls.some(([reference]) => reference.collectionName === 'plans'),
    ).toBe(false);
  });

  it('rejects cross-owner scheduled writes before creating a batch', async () => {
    const authority = createFirebaseScheduleEventAuthority({} as Firestore);

    await expect(
      authority.applyRecurringPlanMutation('user-1', {
        planUpserts: [plan({ userId: 'user-2' })],
        planDeletes: [],
        actualUpserts: [],
        actualDeletes: [],
      }),
    ).rejects.toThrow('所有者が一致しません');
    expect(mocks.writeBatch).not.toHaveBeenCalled();
  });
});
