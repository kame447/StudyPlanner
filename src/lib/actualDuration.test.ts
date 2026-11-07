import { describe, expect, it } from 'vitest';
import { elapsedActualMinutes, getActualDurationMinutes, isDurationActual, isTimedActual, isValidActualDurationMinutes } from './actualDuration';
import { buildHomeDashboardModel } from './homeDashboard';
import { ALL_MATERIALS_FILTER, buildLearningReportModel } from './learningReport';
import { normalizeStudyRecordsForDisplay } from './studyRecords';
import { collectStudyDates } from './studyStreak';
import type { Actual, DurationActual, TimedActual } from '../types/domain';

const STAMP = '2026-11-03T00:00:00.000Z';
const timed = (overrides: Partial<TimedActual> = {}): TimedActual => ({
  id: 'timed', userId: 'u', planId: null, occurrenceDate: '2026-10-26', actualStartTime: '09:00', actualEndTime: '10:00',
  title: '英語', subject: '英語', isAlignedToPlan: false, note: '', updatedAt: STAMP, ...overrides,
});
const duration = (id: string, occurrenceDate: string, subject: string, minutes: number): DurationActual => ({
  id, userId: 'u', planId: null, occurrenceDate, actualDurationMinutes: minutes, title: subject, subject,
  isAlignedToPlan: false, note: '', updatedAt: STAMP,
});
// The synthetic week of the persona: 月数学60 火英語45 水現代文30 (木休み: no record) 金英語50 土数学120 日化学90 = 395.
const week: DurationActual[] = [
  duration('d-mon', '2026-10-26', '数学', 60), duration('d-tue', '2026-10-27', '英語', 45), duration('d-wed', '2026-10-28', '現代文', 30),
  duration('d-fri', '2026-10-30', '英語', 50), duration('d-sat', '2026-10-31', '数学', 120), duration('d-sun', '2026-11-01', '化学', 90),
];

describe('getActualDurationMinutes', () => {
  it('keeps the clock arithmetic of a timed actual, including overnight and malformed times', () => {
    expect(getActualDurationMinutes(timed())).toBe(60);
    expect(getActualDurationMinutes(timed({ actualStartTime: '23:30', actualEndTime: '00:30' }))).toBe(60);
    expect(getActualDurationMinutes(timed({ actualStartTime: '09:00', actualEndTime: '09:00' }))).toBe(0);
    expect(getActualDurationMinutes(timed({ actualStartTime: '', actualEndTime: '' }))).toBe(0);
  });

  it('reads the stored minutes of a duration actual and never guesses for an invalid one', () => {
    expect(getActualDurationMinutes(duration('a', '2026-10-26', '数学', 120))).toBe(120);
    for (const bad of [0, -5, 1440, 12.5, Number.NaN]) {
      expect(getActualDurationMinutes({ ...duration('a', '2026-10-26', '数学', 1), actualDurationMinutes: bad })).toBe(0);
    }
  });

  it('tells the two kinds apart and validates the accepted range', () => {
    expect(isDurationActual(week[0])).toBe(true);
    expect(isTimedActual(week[0])).toBe(false);
    expect(isTimedActual(timed())).toBe(true);
    expect([1, 60, 1439].every(isValidActualDurationMinutes)).toBe(true);
    expect([0, 1440, 1.5, '60', null].some(isValidActualDurationMinutes)).toBe(false);
  });

  it('counts a duration actual as elapsed in full from its own date, never before', () => {
    expect(elapsedActualMinutes(week[0], '2026-10-26', '08:00')).toBe(60);
    expect(elapsedActualMinutes(week[0], '2026-10-25', '23:00')).toBe(0);
    expect(elapsedActualMinutes(timed(), '2026-10-26', '09:30')).toBe(30);
  });
});

describe('aggregates with duration actuals', () => {
  const mixed: Actual[] = [...week, timed({ id: 'timed-sat', occurrenceDate: '2026-10-31', actualStartTime: '20:00', actualEndTime: '20:30' })];

  it('shows a duration actual as a standalone display record with its minutes and no clock times', () => {
    const records = normalizeStudyRecordsForDisplay({ actuals: week, plans: [], monthEvents: [] });
    expect(records.map((record) => [record.date, record.subject, record.durationMinutes, record.linkKind, record.startTime, record.endTime]))
      .toEqual(expect.arrayContaining([['2026-10-26', '数学', 60, 'standalone', '', '']]));
    expect(records.reduce((sum, record) => sum + record.durationMinutes, 0)).toBe(395);
  });

  it('adds the week to the learning report total, trend and breakdown consistently', () => {
    const report = buildLearningReportModel({ scope: 'week', anchorDate: '2026-10-28', materialFilter: ALL_MATERIALS_FILTER,
      plans: [], actuals: mixed, subjects: [], materials: [] });
    expect(report.actualMinutes).toBe(395 + 30);
    expect(report.buckets.reduce((sum, bucket) => sum + bucket.actualMinutes, 0)).toBe(425);
    expect(report.breakdown.reduce((sum, entry) => sum + entry.minutes, 0)).toBe(425);
  });

  it('adds the week to the home week total and per day, with an unchanged total for the timed actuals alone', () => {
    const now = new Date(2026, 10, 1, 12, 0);
    const home = buildHomeDashboardModel({ plans: [], actuals: mixed, todos: [], now });
    expect(home.weekActualMinutes).toBe(425);
    expect(home.weekDays.map((day) => day.actualMinutes)).toEqual([60, 45, 30, 0, 50, 150, 90]);
    expect(buildHomeDashboardModel({ plans: [], actuals: [timed()], todos: [], now: new Date(2026, 9, 26, 12, 0) }).weekActualMinutes).toBe(60);
  });

  it('counts the days of a duration actual as study days for the streak', () => {
    expect(collectStudyDates({ userId: 'u', plans: [], actuals: week, today: '2026-11-03' }))
      .toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-30', '2026-10-31', '2026-11-01']);
  });
});
