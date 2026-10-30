import { describe, expect, it } from 'vitest';
import type { ScheduleTemplate, TimetablePeriod, TimetableTerm } from '../types/domain';
import { buildTimetableDisplayModel, formatTimetablePeriodRange, DEFAULT_PERIODS, WEEKDAY_OPTIONS } from './timetableDisplayModel';

const stamp = '2026-08-19T00:00:00.000Z';
const period = (periodNumber: number, overrides: Partial<TimetablePeriod> = {}): TimetablePeriod => ({ id: `period-${periodNumber}`, userId: 'owner', termId: 'term', periodNumber, label: String(periodNumber), startTime: '09:00', endTime: '10:00', createdAt: stamp, updatedAt: stamp, ...overrides });
const template = (periodNumber: number, overrides: Partial<ScheduleTemplate> = {}): ScheduleTemplate => ({ id: `class-${periodNumber}`, userId: 'owner', termId: 'term', periodNumber, title: 'Math', subject: 'Math', type: 'school-event', weekday: 'mon', startTime: '11:00', endTime: '12:00', memo: '', active: true, createdAt: stamp, updatedAt: stamp, ...overrides });
const input = { userId: 'owner', activeTermId: 'term', timetablePeriods: [] as TimetablePeriod[], scheduleTemplates: [] as ScheduleTemplate[] };

describe('shared timetable display rows', () => {
  it('uses the existing six default periods and six weekdays without modifying defaults', () => {
    const before = structuredClone(DEFAULT_PERIODS);
    const model = buildTimetableDisplayModel(input);
    expect(model.displayPeriods).toEqual(DEFAULT_PERIODS.map(row => ({ ...row, userId: 'owner', termId: 'term' })));
    expect(model.displayPeriods).toHaveLength(6);
    expect(WEEKDAY_OPTIONS.map(day => day.value)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
    expect(DEFAULT_PERIODS).toEqual(before);
    expect(model.displayPeriods[0]).not.toBe(DEFAULT_PERIODS[0]);
  });
  it('uses only saved active-term rows, sorted copies, preserving incomplete and reversed times', () => {
    const periods = [period(4, { startTime: '12:00', endTime: '11:00' }), period(2, { startTime: null, endTime: null }), period(7, { termId: 'other' })];
    const before = structuredClone(periods);
    const model = buildTimetableDisplayModel({ ...input, timetablePeriods: periods });
    expect(model.displayPeriods).toEqual([periods[1], periods[0]]);
    expect(model.savedPeriodsForTerm).toEqual(model.displayPeriods);
    expect(model.displayPeriods[0]).not.toBe(periods[1]);
    expect(periods).toEqual(before);
  });
  it('unions all active-term template periods including both A/B weeks once, without overwriting saved times', () => {
    const saved = period(2);
    const templates = [template(8, { alternatingWeek: 'b' }), template(3, { alternatingWeek: 'a' }), template(8, { startTime: '20:00' }), template(2), template(9, { termId: 'other' }), template(0)];
    const before = structuredClone(templates);
    const model = buildTimetableDisplayModel({ ...input, timetablePeriods: [saved], scheduleTemplates: templates });
    expect(model.displayPeriods.map(row => row.periodNumber)).toEqual([2, 3, 8]);
    expect(model.displayPeriods[0]).toEqual(saved);
    expect(model.displayPeriods[2]).toEqual({ userId: 'owner', termId: 'term', periodNumber: 8, label: '8', startTime: '11:00', endTime: '12:00' });
    expect(templates).toEqual(before);
  });
  it('keeps legacy default-term templates and extends defaults with missing periods', () => {
    const model = buildTimetableDisplayModel({ ...input, activeTermId: 'default', scheduleTemplates: [template(8, { termId: undefined }), template(9, { termId: '' }), template(10)] });
    expect(model.displayPeriods.map(row => row.periodNumber)).toEqual([1, 2, 3, 4, 5, 6, 8, 9]);
    expect(model.termTemplates.map(row => row.periodNumber)).toEqual([8, 9]);
  });
});


describe('compact timetable period dates', () => {
  const term: TimetableTerm = { id: 'term', userId: 'owner', year: 2026, kind: 'fullYear', label: '2026年 通年', isActive: true, createdAt: stamp, updatedAt: stamp };
  it('keeps unset dates and distinguishes next-year and other-year ranges', () => {
    expect(formatTimetablePeriodRange(null, true)).toBe('期間未設定');
    expect(formatTimetablePeriodRange(term, true)).toBe('期間未設定');
    expect(formatTimetablePeriodRange({ ...term, startDate: '2026-04-01', endDate: '2027-03-31' }, true)).toBe('4/1〜翌3/31');
    expect(formatTimetablePeriodRange({ ...term, startDate: '2025-12-01', endDate: '2028-03-31' }, true)).toBe('2025/12/1〜2028/3/31');
    expect(formatTimetablePeriodRange({ ...term, startDate: null, endDate: '2026-09-30' }, true)).toBe('開始日未設定〜9/30');
    expect(formatTimetablePeriodRange({ ...term, startDate: '2026-04-01', endDate: '2027-03-31' })).toBe('2026-04-01 〜 2027-03-31');
  });
});


it('reserves a readable row for the larger A/B stack, not the sum of alternatives', () => {
  const templates = [template(1, { id: 'base' }), template(1, { id: 'a', alternatingWeek: 'a' }), template(1, { id: 'b', alternatingWeek: 'b' })];
  const alternating = buildTimetableDisplayModel({ ...input, timetablePeriods: [period(1), period(2)], scheduleTemplates: templates, usesAlternatingWeeks: true });
  expect(alternating.rowMinimumCardCounts).toEqual([2, 1]);
  expect(alternating.gridRows).toBe('auto minmax(8rem, 1fr) minmax(4rem, 1fr)');
  const ordinary = buildTimetableDisplayModel({ ...input, timetablePeriods: [period(1), period(2)], scheduleTemplates: templates });
  expect(ordinary.rowMinimumCardCounts).toEqual([3, 1]);
  const alternativeOnly = buildTimetableDisplayModel({ ...input, timetablePeriods: [period(1)], scheduleTemplates: templates.slice(1), usesAlternatingWeeks: true });
  expect(alternativeOnly.rowMinimumCardCounts).toEqual([1]);
});


it('reserves the existing time-status line without clipping either native time editor', () => {
  const model = buildTimetableDisplayModel({ ...input, timetablePeriods: [period(1, { startTime: null }), period(2)] });
  expect(model.gridRows).toBe('auto minmax(5rem, 1fr) minmax(4rem, 1fr)');
});
