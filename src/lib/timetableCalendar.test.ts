import { describe, expect, it } from 'vitest';
import {
  isBiweeklyTemplateActiveOnDate,
  isDateWithinTimetableTerm,
  isScheduleTemplateActiveOnDate,
  resolveTimetableAlternatingWeek,
  resolveTimetableTermForDate,
} from './timetableCalendar';
import type { ScheduleTemplate, TimetableTerm } from '../types/domain';

const TERM: TimetableTerm = {
  id: 'term-spring',
  userId: 'user-1',
  year: 2026,
  kind: 'custom',
  label: '2026年前期',
  startDate: '2026-04-01',
  endDate: '2026-07-31',
  usesAlternatingWeeks: true,
  alternatingWeekAnchorDate: '2026-04-06',
  isActive: true,
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:00:00.000Z',
};

function template(
  overrides: Partial<ScheduleTemplate> = {},
): ScheduleTemplate {
  return {
    id: 'template-1',
    userId: 'user-1',
    title: '情報数学',
    subject: '数学',
    type: 'school-event',
    weekday: 'mon',
    startTime: '10:20',
    endTime: '11:50',
    termId: TERM.id,
    periodNumber: 2,
    classroom: 'A101',
    memo: '',
    active: true,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('timetable calendar recurrence', () => {
  it('treats timetable period boundaries as inclusive', () => {
    expect(isDateWithinTimetableTerm('2026-04-01', TERM)).toBe(true);
    expect(isDateWithinTimetableTerm('2026-07-31', TERM)).toBe(true);
    expect(isDateWithinTimetableTerm('2026-03-31', TERM)).toBe(false);
    expect(isDateWithinTimetableTerm('2026-08-01', TERM)).toBe(false);
  });

  it('resolves the timetable period from the viewed date instead of only the active selection', () => {
    const autumn: TimetableTerm = {
      ...TERM,
      id: 'term-autumn',
      label: '2026年後期',
      startDate: '2026-09-20',
      endDate: '2027-02-10',
      usesAlternatingWeeks: false,
      alternatingWeekAnchorDate: null,
      isActive: false,
      updatedAt: '2026-09-01T00:00:00.000Z',
    };

    expect(resolveTimetableTermForDate('2026-06-01', [TERM, autumn], TERM.id)?.id).toBe(TERM.id);
    expect(resolveTimetableTermForDate('2026-10-01', [TERM, autumn], TERM.id)?.id).toBe(autumn.id);
    expect(resolveTimetableTermForDate('2026-08-20', [TERM, autumn], TERM.id)).toBeNull();
  });

  it('keeps an unbounded legacy timetable as a fallback when no dated period exists', () => {
    const legacy: TimetableTerm = {
      ...TERM,
      id: 'legacy',
      label: '既存時間割',
      startDate: null,
      endDate: null,
      usesAlternatingWeeks: false,
      alternatingWeekAnchorDate: null,
      isActive: true,
    };

    expect(resolveTimetableTermForDate('2026-08-20', [legacy], legacy.id)?.id).toBe('legacy');
  });

  it('alternates A and B by calendar week from the configured A-week anchor', () => {
    expect(resolveTimetableAlternatingWeek('2026-04-06', TERM)).toBe('a');
    expect(resolveTimetableAlternatingWeek('2026-04-12', TERM)).toBe('a');
    expect(resolveTimetableAlternatingWeek('2026-04-13', TERM)).toBe('b');
    expect(resolveTimetableAlternatingWeek('2026-04-20', TERM)).toBe('a');
  });

  it('keeps class-level biweekly recurrence separate from alternating-week scope', () => {
    const biweekly = template({
      alternatingWeek: 'both',
      weekInterval: 2,
      weekIntervalAnchorDate: '2026-04-06',
    });

    expect(isBiweeklyTemplateActiveOnDate(biweekly, '2026-04-06')).toBe(true);
    expect(isBiweeklyTemplateActiveOnDate(biweekly, '2026-04-13')).toBe(false);
    expect(isBiweeklyTemplateActiveOnDate(biweekly, '2026-04-20')).toBe(true);
  });

  it('filters a class by timetable A/B scope without turning biweekly into a week type', () => {
    const aWeekClass = template({ alternatingWeek: 'a', weekInterval: 1 });
    const bWeekClass = template({ alternatingWeek: 'b', weekInterval: 1 });

    expect(isScheduleTemplateActiveOnDate(aWeekClass, '2026-04-06', TERM)).toBe(true);
    expect(isScheduleTemplateActiveOnDate(aWeekClass, '2026-04-13', TERM)).toBe(false);
    expect(isScheduleTemplateActiveOnDate(bWeekClass, '2026-04-06', TERM)).toBe(false);
    expect(isScheduleTemplateActiveOnDate(bWeekClass, '2026-04-13', TERM)).toBe(true);
  });

  it('fails closed for a biweekly class without a valid anchor', () => {
    expect(
      isBiweeklyTemplateActiveOnDate(
        template({ weekInterval: 2, weekIntervalAnchorDate: null }),
        '2026-04-06',
      ),
    ).toBe(false);
  });
});
