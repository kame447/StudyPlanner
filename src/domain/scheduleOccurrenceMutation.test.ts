import { describe, expect, it, vi } from 'vitest';
import type { MonthEvent, Plan } from '../types/domain';
import type { ScheduleOccurrence } from './scheduleOccurrence';
import { deleteScheduleOccurrence } from './scheduleOccurrenceMutation';

const NOW = '2026-09-01T00:00:00.000Z';

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    seriesId: 'plan-1',
    userId: 'user-1',
    title: '数学',
    subject: '数学',
    date: '2026-09-01',
    startTime: '18:00',
    endTime: '19:00',
    repeat: 'weekly',
    repeatUntil: '2026-09-30',
    excludedDates: [],
    recurrenceRules: [],
    type: 'study',
    memo: '',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function monthEvent(overrides: Partial<MonthEvent> = {}): MonthEvent {
  return {
    id: 'event-1',
    userId: 'user-1',
    date: '2026-09-01',
    title: '美容院',
    startTime: '18:00',
    endTime: '19:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    url: '',
    memo: '',
    checklist: [],
    locationTags: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function occurrence(
  backingKind: 'plan' | 'month-event' | 'timetable-template',
  backingId: string,
): ScheduleOccurrence {
  return {
    id: `${backingKind}:${backingId}:2026-09-08`,
    ownerId: 'user-1',
    title: '予定',
    subject: '',
    category: 'other',
    busy: true,
    start: { date: '2026-09-08', time: '18:00' },
    end: { date: '2026-09-08', time: '19:00' },
    source: {
      kind: backingKind === 'month-event' ? 'month-event' : 'plan',
      id: backingId,
      backingKind,
      backingId,
    },
  };
}

describe('scheduled occurrence deletion routing', () => {
  it('passes the exact recurring Plan occurrence to the existing scoped deletion lifecycle', async () => {
    const deletePlan = vi.fn(async (_plan: Plan) => undefined);
    const sourcePlan = plan();

    await deleteScheduleOccurrence({
      occurrence: occurrence('plan', sourcePlan.id),
      plans: [sourcePlan],
      monthEvents: [],
      deletePlan,
      deleteMonthEvent: vi.fn(async (_event: MonthEvent) => undefined),
      confirmRecurringMonthEventSeries: vi.fn((_event: MonthEvent) => true),
    });

    expect(deletePlan).toHaveBeenCalledTimes(1);
    expect(deletePlan.mock.calls[0]?.[0]).toMatchObject({
      id: sourcePlan.id,
      date: '2026-09-08',
      occurrenceDate: '2026-09-08',
    });
  });

  it('deletes a non-recurring MonthEvent by backing identity', async () => {
    const deleteMonthEvent = vi.fn(async (_event: MonthEvent) => undefined);
    const sourceEvent = monthEvent();

    await deleteScheduleOccurrence({
      occurrence: occurrence('month-event', sourceEvent.id),
      plans: [],
      monthEvents: [sourceEvent],
      deletePlan: vi.fn(async (_plan: Plan) => undefined),
      deleteMonthEvent,
      confirmRecurringMonthEventSeries: vi.fn((_event: MonthEvent) => true),
    });

    expect(deleteMonthEvent).toHaveBeenCalledWith(sourceEvent);
  });

  it('never silently widens a recurring MonthEvent occurrence delete into a series delete', async () => {
    const deleteMonthEvent = vi.fn(async (_event: MonthEvent) => undefined);
    const confirmRecurringMonthEventSeries = vi.fn((_event: MonthEvent) => false);
    const sourceEvent = monthEvent({
      repeat: 'weekly',
      repeatUntil: '2026-09-30',
    });

    const result = await deleteScheduleOccurrence({
      occurrence: occurrence('month-event', sourceEvent.id),
      plans: [],
      monthEvents: [sourceEvent],
      deletePlan: vi.fn(async (_plan: Plan) => undefined),
      deleteMonthEvent,
      confirmRecurringMonthEventSeries,
    });

    expect(result).toEqual({ status: 'canceled', backingKind: 'month-event' });
    expect(confirmRecurringMonthEventSeries).toHaveBeenCalledWith(sourceEvent);
    expect(deleteMonthEvent).not.toHaveBeenCalled();
  });

  it('rejects direct deletion of timetable-template occurrences', async () => {
    await expect(
      deleteScheduleOccurrence({
        occurrence: occurrence('timetable-template', 'template-1'),
        plans: [],
        monthEvents: [],
        deletePlan: vi.fn(async (_plan: Plan) => undefined),
        deleteMonthEvent: vi.fn(async (_event: MonthEvent) => undefined),
        confirmRecurringMonthEventSeries: vi.fn((_event: MonthEvent) => true),
      }),
    ).rejects.toThrow('時間割テンプレート由来の予定');
  });
});
