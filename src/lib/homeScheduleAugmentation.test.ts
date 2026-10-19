import { describe, expect, it } from 'vitest';
import type {
  Actual,
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

it('counts opt-in general events consistently across registration routes, including earlier this week', () => {
  const earlier = '2026-09-02';
  const original = plan({ id: 'general', type: 'other', date: earlier, startTime: '12:30', endTime: '13:00' });
  const event = monthEvent({ date: earlier, checklist: [{ id: 'done', text: '完了', checked: true }] });
  const options = { ownerId: 'user-1', plans: [], monthEvents: [], scheduleTemplates: [], startDate: '2026-09-05' };
  const fromPlan = augmentHomePlansWithScheduleOccurrences({ ...options, plans: [original] });
  const fromMonth = augmentHomePlansWithScheduleOccurrences({ ...options, monthEvents: [event] });
  const now = new Date('2026-09-05T15:00:00');
  for (const includeGeneralEvents of [false, true, false]) {
    const progressPreferences = { includeGeneralEvents, includeTimetable: false };
    const a = buildHomeDashboardModel({ plans: fromPlan, actuals: [], todos: [], now, progressPreferences });
    const b = buildHomeDashboardModel({ plans: fromMonth, actuals: [], todos: [], now, progressPreferences });
    expect(a.weekPlannedMinutes).toBe(includeGeneralEvents ? 30 : 0);
    expect(b.weekPlannedMinutes).toBe(a.weekPlannedMinutes);
    expect(b.weekExpectedMinutesByNow).toBe(a.weekExpectedMinutesByNow);
    expect(b.weekActualMinutes).toBe(0);
    expect(b.weekProgressPercent).toBe(0);
  }
});

it('deduplicates imported classes and applies timetable opt-in independently of general events', () => {
  const term = timetableTerm();
  const template = scheduleTemplate();
  const imported = plan({ id: 'imported', title: template.title, type: 'study', sourceType: 'timetable', sourceId: template.id,
    startTime: template.startTime, endTime: template.endTime });
  const options = { ownerId: 'user-1', monthEvents: [monthEvent()], scheduleTemplates: [template], timetableTermId: term.id,
    timetableTerm: term, timetableTerms: [term], startDate: '2026-09-05' };
  for (const plans of [[], [imported]]) {
    const augmented = augmentHomePlansWithScheduleOccurrences({ ...options, plans });
    const todayClasses = augmented.filter(item => item.date === '2026-09-05' && item.sourceType === 'timetable');
    expect(todayClasses).toHaveLength(1);
    const now = new Date('2026-09-05T16:00:00');
    const excluded = buildHomeDashboardModel({ plans: augmented, actuals: [], todos: [], now,
      progressPreferences: { includeGeneralEvents: true, includeTimetable: false } });
    const included = buildHomeDashboardModel({ plans: augmented, actuals: [], todos: [], now,
      progressPreferences: { includeGeneralEvents: false, includeTimetable: true } });
    expect(excluded.weekPlannedMinutes).toBe(30);
    expect(included.weekPlannedMinutes).toBe(90);
    expect(included.weekActualMinutes).toBe(0);
    expect(included.missingActualPlans.map(item => item.id)).toEqual(plans.length ? ['imported'] : []);
  }
});

describe('major-event actual identity in Home progress', () => {
  const event = monthEvent({ title: '塾バイト', startTime: '17:00', endTime: '21:30' });
  const recorded: Actual = { id: 'event-actual', userId: event.userId, planId: event.id,
    occurrenceDate: event.date, title: event.title, subject: '主要予定',
    actualStartTime: '17:00', actualEndTime: '21:30', note: '', updatedAt: TIMESTAMP };
  const options = { ownerId: event.userId, plans: [], monthEvents: [event], scheduleTemplates: [], startDate: event.date };

  it.each([false, true])('honors general-event actual opt-in independently of timetable (%s)', includeTimetable => {
    const plans = augmentHomePlansWithScheduleOccurrences(options);
    const input = { plans, monthEvents: [event], actuals: [recorded], todos: [], now: new Date('2026-09-05T22:00:00') };
    const snapshot = JSON.stringify(input);
    expect(plans[0].id).not.toBe(recorded.planId);
    for (const includeGeneralEvents of [false, true, false]) {
      const dashboard = buildHomeDashboardModel({ ...input,
        progressPreferences: { includeGeneralEvents, includeTimetable } });
      const expected = includeGeneralEvents ? 270 : 0;
      expect(dashboard.weekPlannedMinutes).toBe(expected);
      expect(dashboard.weekActualMinutes).toBe(expected);
      expect(dashboard.weekExpectedMinutesByNow).toBe(expected);
      expect(dashboard.weekActualMinutesByNow).toBe(expected);
      expect(dashboard.weekDays.find(day => day.date === event.date)?.actualMinutes).toBe(expected);
      expect(dashboard.weekProgressPercent).toBe(includeGeneralEvents ? 100 : 0);
      expect(dashboard.weekDeltaMinutesByNow).toBe(0);
      expect(dashboard.currentStreak).toBe(includeGeneralEvents ? 1 : 0);
      expect(dashboard.todayPlans.map(plan => plan.title)).toEqual([event.title]);
      expect([...dashboard.actualByOccurrenceKey.values()]).toEqual([recorded]);
    }
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('classifies recorded major events even when their current schedule is outside the display projection', () => {
    const moved = { ...event, date: '2026-10-01' };
    const plans = augmentHomePlansWithScheduleOccurrences({ ...options, monthEvents: [moved] });
    expect(plans).toEqual([]);
    const actuals = [recorded, { ...recorded, id: 'historic', occurrenceDate: '2026-08-01' }];
    for (const includeGeneralEvents of [false, true]) {
      const dashboard = buildHomeDashboardModel({ plans, monthEvents: [moved], actuals,
        todos: [], now: new Date('2026-09-05T22:00:00'),
        progressPreferences: { includeGeneralEvents, includeTimetable: false } });
      expect(dashboard.weekPlannedMinutes).toBe(0);
      expect(dashboard.weekActualMinutes).toBe(includeGeneralEvents ? 270 : 0);
      expect(dashboard.currentStreak).toBe(includeGeneralEvents ? 1 : 0);
      expect(dashboard.bestStreak).toBe(includeGeneralEvents ? 1 : 0);
    }
  });

  it('keeps standalone and unknown-source records and deduplicates opted-in major-event records', () => {
    const standalone = { ...recorded, id: 'standalone', planId: null, actualEndTime: '17:30' };
    const orphan = { ...standalone, id: 'orphan', planId: 'deleted-study-plan', actualEndTime: '17:15' };
    const older = { ...recorded, id: 'older', actualEndTime: '18:00', updatedAt: '2026-09-01T00:00:00Z' };
    const actuals = [older, recorded, standalone, orphan];
    const otherOwnersEvent = { ...event, id: orphan.planId, userId: 'another-owner' };
    const plans = augmentHomePlansWithScheduleOccurrences(options);
    for (const includeGeneralEvents of [false, true]) {
      const dashboard = buildHomeDashboardModel({ plans, monthEvents: [event, otherOwnersEvent], actuals, todos: [],
        now: new Date('2026-09-05T22:00:00'), progressPreferences: { includeGeneralEvents, includeTimetable: false } });
      expect(dashboard.weekActualMinutes).toBe(includeGeneralEvents ? 315 : 45);
    }
  });
});
