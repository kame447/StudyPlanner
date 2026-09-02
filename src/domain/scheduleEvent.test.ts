import { describe, expect, it } from 'vitest';
import type { MonthEvent, Plan } from '../types/domain';
import {
  createScheduleEventMigrationState,
  isCurrentScheduleEventMigration,
  migrateLegacyScheduleRecords,
  scheduleEventFromMonthEvent,
  scheduleEventFromPlan,
  scheduleEventIdForLegacy,
  scheduleEventToMonthEvent,
  scheduleEventToPlan,
} from './scheduleEvent';

const CREATED_AT = '2026-09-01T00:00:00.000Z';

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'shared-id',
    seriesId: 'series-1',
    userId: 'user-1',
    title: '英単語',
    subject: '英語',
    date: '2026-09-01',
    startTime: '20:00',
    endTime: '21:00',
    repeat: 'weekly',
    repeatUntil: '2026-12-31',
    excludedDates: ['2026-09-08'],
    recurrenceRules: [
      {
        id: 'rule-1',
        kind: 'weekday',
        startDate: '2026-09-01',
        until: '2026-12-31',
        dates: [],
        weekdays: ['tue'],
        dayType: null,
        startTime: '20:00',
        endTime: '21:00',
        isOverride: false,
      },
    ],
    type: 'study',
    memo: '復習',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    sourceType: 'weekly-planning',
    sourceId: 'draft-block-1',
    sourceDate: '2026-09-01',
    occurrenceDate: '2026-09-01',
    occurrenceKey: 'occurrence-1',
    materialId: 'material-1',
    materialName: '金のフレーズ',
    weeklyPlanningObservationSource: {
      version: 1,
      kind: 'memory_pace_calibration',
      conversationId: 'conversation-1',
      graphRevision: 3,
      taskId: 'task-1',
      workloadFactId: 'workload-1',
      sessionEffortFactId: 'effort-1',
      activityKind: 'memorization_retrieval',
      targetAmount: 100,
      unitCode: 'word',
      unitLabel: '語',
      plannedSessionMinutes: 30,
    },
    ...overrides,
  };
}

function monthEvent(overrides: Partial<MonthEvent> = {}): MonthEvent {
  return {
    id: 'shared-id',
    userId: 'user-1',
    date: '2026-09-02',
    endDate: '2026-09-04',
    title: '旅行',
    startTime: '18:00',
    endTime: '19:00',
    repeat: 'monthly',
    repeatUntil: '2026-12-02',
    excludedDates: ['2026-10-02'],
    url: 'https://example.com/reservation',
    memo: '予約済み',
    checklist: [{ id: 'item-1', text: '会員証', checked: false }],
    locationTags: ['浜松', '駅前'],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

describe('canonical ScheduleEvent migration model', () => {
  it('round-trips a Plan without changing legacy linkage or recurrence metadata', () => {
    const source = plan();
    const event = scheduleEventFromPlan(source);

    expect(event).toMatchObject({
      id: 'plan:shared-id',
      kind: 'study',
      category: 'study',
      busy: true,
      date: '2026-09-01',
      endDate: '2026-09-01',
      provenance: {
        legacy: { kind: 'plan', id: 'shared-id' },
        sourceType: 'weekly-planning',
        sourceId: 'draft-block-1',
      },
    });
    expect(scheduleEventToPlan(event)).toEqual(source);
  });

  it('round-trips a rich multi-day MonthEvent without losing range or metadata', () => {
    const source = monthEvent();
    const event = scheduleEventFromMonthEvent(source);

    expect(event).toMatchObject({
      id: 'month-event:shared-id',
      kind: 'general',
      category: 'other',
      busy: true,
      date: '2026-09-02',
      endDate: '2026-09-04',
      general: {
        url: 'https://example.com/reservation',
        locationTags: ['浜松', '駅前'],
      },
    });
    expect(scheduleEventToMonthEvent(event)).toEqual(source);
  });

  it('normalizes a legacy MonthEvent without endDate to a same-day canonical range', () => {
    const source = monthEvent({ endDate: undefined });
    const migrated = scheduleEventFromMonthEvent(source);

    expect(migrated.endDate).toBe(source.date);
    expect(scheduleEventToMonthEvent(migrated)?.endDate).toBe(source.date);
  });

  it('uses source-prefixed canonical ids so Plan and MonthEvent ids cannot collide', () => {
    expect(scheduleEventIdForLegacy({ kind: 'plan', id: 'same' })).toBe('plan:same');
    expect(scheduleEventIdForLegacy({ kind: 'month-event', id: 'same' })).toBe(
      'month-event:same',
    );

    const migration = migrateLegacyScheduleRecords({
      plans: [plan({ id: 'same' })],
      monthEvents: [monthEvent({ id: 'same' })],
    });

    expect(migration.events.map((event) => event.id)).toEqual([
      'month-event:same',
      'plan:same',
    ]);
  });

  it('is deterministic and idempotent when the same legacy snapshot is migrated again', () => {
    const input = {
      plans: [plan(), plan({ id: 'plan-2', seriesId: 'plan-2' })],
      monthEvents: [monthEvent()],
    };

    expect(migrateLegacyScheduleRecords(input)).toEqual(
      migrateLegacyScheduleRecords(input),
    );
  });

  it('does not infer busy/free from legacy category during migration', () => {
    expect(scheduleEventFromPlan(plan({ type: 'deadline' })).busy).toBe(true);
    expect(scheduleEventFromMonthEvent(monthEvent()).busy).toBe(true);
  });

  it('preserves an absent Plan sourceType instead of inventing provenance', () => {
    const source = plan({ sourceType: undefined, sourceId: null });
    expect(scheduleEventToPlan(scheduleEventFromPlan(source))).toEqual(source);
  });

  it('recognizes only the current completed migration marker as cut over', () => {
    const state = createScheduleEventMigrationState({
      userId: 'user-1',
      sourcePlanCount: 2,
      sourceMonthEventCount: 1,
      eventCount: 3,
      completedAt: CREATED_AT,
    });

    expect(isCurrentScheduleEventMigration(state)).toBe(true);
    expect(
      isCurrentScheduleEventMigration({ ...state, migrationVersion: 0 }),
    ).toBe(false);
    expect(
      isCurrentScheduleEventMigration({ ...state, status: 'migrating' }),
    ).toBe(false);
  });
});
