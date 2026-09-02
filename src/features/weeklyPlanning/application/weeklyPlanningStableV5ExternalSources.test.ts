import { describe, expect, it } from 'vitest';
import type {
  MonthEvent,
  Plan,
  ScheduleTemplate,
  TimetableTerm,
} from '../../../types/domain';
import { createStableV5ExternalConstraintSources } from './weeklyPlanningStableV5ExternalSources';

const CREATED_AT = '2026-04-01T00:00:00.000Z';

const TERM: TimetableTerm = {
  id: 'term-spring',
  userId: 'user-1',
  year: 2026,
  kind: 'custom',
  label: '2026年前期',
  startDate: '2026-04-06',
  endDate: '2026-04-26',
  usesAlternatingWeeks: true,
  alternatingWeekAnchorDate: '2026-04-06',
  isActive: true,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

function template(
  id: string,
  startTime: string,
  endTime: string,
  overrides: Partial<ScheduleTemplate> = {},
): ScheduleTemplate {
  return {
    id,
    userId: 'user-1',
    title: id,
    subject: '授業',
    type: 'school-event',
    weekday: 'mon',
    startTime,
    endTime,
    termId: TERM.id,
    periodNumber: Number(id.slice(-1)),
    classroom: '',
    memo: '',
    active: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    seriesId: 'plan-1',
    userId: 'user-1',
    title: '既存予定',
    subject: '',
    date: '2026-04-06',
    startTime: '18:00',
    endTime: '19:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'other',
    memo: '',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function monthEvent(overrides: Partial<MonthEvent> = {}): MonthEvent {
  return {
    id: 'month-event-1',
    userId: 'user-1',
    date: '2026-04-06',
    title: '美容院',
    startTime: '15:00',
    endTime: '16:00',
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

describe('Stable V5 timetable external constraints', () => {
  it('uses term bounds, A/B weeks, and class-level biweekly recurrence before blocking time', () => {
    const sources = createStableV5ExternalConstraintSources({
      ownerId: 'user-1',
      plans: [],
      templates: [
        template('class-1', '09:00', '10:00', { alternatingWeek: 'a' }),
        template('class-2', '10:00', '11:00', { alternatingWeek: 'b' }),
        template('class-3', '11:00', '12:00', {
          alternatingWeek: 'both',
          weekInterval: 2,
          weekIntervalAnchorDate: '2026-04-06',
        }),
      ],
      timetableTermId: TERM.id,
      timetableTerm: TERM,
      timetableTerms: [TERM],
      horizon: { startDate: '2026-04-06', endDate: '2026-04-27' },
      timeZone: 'Asia/Tokyo',
    });
    const timetable = sources.find((source) => source.kind === 'timetable');

    expect(timetable?.status).toBe('success');
    if (!timetable || timetable.status !== 'success') {
      throw new Error('expected a successful timetable source');
    }

    expect(
      timetable.events.map((event) => [event.eventId, event.start.date]),
    ).toEqual([
      ['class-1', '2026-04-06'],
      ['class-3', '2026-04-06'],
      ['class-2', '2026-04-13'],
      ['class-1', '2026-04-20'],
      ['class-3', '2026-04-20'],
    ]);
  });

  it('switches timetable periods automatically when the planning horizon crosses them', () => {
    const autumn: TimetableTerm = {
      ...TERM,
      id: 'term-autumn',
      label: '2026年後期',
      startDate: '2026-04-27',
      endDate: '2026-05-31',
      usesAlternatingWeeks: false,
      alternatingWeekAnchorDate: null,
      isActive: false,
      updatedAt: '2026-04-20T00:00:00.000Z',
    };
    const sources = createStableV5ExternalConstraintSources({
      ownerId: 'user-1',
      plans: [],
      templates: [
        template('class-1', '09:00', '10:00', { alternatingWeek: 'a' }),
        template('class-4', '13:00', '14:00', {
          termId: autumn.id,
          alternatingWeek: 'both',
          weekInterval: 1,
        }),
      ],
      timetableTermId: TERM.id,
      timetableTerm: TERM,
      timetableTerms: [TERM, autumn],
      horizon: { startDate: '2026-04-20', endDate: '2026-05-04' },
      timeZone: 'Asia/Tokyo',
    });
    const timetable = sources.find((source) => source.kind === 'timetable');

    expect(timetable?.status).toBe('success');
    if (!timetable || timetable.status !== 'success') {
      throw new Error('expected a successful timetable source');
    }

    expect(
      timetable.events.map((event) => [event.eventId, event.start.date]),
    ).toEqual([
      ['class-1', '2026-04-20'],
      ['class-4', '2026-04-27'],
      ['class-4', '2026-05-04'],
    ]);
  });

  it('includes MonthEvent-only commitments in the authoritative existing-plan source', () => {
    const sources = createStableV5ExternalConstraintSources({
      ownerId: 'user-1',
      plans: [],
      monthEvents: [monthEvent()],
      templates: [],
      horizon: { startDate: '2026-04-06', endDate: '2026-04-06' },
      timeZone: 'Asia/Tokyo',
    });
    const existing = sources.find((source) => source.kind === 'existing_plans');

    expect(existing?.status).toBe('success');
    if (!existing || existing.status !== 'success') {
      throw new Error('expected a successful existing-plan source');
    }
    expect(existing.events).toEqual([
      {
        eventId: 'month-event-1',
        ownerId: 'user-1',
        start: { date: '2026-04-06', time: '15:00' },
        end: { date: '2026-04-06', time: '16:00' },
        timeZone: 'Asia/Tokyo',
        constraintLevel: 'hard',
      },
    ]);
  });

  it('expands recurring Plans before projecting occupied time', () => {
    const sources = createStableV5ExternalConstraintSources({
      ownerId: 'user-1',
      plans: [
        plan({
          repeat: 'daily',
          repeatUntil: '2026-04-08',
        }),
      ],
      templates: [],
      horizon: { startDate: '2026-04-06', endDate: '2026-04-08' },
      timeZone: 'Asia/Tokyo',
    });
    const existing = sources.find((source) => source.kind === 'existing_plans');

    expect(existing?.status).toBe('success');
    if (!existing || existing.status !== 'success') {
      throw new Error('expected a successful existing-plan source');
    }
    expect(existing.events.map((event) => event.start.date)).toEqual([
      '2026-04-06',
      '2026-04-07',
      '2026-04-08',
    ]);
  });

  it('keeps an imported timetable Plan in existing_plans and removes the duplicate template occurrence', () => {
    const sources = createStableV5ExternalConstraintSources({
      ownerId: 'user-1',
      plans: [
        plan({
          id: 'imported-class-plan',
          seriesId: 'imported-class-plan',
          title: 'class-1',
          date: '2026-04-06',
          startTime: '09:15',
          endTime: '10:15',
          sourceType: 'timetable',
          sourceId: 'class-1',
        }),
      ],
      templates: [template('class-1', '09:00', '10:00')],
      timetableTermId: TERM.id,
      timetableTerm: TERM,
      timetableTerms: [TERM],
      horizon: { startDate: '2026-04-06', endDate: '2026-04-06' },
      timeZone: 'Asia/Tokyo',
    });
    const existing = sources.find((source) => source.kind === 'existing_plans');
    const timetable = sources.find((source) => source.kind === 'timetable');

    expect(existing?.status).toBe('success');
    expect(timetable?.status).toBe('success');
    if (
      !existing ||
      existing.status !== 'success' ||
      !timetable ||
      timetable.status !== 'success'
    ) {
      throw new Error('expected successful schedule sources');
    }
    expect(existing.events).toMatchObject([
      {
        eventId: 'class-1',
        start: { date: '2026-04-06', time: '09:15' },
        end: { date: '2026-04-06', time: '10:15' },
      },
    ]);
    expect(timetable.events).toEqual([]);
  });

  it('fails the local schedule sources closed when an owner mismatch reaches the projection boundary', () => {
    const sources = createStableV5ExternalConstraintSources({
      ownerId: 'user-1',
      plans: [],
      monthEvents: [monthEvent({ userId: 'user-2' })],
      templates: [],
      horizon: { startDate: '2026-04-06', endDate: '2026-04-06' },
      timeZone: 'Asia/Tokyo',
    });
    const existing = sources.find((source) => source.kind === 'existing_plans');
    const timetable = sources.find((source) => source.kind === 'timetable');

    expect(existing).toMatchObject({
      kind: 'existing_plans',
      status: 'failure',
      failureKind: 'invalid_response',
    });
    expect(timetable).toMatchObject({
      kind: 'timetable',
      status: 'failure',
      failureKind: 'invalid_response',
    });
  });
});
