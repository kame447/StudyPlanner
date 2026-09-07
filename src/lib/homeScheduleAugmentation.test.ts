import { describe, expect, it } from 'vitest';
import type {
  MonthEvent,
  Plan,
  ScheduleTemplate,
  TimetableTerm,
} from '../types/domain';
import { buildHomeDashboardModel } from './homeDashboard';
import { augmentHomePlansWithScheduleOccurrences } from './homeScheduleAugmentation';

const TIMESTAMP = '2026-09-05T00:00:00.000Z';

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    seriesId: 'plan-1',
    userId: 'user-1',
    title: '英単語',
    subject: '英語',
    date: '2026-09-05',
    startTime: '09:00',
    endTime: '10:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'study',
    memo: '',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

function monthEvent(overrides: Partial<MonthEvent> = {}): MonthEvent {
  return {
    id: 'appointment-1',
    userId: 'user-1',
    date: '2026-09-05',
    title: '美容院',
    startTime: '12:30',
    endTime: '13:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    url: '',
    memo: '',
    checklist: [],
    locationTags: [],
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

function timetableTerm(): TimetableTerm {
  return {
    id: 'term-1',
    userId: 'user-1',
    year: 2026,
    kind: 'custom',
    label: '後期',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    isActive: true,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}

function scheduleTemplate(): ScheduleTemplate {
  return {
    id: 'class-1',
    userId: 'user-1',
    title: '情報学演習',
    subject: '情報学',
    type: 'school-event',
    weekday: 'sat',
    startTime: '13:00',
    endTime: '14:30',
    termId: 'term-1',
    periodNumber: 3,
    classroom: '情報学部棟',
    memo: '',
    active: true,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}

describe('home schedule augmentation', () => {
  it('adds MonthEvent and timetable occurrences as non-study read-only plans', () => {
    const term = timetableTerm();
    const augmented = augmentHomePlansWithScheduleOccurrences({
      ownerId: 'user-1',
      plans: [plan()],
      monthEvents: [monthEvent()],
      scheduleTemplates: [scheduleTemplate()],
      timetableTermId: term.id,
      timetableTerm: term,
      timetableTerms: [term],
      startDate: '2026-09-05',
    });
    const todayPlans = augmented.filter((item) => item.date === '2026-09-05');

    expect(todayPlans.map((item) => item.title)).toEqual([
      '英単語',
      '美容院',
      '情報学演習',
    ]);
    expect(todayPlans.find((item) => item.title === '美容院')).toMatchObject({
      date: '2026-09-05',
      startTime: '12:30',
      endTime: '13:00',
      type: 'other',
      sourceType: 'manual',
    });
    expect(todayPlans.find((item) => item.title === '情報学演習')).toMatchObject({
      date: '2026-09-05',
      startTime: '13:00',
      endTime: '14:30',
      type: 'school-event',
      sourceType: 'timetable',
      sourceId: 'class-1',
    });
    expect(
      augmented.filter(
        (item) => item.title === '情報学演習' && item.date === '2026-09-12',
      ),
    ).toHaveLength(1);
  });

  it('feeds general and timetable items into Home display without counting them as study progress', () => {
    const term = timetableTerm();
    const augmented = augmentHomePlansWithScheduleOccurrences({
      ownerId: 'user-1',
      plans: [plan()],
      monthEvents: [monthEvent()],
      scheduleTemplates: [scheduleTemplate()],
      timetableTermId: term.id,
      timetableTerm: term,
      timetableTerms: [term],
      startDate: '2026-09-05',
    });
    const dashboard = buildHomeDashboardModel({
      plans: augmented,
      actuals: [],
      todos: [],
      now: new Date('2026-09-05T12:00:00'),
    });

    expect(dashboard.todayPlans.map((item) => item.title)).toEqual([
      '英単語',
      '美容院',
      '情報学演習',
    ]);
    expect(dashboard.nextPlan?.title).toBe('美容院');
    expect(dashboard.weekPlannedMinutes).toBe(60);
    expect(dashboard.missingActualPlans.map((item) => item.id)).toEqual(['plan-1']);
  });

  it('does not resurrect a template occurrence already represented by an imported Plan', () => {
    const term = timetableTerm();
    const imported = plan({
      id: 'imported-class',
      seriesId: 'imported-class',
      title: '情報学演習',
      subject: '情報学',
      startTime: '13:00',
      endTime: '14:30',
      type: 'school-event',
      sourceType: 'timetable',
      sourceId: 'class-1',
      sourceDate: '2026-09-05',
    });
    const augmented = augmentHomePlansWithScheduleOccurrences({
      ownerId: 'user-1',
      plans: [imported],
      monthEvents: [],
      scheduleTemplates: [scheduleTemplate()],
      timetableTermId: term.id,
      timetableTerm: term,
      timetableTerms: [term],
      startDate: '2026-09-05',
    });
    const todayPlans = augmented.filter((item) => item.date === '2026-09-05');

    expect(todayPlans).toHaveLength(1);
    expect(todayPlans[0]?.id).toBe('imported-class');
    expect(
      augmented.filter(
        (item) => item.title === '情報学演習' && item.date === '2026-09-12',
      ),
    ).toHaveLength(1);
  });

  it('projects a multi-day MonthEvent into each covered home date without changing study type', () => {
    const augmented = augmentHomePlansWithScheduleOccurrences({
      ownerId: 'user-1',
      plans: [],
      monthEvents: [
        monthEvent({
          id: 'trip',
          title: '合宿',
          date: '2026-09-05',
          endDate: '2026-09-07',
          startTime: '18:00',
          endTime: '10:00',
        }),
      ],
      scheduleTemplates: [],
      startDate: '2026-09-05',
    });

    expect(augmented.map((item) => [item.date, item.startTime, item.endTime])).toEqual([
      ['2026-09-05', '18:00', '24:00'],
      ['2026-09-06', '00:00', '24:00'],
      ['2026-09-07', '00:00', '10:00'],
    ]);
    expect(augmented.every((item) => item.type === 'other')).toBe(true);
  });
});
