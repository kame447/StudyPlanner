import { describe, expect, it } from 'vitest';
import { addDays } from './date';
import { buildStudyStreakModel, collectStudyDates, nextAutomaticStudyRestDate, studyRestDayBlockReason, type StudyStreakInput } from './studyStreak';
import { buildHomeDashboardModel } from './homeDashboard';
import type { Actual } from '../types/domain';

const actual = (date: string, overrides: Partial<Actual> = {}): Actual => ({
  id: date, userId: 'owner', planId: null, occurrenceDate: date,
  actualStartTime: '09:00', actualEndTime: '09:10', subject: '数学', note: '', updatedAt: '2026-10-14T00:00:00Z', ...overrides,
});
const days = (start: string, count: number) => Array.from({ length: count }, (_, index) => actual(addDays(start, index)));
const input = (overrides: Partial<StudyStreakInput> = {}): StudyStreakInput => ({
  userId: 'owner', plans: [], actuals: days('2026-10-01', 7), today: '2026-10-08', historyComplete: true, ...overrides,
});

describe('study streak and earned rest days', () => {
  it('counts distinct positive real dates, excludes future/foreign/invalid records, and keeps today open', () => {
    const source = input({ actuals: [...days('2026-10-01', 7), actual('2026-10-07', { id: 'duplicate' }),
      actual('2026-10-08', { actualEndTime: '09:00' }), ...days('2026-11-01', 20),
      actual('2026-10-08', { id: 'foreign', userId: 'other' }), actual('2026-02-30')], });
    expect(buildStudyStreakModel(source)).toMatchObject({ currentStreak: 7, bestStreak: 7, earnedTickets: 1, availableTickets: 1 });
    expect(buildStudyStreakModel({ ...source, today: '2026-10-09' }).currentStreak).toBe(0);
    expect(buildHomeDashboardModel({ plans: [], actuals: source.actuals.filter(row => row.userId === 'owner'), todos: [], now: new Date('2026-10-08T00:01:00') }))
      .toMatchObject({ today: '2026-10-08', currentStreak: 7, bestStreak: 7 });
  });

  it('uses the latest linked record rather than counting a corrected zero-duration duplicate', () => {
    const source = input({ actuals: [actual('2026-10-07', { id: 'old', planId: 'p', updatedAt: '2026-10-07T00:00:00Z' }),
      actual('2026-10-07', { id: 'new', planId: 'p', actualEndTime: '09:00', updatedAt: '2026-10-08T00:00:00Z' })] });
    expect(buildStudyStreakModel(source)).toMatchObject({ studyDates: [], currentStreak: 0, earnedTickets: 0 });
  });

  it('protects the next day without adding actual learning or awarding another ticket for rest', () => {
    const source = input({ restDays: [{ date: '2026-10-08' }] });
    expect(buildStudyStreakModel(source)).toMatchObject({ currentStreak: 7, bestStreak: 7,
      protectedDates: ['2026-10-08'], earnedTickets: 1, usedTickets: 1, availableTickets: 0, studyDaysTowardNextTicket: 0 });
    expect(buildStudyStreakModel({ ...source, today: '2026-10-15', actuals: [...source.actuals, ...days('2026-10-09', 7)] }))
      .toMatchObject({ currentStreak: 14, bestStreak: 14, earnedTicketDates: ['2026-10-07', '2026-10-15'], availableTickets: 1 });
  });

  it('never spends a future award retroactively and does not expire unused tickets at a gap', () => {
    expect(studyRestDayBlockReason(input({ actuals: days('2026-10-02', 7) }), '2026-10-01')).not.toBeNull();
    const source = input({ today: '2026-10-12', actuals: [...days('2026-10-01', 7), actual('2026-10-11')], restDays: [{ date: '2026-10-12' }] });
    expect(buildStudyStreakModel(source)).toMatchObject({ currentStreak: 1, bestStreak: 7, protectedDates: ['2026-10-12'], availableTickets: 0 });
  });

  it('replays corrections and reloads without double awards, negative balance, or claiming rest as study', () => {
    const source = input({ restDays: [{ date: '2026-10-08' }, { date: '2026-10-08' }] });
    const restored = JSON.parse(JSON.stringify(source));
    expect(buildStudyStreakModel(restored)).toEqual(buildStudyStreakModel(source));
    expect(buildStudyStreakModel({ ...source, actuals: source.actuals.filter(row => row.occurrenceDate !== '2026-10-03') }))
      .toMatchObject({ protectedDates: [], unprotectedRestDates: ['2026-10-08'], availableTickets: 0 });
    expect(buildStudyStreakModel({ ...source, actuals: [...source.actuals, actual('2026-10-08')] }))
      .toMatchObject({ currentStreak: 8, protectedDates: [], unprotectedRestDates: [], usedTickets: 0, availableTickets: 1 });
  });

  it('does not interpret a partial or failed-history replacement as lost protection or zero balance', () => {
    expect(buildStudyStreakModel(input({ actuals: [], restDays: [{ date: '2026-10-08' }], historyComplete: false })))
      .toMatchObject({ historyComplete: false, currentStreak: null, bestStreak: null, availableTickets: null,
        protectedDates: [], unprotectedRestDates: [] });
    expect(studyRestDayBlockReason(input({ historyComplete: false }), '2026-10-08')).not.toBeNull();
  });

  it('continues across local leap-day and year boundaries without UTC date conversion', () => {
    expect(buildStudyStreakModel(input({ today: '2024-03-01', actuals: days('2024-02-24', 7) }))).toMatchObject({ currentStreak: 7, bestStreak: 7 });
    expect(buildStudyStreakModel(input({ today: '2027-01-01', actuals: days('2026-12-26', 7) }))).toMatchObject({ currentStreak: 7, bestStreak: 7 });
  });

  it('automatically selects only ended gaps in chronological order and preserves older manual spends', () => {
    expect(nextAutomaticStudyRestDate(input())).toBeNull();
    const source = input({ today: '2026-10-10' });
    expect(nextAutomaticStudyRestDate(source)).toBe('2026-10-08');
    expect(nextAutomaticStudyRestDate({ ...source, restDays: [{ date: '2026-10-08' }] })).toBeNull();
    const legacy = input({ today: '2026-10-13', actuals: [...days('2026-10-01', 7), actual('2026-10-11')], restDays: [{ date: '2026-10-12' }] });
    expect(nextAutomaticStudyRestDate(legacy)).toBeNull();
    expect(nextAutomaticStudyRestDate({ ...source, historyComplete: false })).toBeNull();
    expect(nextAutomaticStudyRestDate(input({ today: '2026-10-09', actuals: days('2026-10-02', 7) }))).toBeNull();
  });

  it('shares the same real-study qualification for the flame and streak, not rest protection', () => {
    const source = input({ actuals: [...days('2026-10-01', 7), actual('2026-10-08', { actualEndTime: '09:00' })], restDays: [{ date: '2026-10-08' }] });
    expect(collectStudyDates(source)).not.toContain(source.today);
    expect(collectStudyDates({ ...source, actuals: [...source.actuals, actual('2026-10-08', { id: 'positive' })] })).toContain(source.today);
  });

  it('rejects future use, duplicate use and use on a studied day', () => {
    expect(studyRestDayBlockReason(input(), '2026-10-09')).not.toBeNull();
    expect(studyRestDayBlockReason(input(), '2026-10-07')).not.toBeNull();
    expect(studyRestDayBlockReason(input({ restDays: [{ date: '2026-10-08' }] }), '2026-10-08')).not.toBeNull();
    expect(studyRestDayBlockReason(input(), '2026-10-08')).not.toBeNull();
    expect(studyRestDayBlockReason(input({ today: '2026-10-09' }), '2026-10-08')).toBeNull();
  });
});
