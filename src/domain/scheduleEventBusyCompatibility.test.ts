import { describe, expect, it } from 'vitest';
import { createPlanDraftFromPlan, createPlanFromDraft } from './planner';
import {
  scheduleEventFromMonthEvent,
  scheduleEventFromPlan,
  scheduleEventToMonthEvent,
  scheduleEventToPlan,
} from './scheduleEvent';
import { createScheduleOccurrenceProjection } from './scheduleOccurrence';
import type { MonthEvent, Plan } from '../types/domain';

const CREATED_AT = '2026-09-03T00:00:00.000Z';

function deadlinePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'deadline-1',
    seriesId: 'deadline-1',
    userId: 'user-1',
    title: '申込締切',
    subject: '',
    date: '2026-09-03',
    startTime: '23:00',
    endTime: '23:30',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'deadline',
    memo: '',
    busy: false,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function generalEvent(overrides: Partial<MonthEvent> = {}): MonthEvent {
  return {
    id: 'reminder-1',
    userId: 'user-1',
    date: '2026-09-03',
    endDate: '2026-09-03',
    title: '提出リマインダー',
    startTime: '12:00',
    endTime: '12:10',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    url: '',
    memo: '',
    checklist: [],
    locationTags: [],
    busy: false,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

describe('ScheduleEvent busy compatibility', () => {
  it('preserves explicit busy=false through Plan compatibility reads, edits, and occurrence projection', () => {
    const canonical = scheduleEventFromPlan(deadlinePlan());
    expect(canonical.busy).toBe(false);

    const projected = scheduleEventToPlan(canonical);
    expect(projected).not.toBeNull();
    expect(projected?.busy).toBe(false);

    if (!projected) throw new Error('expected Plan compatibility projection');
    const edited = createPlanFromDraft(
      { ...createPlanDraftFromPlan(projected), title: '申込締切（更新）' },
      projected,
    );
    expect(edited.busy).toBe(false);
    expect(scheduleEventFromPlan(edited).busy).toBe(false);

    const occurrence = createScheduleOccurrenceProjection({
      ownerId: 'user-1',
      startDate: '2026-09-03',
      endDate: '2026-09-03',
      plans: [edited],
    }).occurrences[0];
    expect(occurrence).toMatchObject({
      title: '申込締切（更新）',
      category: 'deadline',
      busy: false,
    });
  });

  it('preserves explicit busy=false through MonthEvent compatibility projection', () => {
    const canonical = scheduleEventFromMonthEvent(generalEvent());
    expect(canonical.busy).toBe(false);

    const projected = scheduleEventToMonthEvent(canonical);
    expect(projected?.busy).toBe(false);

    const occurrence = createScheduleOccurrenceProjection({
      ownerId: 'user-1',
      startDate: '2026-09-03',
      endDate: '2026-09-03',
      plans: [],
      monthEvents: projected ? [projected] : [],
    }).occurrences[0];
    expect(occurrence).toMatchObject({
      title: '提出リマインダー',
      busy: false,
    });
  });

  it('keeps legacy records occupied when busy was never stored', () => {
    const legacy = deadlinePlan({ busy: undefined });
    const canonical = scheduleEventFromPlan(legacy);
    expect(canonical.busy).toBe(true);
    expect(scheduleEventToPlan(canonical)?.busy).toBeUndefined();
  });
});
