import { expect, it } from 'vitest';
import type { ScheduleOccurrence } from '../domain/scheduleOccurrence';
import { dayOccurrenceCancellationPresentation } from './dayOccurrenceCancellationPresentation';
const occurrence: ScheduleOccurrence = { id: 'p', ownerId: 'owner', title: '予定', subject: '', category: 'other', busy: true,
  start: { date: '2026-10-05', time: '23:00' }, end: { date: '2026-10-05', time: '23:30' },
  source: { kind: 'plan', id: 'p', backingKind: 'plan', backingId: 'p' } };
it('uses the day-only label for a single day, including an end at its midnight boundary', () => {
  for (const end of [occurrence.end, { date: '2026-10-06', time: '00:00' }]) {
    expect(dayOccurrenceCancellationPresentation({ ...occurrence, end }, { repeat: 'weekly' })).toEqual({ label: 'この日だけ削除', description: undefined });
  }
});
it.each([{ date: '2026-10-06', time: '01:00' }, { date: '2026-10-07', time: '00:00' }])('explains the entire occurrence range for a cross-day cancellation ending $date $time', end => {
  const copy = dayOccurrenceCancellationPresentation({ ...occurrence, end }, { repeat: 'weekly' });
  expect(copy.label).toBe('この回だけ削除');
  expect(copy.description).toContain('10/5(月)'); expect(copy.description).toContain(end.time);
  expect(copy.description).toContain('開始から終了まで、この回全体');
});

it.each([
  { date: '2026-10-05', time: '23:30' },
  { date: '2026-10-06', time: '00:00' },
  { date: '2026-10-06', time: '01:00' },
  { date: '2026-10-07', time: '00:00' },
])('uses event deletion wording for a one-off ending $date $time', end => {
  const copy = dayOccurrenceCancellationPresentation({ ...occurrence, end }, { repeat: 'none' });
  expect(copy.label).toBe('予定を削除');
  expect(copy.description ?? '').not.toMatch(/この回|別の回/);
  if (end.date === '2026-10-07' || end.time === '01:00') {
    expect(copy.description).toContain('この予定全体');
    expect(copy.description).toContain('記録は残ります');
  }
});
it.each(['plan', 'timetable-template'] as const)('retains scoped wording for timetable backed by %s', backingKind => {
  expect(dayOccurrenceCancellationPresentation({ ...occurrence, source: { ...occurrence.source, kind: 'timetable', backingKind } }).label).toBe('この日だけ削除');
});
it('defaults a missing source to neutral event deletion wording', () => {
  expect(dayOccurrenceCancellationPresentation(occurrence).label).toBe('予定を削除');
});
it.each([
  { kind: 'date', dates: ['2026-10-05'], repeat: 'none', label: '予定を削除' },
  { kind: 'date', dates: ['2026-10-05', '2026-10-12'], repeat: 'none', label: 'この日だけ削除' },
  { kind: 'weekday', dates: [], repeat: 'none', label: 'この日だけ削除' },
  { kind: 'date', dates: ['2026-10-05'], repeat: 'weekly', label: '予定を削除' },
] as const)('uses authoritative $kind rules over legacy repeat=$repeat', ({ kind, dates, repeat, label }) => {
  const rule = { id: 'rule', kind, dates: [...dates], startDate: '2026-10-05', until: null,
    weekdays: ['mon' as const], dayType: null, startTime: '23:00', endTime: '23:30', isOverride: false };
  expect(dayOccurrenceCancellationPresentation(occurrence, { repeat, recurrenceRules: [rule] }).label).toBe(label);
});
it('recognizes multiple dates across separate date rules as repeated occurrences', () => {
  const rules = ['2026-10-05', '2026-10-12'].map(date => ({ id: date, kind: 'date' as const, dates: [date],
    startDate: date, until: null, weekdays: [], dayType: null, startTime: '23:00', endTime: '23:30', isOverride: false }));
  expect(dayOccurrenceCancellationPresentation(occurrence, { repeat: 'none', recurrenceRules: rules }).label).toBe('この日だけ削除');
});
