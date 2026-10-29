import { describe, expect, it } from 'vitest';
import type { ScheduleTemplate, TimetablePeriod } from '../types/domain';
import { buildTimetableDisplayModel, DEFAULT_PERIODS, WEEKDAY_OPTIONS } from './timetableDisplayModel';

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
