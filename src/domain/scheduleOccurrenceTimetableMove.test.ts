import { describe, expect, it } from 'vitest';
import { createPlanFromDraft } from './planner';
import { createScheduleOccurrenceProjection } from './scheduleOccurrence';
import type { Plan, PlanDraft, ScheduleTemplate, TimetableTerm } from '../types/domain';

const TIMESTAMP = '2026-04-01T00:00:00.000Z';

function timetableTerm(): TimetableTerm {
  return {
    id: 'term-1',
    userId: 'user-1',
    year: 2026,
    kind: 'custom',
    label: '前期',
    startDate: '2026-04-01',
    endDate: '2026-07-31',
    isActive: true,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}

function template(): ScheduleTemplate {
  return {
    id: 'class-1',
    userId: 'user-1',
    title: '情報学演習',
    subject: '情報学',
    type: 'school-event',
    weekday: 'mon',
    startTime: '09:00',
    endTime: '10:00',
    termId: 'term-1',
    periodNumber: 1,
    classroom: '',
    memo: '',
    active: true,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}

function timetablePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'imported-plan-1',
    seriesId: 'imported-plan-1',
    userId: 'user-1',
    title: '情報学演習',
    subject: '情報学',
    date: '2026-04-06',
    startTime: '09:00',
    endTime: '10:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'school-event',
    memo: '',
    sourceType: 'timetable',
    sourceId: 'class-1',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

function timetableDraft(overrides: Partial<PlanDraft> = {}): PlanDraft {
  return {
    userId: 'user-1',
    title: '情報学演習',
    subject: '情報学',
    date: '2026-04-06',
    startTime: '09:00',
    endTime: '10:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'school-event',
    memo: '',
    sourceType: 'timetable',
    sourceId: 'class-1',
    ...overrides,
  };
}

describe('timetable occurrence move identity', () => {
  it('records the timetable occurrence origin when a timetable Plan is created', () => {
    const created = createPlanFromDraft(timetableDraft());

    expect(created.sourceDate).toBe('2026-04-06');
  });

  it('keeps the original timetable occurrence date when that Plan moves to another day', () => {
    const sourcePlan = timetablePlan();
    const moved = createPlanFromDraft(
      timetableDraft({ date: '2026-04-07', startTime: '10:00', endTime: '11:00' }),
      sourcePlan,
    );

    expect(moved.date).toBe('2026-04-07');
    expect(moved.sourceDate).toBe('2026-04-06');
  });

  it('suppresses the original template occurrence after the imported Plan moves to another date', () => {
    const term = timetableTerm();
    const movedPlan = timetablePlan({
      date: '2026-04-07',
      sourceDate: '2026-04-06',
      startTime: '10:00',
      endTime: '11:00',
    });

    const projection = createScheduleOccurrenceProjection({
      ownerId: 'user-1',
      startDate: '2026-04-06',
      endDate: '2026-04-07',
      plans: [movedPlan],
      scheduleTemplates: [template()],
      timetableTermId: term.id,
      timetableTerm: term,
      timetableTerms: [term],
    });

    expect(projection.issues).toEqual([]);
    expect(projection.occurrences).toHaveLength(1);
    expect(projection.occurrences[0]).toMatchObject({
      id: 'timetable:class-1:2026-04-06',
      start: { date: '2026-04-07', time: '10:00' },
      end: { date: '2026-04-07', time: '11:00' },
      source: {
        kind: 'timetable',
        id: 'class-1',
        backingKind: 'plan',
        backingId: 'imported-plan-1',
      },
    });

    const originalDateOnly = createScheduleOccurrenceProjection({
      ownerId: 'user-1',
      startDate: '2026-04-06',
      endDate: '2026-04-06',
      plans: [movedPlan],
      scheduleTemplates: [template()],
      timetableTermId: term.id,
      timetableTerm: term,
      timetableTerms: [term],
    });

    expect(originalDateOnly.issues).toEqual([]);
    expect(originalDateOnly.occurrences).toEqual([]);
  });
});
