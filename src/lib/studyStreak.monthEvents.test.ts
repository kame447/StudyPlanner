import { describe, expect, it } from 'vitest';
import { actual, event, plan } from '../repositories/localPersistenceConcurrency.testUtils';
import { buildStudyStreakModel, nextAutomaticStudyRestDate, type StudyStreakInput } from './studyStreak';
import { addDays } from './date';

const job = event({ id: 'job', title: '塾バイト', date: '2026-10-07', repeat: 'daily' });
const study = (date: string) => actual({ id: date, planId: null, occurrenceDate: date });
const days = (count: number) => Array.from({ length: count }, (_, index) => study(addDays('2026-10-01', index)));
const input = { userId: 'owner', plans: [], monthEvents: [job], today: '2026-10-09', historyComplete: true };

describe('authoritative major-event sources in real study history', () => {
  it('excludes a known general event and retains real Plan, standalone and unresolved study records', () => {
    const rows = [actual({ id: 'job-actual', planId: job.id, occurrenceDate: '2026-10-07' }),
      actual({ id: 'planned-study', planId: 'study', occurrenceDate: '2026-10-06' }),
      study('2026-10-05'), actual({ id: 'unknown', planId: 'deleted-study', occurrenceDate: '2026-10-04' })];
    const model = buildStudyStreakModel({ ...input, plans: [plan({ id: 'study', date: '2026-10-06' })], actuals: rows });
    expect(model.studyDates).toEqual(['2026-10-04', '2026-10-05', '2026-10-06']);
    expect(model.bestStreak).toBe(3);
  });

  it('does not use another owner’s source to reclassify this owner’s unresolved record', () => {
    expect(buildStudyStreakModel({ ...input, monthEvents: [{ ...job, userId: 'other' }],
      actuals: [actual({ planId: job.id, occurrenceDate: '2026-10-07' })] }).studyDates).toEqual(['2026-10-07']);
  });

  it('recalculates past earned tickets and protection without changing saved Actuals or rest dates', () => {
    const actuals = [...days(6), actual({ id: 'job-actual', planId: job.id, occurrenceDate: '2026-10-07' })];
    const restDays = [{ date: '2026-10-08' }];
    const before = JSON.stringify({ actuals, restDays });
    const model = buildStudyStreakModel({ ...input, actuals, restDays });
    expect(model).toMatchObject({ currentStreak: 0, bestStreak: 6, earnedTickets: 0, usedTickets: 0,
      availableTickets: 0, protectedDates: [], unprotectedRestDates: ['2026-10-08'] });
    expect(JSON.stringify({ actuals, restDays })).toBe(before);
  });

  it('allows the existing automatic rest policy to protect a corrected non-study day with a genuinely earned ticket', () => {
    const actuals = [...days(7), actual({ id: 'job-actual', planId: job.id, occurrenceDate: '2026-10-08' })];
    const source = { ...input, actuals, restDays: [] };
    expect(nextAutomaticStudyRestDate(source)).toBe('2026-10-08');
    expect(buildStudyStreakModel({ ...source, restDays: [{ date: '2026-10-08' }] }))
      .toMatchObject({ currentStreak: 7, earnedTickets: 1, availableTickets: 0, protectedDates: ['2026-10-08'] });
  });

  it('never derives a confirmed ticket balance or automatic spend from incomplete source history', () => {
    const source = { ...input, actuals: days(7), historyComplete: false };
    expect(buildStudyStreakModel(source)).toMatchObject({ currentStreak: null, earnedTickets: null, availableTickets: null });
    expect(nextAutomaticStudyRestDate(source)).toBeNull();
  });
});


it('keeps an omitted major-event slice unknown even when a caller supplies a complete marker', () => {
  const incomplete = { ...input, monthEvents: undefined, actuals: days(7) } as unknown as StudyStreakInput;
  expect(buildStudyStreakModel(incomplete)).toMatchObject({ historyComplete: false, currentStreak: null, availableTickets: null });
  expect(nextAutomaticStudyRestDate(incomplete)).toBeNull();
});
