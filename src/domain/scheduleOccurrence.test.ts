import { sanitizeMonthEventDraft, validateMonthEventDraft } from '../lib/monthEventEditor';
import { formatMonthEventDuration } from '../lib/monthEvents';
import { scheduleEventFromMonthEvent, scheduleEventToMonthEvent } from './scheduleEvent';
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

  it.each([
    { endTime: '00:00', expectedEndDate: '2026-02-01', overlapsFebruaryFirst: false },
    { endTime: '24:00', expectedEndDate: '2026-02-02', overlapsFebruaryFirst: true },
  ])('preserves the explicit later endDate clock $endTime and its half-open boundary', ({ endTime, expectedEndDate, overlapsFebruaryFirst }) => {
    const event = monthEvent({ date: '2026-01-31', endDate: '2026-02-01', startTime: '23:00', endTime });
    expect(validateMonthEventDraft(sanitizeMonthEventDraft(event))).toBeNull();
    const restored = scheduleEventToMonthEvent(scheduleEventFromMonthEvent(event));
    expect(restored).toEqual(event);
    const projection = createScheduleOccurrenceProjection({
      ownerId: 'user-1', startDate: '2026-01-31', endDate: '2026-02-02', plans: [], monthEvents: [restored!],
    });
    expect(projection.issues).toEqual([]);
    expect(projection.occurrences).toHaveLength(1);
    expect(projection.occurrences[0]).toMatchObject({
      id: 'month-event:event-1:2026-01-31',
      start: { date: '2026-01-31', time: '23:00' }, end: { date: expectedEndDate, time: '00:00' },
    });
    const onFebruaryFirst = createScheduleOccurrenceProjection({
      ownerId: 'user-1', startDate: '2026-02-01', endDate: '2026-02-01', plans: [], monthEvents: [restored!],
    });
    expect(onFebruaryFirst.issues).toEqual([]);
    expect(onFebruaryFirst.occurrences).toHaveLength(overlapsFebruaryFirst ? 1 : 0);
    expect(createScheduleOccurrenceProjection({
      ownerId: 'user-1', startDate: expectedEndDate, endDate: expectedEndDate, plans: [], monthEvents: [restored!],
    }).occurrences).toEqual([]);
    // Recurrence adds the stored date span to its own anchor, without adding a
    // second day to an already explicit next-date 00:00 endpoint.
    const recurring = { ...event, date: '2026-01-24', endDate: '2026-01-25', repeat: 'weekly' as const,
      repeatUntil: '2026-01-31' };
    const repeated = createScheduleOccurrenceProjection({
      ownerId: 'user-1', startDate: '2026-01-31', endDate: '2026-02-02', plans: [], monthEvents: [recurring],
    });
    expect(repeated.issues).toEqual([]);
    expect(repeated.occurrences).toHaveLength(1);
    expect(repeated.occurrences[0]).toMatchObject({
      id: 'month-event:event-1:2026-01-31',
      start: { date: '2026-01-31', time: '23:00' }, end: { date: expectedEndDate, time: '00:00' },
    });
  });

  it.each([
    { endTime: '00:00', expectedEnd: null },
    { endTime: '24:00', expectedEnd: { date: '2026-02-01', time: '00:00' } },
    { endTime: '23:59', expectedEnd: { date: '2026-01-31', time: '23:59' } },
  ])('preserves the legacy all-day-shaped projection for $endTime without selecting a busy/free policy', ({ endTime, expectedEnd }) => {
    const event = monthEvent({ date: '2026-01-31', endDate: '2026-01-31', startTime: '00:00', endTime });
    expect(validateMonthEventDraft(sanitizeMonthEventDraft(event))).toBeNull();
    const projection = createScheduleOccurrenceProjection({
      ownerId: 'user-1', startDate: '2026-01-31', endDate: '2026-02-01', plans: [], monthEvents: [event],
    });
    expect(projection.issues).toEqual([]);
    if (expectedEnd === null) {
      // Characterization only: do not expand this legacy point into all-day occupancy here.
      expect(projection.occurrences).toEqual([]);
    } else {
      expect(projection.occurrences).toHaveLength(1);
      expect(projection.occurrences[0].start).toEqual({ date: '2026-01-31', time: '00:00' });
      expect(projection.occurrences[0].end).toEqual(expectedEnd);
    }
  });

  it.each(['00:00', '24:00'])('preserves the editor-accepted non-all-day midnight endpoint %s across a month boundary', (endTime) => {
    const event = monthEvent({ date: '2026-01-31', endDate: '2026-01-31', startTime: '23:00', endTime });
    const before = structuredClone(event);
    const draft = sanitizeMonthEventDraft(event);
    expect(validateMonthEventDraft(draft)).toBeNull();
    expect(formatMonthEventDuration(event)).toBe(60);
    // Canonical compatibility adapters must preserve the user's accepted fields.
    const restored = scheduleEventToMonthEvent(scheduleEventFromMonthEvent(event));
    expect(restored).toEqual(event);
    const projection = createScheduleOccurrenceProjection({
      ownerId: 'user-1', startDate: '2026-01-31', endDate: '2026-02-01', plans: [], monthEvents: [restored!],
    });
    expect(projection.issues).toEqual([]);
    expect(projection.occurrences).toHaveLength(1);
    expect(projection.occurrences[0]).toMatchObject({
      id: 'month-event:event-1:2026-01-31', ownerId: 'user-1', busy: true,
      start: { date: '2026-01-31', time: '23:00' }, end: { date: '2026-02-01', time: '00:00' },
      source: { kind: 'month-event', id: 'event-1', backingKind: 'month-event', backingId: 'event-1' },
    });
    // The same valid Plan clock has an independent, existing midnight contract.
    const planProjection = createScheduleOccurrenceProjection({
      ownerId: 'user-1', startDate: '2026-01-31', endDate: '2026-02-01',
      plans: [plan({ date: '2026-01-31', startTime: '23:00', endTime })],
    });
    expect(planProjection.issues).toEqual([]);
    expect(planProjection.occurrences).toHaveLength(1);
    expect(planProjection.occurrences[0].start).toEqual(projection.occurrences[0].start);
    expect(planProjection.occurrences[0].end).toEqual(projection.occurrences[0].end);
    // Half-open occupancy does not extend into the next day after its 00:00 endpoint.
    expect(createScheduleOccurrenceProjection({
      ownerId: 'user-1', startDate: '2026-02-01', endDate: '2026-02-01', plans: [], monthEvents: [restored!],
    }).occurrences).toEqual([]);
    expect(event).toEqual(before);
  });

  it('retains ordinary daytime occupancy and rejects a same-date reversed non-midnight editor range', () => {
    const event = monthEvent({ date: '2026-01-31', endDate: '2026-01-31', startTime: '09:00', endTime: '10:00' });
    expect(validateMonthEventDraft(sanitizeMonthEventDraft(event))).toBeNull();
    expect(formatMonthEventDuration(event)).toBe(60);
    const projection = createScheduleOccurrenceProjection({
      ownerId: 'user-1', startDate: '2026-01-31', endDate: '2026-02-01', plans: [], monthEvents: [event],
    });
    expect(projection.issues).toEqual([]);
    expect(projection.occurrences).toHaveLength(1);
    expect(projection.occurrences[0]).toMatchObject({
      start: { date: '2026-01-31', time: '09:00' }, end: { date: '2026-01-31', time: '10:00' },
    });
    expect(validateMonthEventDraft(sanitizeMonthEventDraft({ ...event, startTime: '10:00', endTime: '09:00' })))
      .toBe('終了時刻は開始時刻より後にしてください。');
    // Do not invent an overnight interpretation for an editor-rejected range.
  });

  it('preserves an explicit next-month overnight span when the projection begins inside it', () => {
    const event = monthEvent({ date: '2026-01-31', endDate: '2026-02-01', startTime: '23:00', endTime: '01:00' });
    expect(validateMonthEventDraft(sanitizeMonthEventDraft(event))).toBeNull();
    expect(formatMonthEventDuration(event)).toBe(120);
    const restored = scheduleEventToMonthEvent(scheduleEventFromMonthEvent(event));
    expect(restored).toEqual(event);
    const projection = createScheduleOccurrenceProjection({
      ownerId: 'user-1', startDate: '2026-02-01', endDate: '2026-02-01', plans: [], monthEvents: [restored!],
    });
    expect(projection.issues).toEqual([]);
    expect(projection.occurrences).toHaveLength(1);
    expect(projection.occurrences[0]).toMatchObject({
      id: 'month-event:event-1:2026-01-31', ownerId: 'user-1', busy: true,
      start: { date: '2026-01-31', time: '23:00' }, end: { date: '2026-02-01', time: '01:00' },
    });
  });

  it.each(['foreign_owner', 'excluded_occurrence'] as const)('does not restore an excluded month-boundary recurrence (%s)', (boundary) => {
    const event = monthEvent({
      date: '2026-01-24', endDate: '2026-01-24', startTime: '23:00', endTime: '24:00',
      repeat: 'weekly', repeatUntil: '2026-01-31',
      ...(boundary === 'foreign_owner' ? { userId: 'user-2' } : { excludedDates: ['2026-01-31'] }),
    });
    expect(validateMonthEventDraft(sanitizeMonthEventDraft(event))).toBeNull();
    const projection = createScheduleOccurrenceProjection({
      ownerId: 'user-1', startDate: '2026-01-31', endDate: '2026-02-01', plans: [], monthEvents: [event],
    });
    expect(projection.occurrences).toEqual([]);
    expect(projection.issues).toEqual(boundary === 'foreign_owner'
      ? [{ code: 'owner_mismatch', sourceKind: 'month-event', sourceId: 'event-1' }]
      : []);
  });
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

  it('fails closed on a timetable term owned by another user', () => {
    const projection = createScheduleOccurrenceProjection({
      ownerId: 'user-1',
      startDate: '2026-04-06',
      endDate: '2026-04-06',
      plans: [],
      scheduleTemplates: [template()],
      timetableTermId: TERM.id,
      timetableTerm: { ...TERM, userId: 'user-2' },
      timetableTerms: [{ ...TERM, userId: 'user-2' }],
    });

    expect(projection.occurrences).toEqual([]);
    expect(projection.issues).toContainEqual({
      code: 'owner_mismatch',
      sourceKind: 'timetable',
      sourceId: TERM.id,
    });
  });
});
