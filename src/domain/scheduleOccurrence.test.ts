import { describe, expect, it } from 'vitest';
import type {
  MonthEvent,
  Plan,
  ScheduleTemplate,
  TimetableTerm,
} from '../types/domain';
import { createScheduleOccurrenceProjection } from './scheduleOccurrence';

const CREATED_AT = '2026-09-01T00:00:00.000Z';

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    seriesId: 'plan-1',
    userId: 'user-1',
    title: '英単語',
    subject: '英語',
    date: '2026-09-01',
    startTime: '20:00',
    endTime: '21:00',
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
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

const TERM: TimetableTerm = {
  id: 'term-1',
  userId: 'user-1',
  year: 2026,
  kind: 'custom',
  label: '前期',
  startDate: '2026-04-01',
  endDate: '2026-07-31',
  isActive: true,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

function template(overrides: Partial<ScheduleTemplate> = {}): ScheduleTemplate {
  return {
    id: 'class-1',
    userId: 'user-1',
    title: '情報学演習',
    subject: '情報学',
    type: 'school-event',
    weekday: 'mon',
    startTime: '09:00',
    endTime: '10:00',
    termId: TERM.id,
    periodNumber: 1,
    classroom: 'A101',
    memo: '',
    active: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

describe('schedule occurrence projection', () => {
  it('expands recurring Plans instead of treating only the stored anchor date as occupied', () => {
    const projection = createScheduleOccurrenceProjection({
      ownerId: 'user-1',
      startDate: '2026-09-01',
      endDate: '2026-09-03',
      plans: [
        plan({
          repeat: 'daily',
          repeatUntil: '2026-09-03',
        }),
      ],
    });

    expect(projection.issues).toEqual([]);
    expect(projection.occurrences.map((item) => item.start.date)).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
    ]);
  });

  it('projects a MonthEvent-only commitment into the same occupied occurrence model', () => {
    const projection = createScheduleOccurrenceProjection({
      ownerId: 'user-1',
      startDate: '2026-09-02',
      endDate: '2026-09-02',
      plans: [],
      monthEvents: [monthEvent()],
    });

    expect(projection.issues).toEqual([]);
    expect(projection.occurrences).toMatchObject([
      {
        title: '美容院',
        busy: true,
        start: { date: '2026-09-02', time: '18:00' },
        end: { date: '2026-09-02', time: '19:00' },
        source: {
          kind: 'month-event',
          id: 'event-1',
          backingKind: 'month-event',
        },
      },
    ]);
  });

  it('uses the MonthEvent recurrence and exclusion rules once for all consumers', () => {
    const projection = createScheduleOccurrenceProjection({
      ownerId: 'user-1',
      startDate: '2026-09-02',
      endDate: '2026-09-16',
      plans: [],
      monthEvents: [
        monthEvent({
          repeat: 'weekly',
          repeatUntil: '2026-09-16',
          excludedDates: ['2026-09-09'],
        }),
      ],
    });

    expect(projection.occurrences.map((item) => item.start.date)).toEqual([
      '2026-09-02',
      '2026-09-16',
    ]);
  });

  it('keeps a multi-day MonthEvent as one occurrence even when the requested range starts inside it', () => {
    const projection = createScheduleOccurrenceProjection({
      ownerId: 'user-1',
      startDate: '2026-09-02',
      endDate: '2026-09-02',
      plans: [],
      monthEvents: [
        monthEvent({
          date: '2026-09-01',
          endDate: '2026-09-03',
          startTime: '18:00',
          endTime: '10:00',
        }),
      ],
    });

    expect(projection.occurrences).toHaveLength(1);
    expect(projection.occurrences[0]).toMatchObject({
      start: { date: '2026-09-01', time: '18:00' },
      end: { date: '2026-09-03', time: '10:00' },
    });
  });

  it('deduplicates an imported timetable Plan and its template by logical source identity', () => {
    const projection = createScheduleOccurrenceProjection({
      ownerId: 'user-1',
      startDate: '2026-04-06',
      endDate: '2026-04-06',
      plans: [
        plan({
          id: 'imported-class-plan',
          seriesId: 'imported-class-plan',
          title: '情報学演習',
          subject: '情報学',
          date: '2026-04-06',
          startTime: '09:00',
          endTime: '10:00',
          type: 'school-event',
          sourceType: 'timetable',
          sourceId: 'class-1',
        }),
      ],
      scheduleTemplates: [template()],
      timetableTermId: TERM.id,
      timetableTerm: TERM,
      timetableTerms: [TERM],
    });

    expect(projection.occurrences).toHaveLength(1);
    expect(projection.occurrences[0]).toMatchObject({
      source: {
        kind: 'timetable',
        id: 'class-1',
        backingKind: 'plan',
        backingId: 'imported-class-plan',
      },
    });
  });

  it('fails closed on records owned by another user instead of projecting them', () => {
    const projection = createScheduleOccurrenceProjection({
      ownerId: 'user-1',
      startDate: '2026-09-02',
      endDate: '2026-09-02',
      plans: [],
      monthEvents: [monthEvent({ userId: 'user-2' })],
    });

    expect(projection.occurrences).toEqual([]);
    expect(projection.issues).toEqual([
      {
        code: 'owner_mismatch',
        sourceKind: 'month-event',
        sourceId: 'event-1',
      },
    ]);
  });
});
