import { describe, expect, it } from 'vitest';
import type { ScheduleOccurrence, ScheduleOccurrenceCategory } from '../domain/scheduleOccurrence';
import type { PlanType } from '../types/domain';
import {
  getMonthEventColor,
  MONTH_EVENT_COLOR_OPTIONS,
  getPlanScheduleColor,
  getScheduleOccurrenceColor,
  scheduleEventColorStyle,
  scheduleEventWeekStyle,
} from './scheduleEventColor';
import { getSubjectTheme } from './subjectTheme';

function occurrence(overrides: Partial<ScheduleOccurrence> = {}): ScheduleOccurrence {
  return {
    id: 'month-event:shift-1:2026-10-15', ownerId: 'owner', title: '塾バイト', subject: '主要予定',
    category: 'other', busy: true,
    start: { date: '2026-10-15', time: '17:00' }, end: { date: '2026-10-15', time: '21:30' },
    source: { kind: 'month-event', id: 'shift-1', backingKind: 'month-event', backingId: 'shift-1' },
    ...overrides,
  };
}

describe('schedule event color authority', () => {
  it.each(MONTH_EVENT_COLOR_OPTIONS)('uses the saved $key choice regardless of source identity', option => {
    expect(getMonthEventColor('shift-1', option.key)).toBe(option.color);
    expect(getMonthEventColor('another-id', option.key)).toBe(option.color);
    expect(getScheduleOccurrenceColor(occurrence({ color: option.key }))).toBe(option.color);
  });

  it('never renders unrecognized persisted color as arbitrary CSS', () => {
    expect(getMonthEventColor('shift-1', '#000' as never)).toBe(getMonthEventColor('shift-1'));
  });

  it('uses saved identity even when projection id, title, dates and busy status change', () => {
    const original = occurrence();
    const changed = occurrence({
      id: 'month-event:shift-1:2026-10-22', title: '変更した予定', busy: false,
      start: { date: '2026-10-22', time: '09:00' }, end: { date: '2026-10-23', time: '12:00' },
    });
    expect(getScheduleOccurrenceColor(original)).toBe(getMonthEventColor('shift-1'));
    expect(getScheduleOccurrenceColor(changed)).toBe(getScheduleOccurrenceColor(original));
    expect(getMonthEventColor('shift-2')).not.toBe(getMonthEventColor('shift-1'));
  });

  it.each<[ScheduleOccurrenceCategory, PlanType]>([
    ['study', 'study'], ['exam', 'mock-exam'], ['school', 'school-event'], ['class', 'school-event'],
    ['cram-school', 'cram-school'], ['deadline', 'deadline'], ['other', 'other'],
  ])('preserves the semantic color of %s Plan-backed occurrences', (category, type) => {
    const item = occurrence({ category, subject: '', source: { kind: 'plan', id: 'plan', backingKind: 'plan', backingId: 'plan' } });
    expect(getScheduleOccurrenceColor(item)).toBe(getSubjectTheme('', type).fill);
    expect(getPlanScheduleColor({ subject: '', type })).toBe(getScheduleOccurrenceColor(item));
  });

  it('preserves a study subject accent and read-model presentation metadata', () => {
    expect(getPlanScheduleColor({ subject: '数学', type: 'study' })).toBe('#2f78e3');
    expect(getPlanScheduleColor({ subject: '数学', type: 'study', scheduleColor: '#ef7b9f' })).toBe('#ef7b9f');
    expect(getPlanScheduleColor({ subject: '情報', type: 'school-event', sourceType: 'timetable' }))
      .toBe(getSubjectTheme('情報', 'school-event', 'timetable').fill);
  });

  it('derives surface and border variants from one accent and current theme surface', () => {
    const style = scheduleEventColorStyle('#ef7b9f');
    expect(style).toEqual({
      '--schedule-event-color': '#ef7b9f',
      '--schedule-event-bg': 'color-mix(in srgb, var(--schedule-event-color) 24%, var(--surface) 76%)',
      '--schedule-event-border': 'color-mix(in srgb, var(--schedule-event-color) 55%, var(--border) 45%)',
    });
    expect(scheduleEventWeekStyle('#ef7b9f')).toMatchObject(style);
  });

  it('retains light week-plan surfaces and fixed readable text without changing the accent', () => {
    expect(scheduleEventWeekStyle('#2f78e3', 'pastel')).toMatchObject({
      '--schedule-event-color': '#2f78e3',
      '--weekly-draft-tone': 'var(--schedule-event-color)',
      '--weekly-draft-tone-bg': 'color-mix(in srgb, var(--schedule-event-color) 13%, #fff 87%)',
      '--text': '#263238',
      '--text-muted': '#52606d',
    });
    expect(scheduleEventWeekStyle('#2f78e3')).not.toHaveProperty('--text');
  });
});
