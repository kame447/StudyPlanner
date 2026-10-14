import { expect, it } from 'vitest';
import type { ScheduleOccurrence } from '../domain/scheduleOccurrence';
import { dayOccurrenceCancellationPresentation } from './dayOccurrenceCancellationPresentation';
const occurrence: ScheduleOccurrence = { id: 'p', ownerId: 'owner', title: '予定', subject: '', category: 'other', busy: true,
  start: { date: '2026-10-05', time: '23:00' }, end: { date: '2026-10-05', time: '23:30' },
  source: { kind: 'plan', id: 'p', backingKind: 'plan', backingId: 'p' } };
it('uses the day-only label for a single day, including an end at its midnight boundary', () => {
  for (const end of [occurrence.end, { date: '2026-10-06', time: '00:00' }]) {
    expect(dayOccurrenceCancellationPresentation({ ...occurrence, end })).toEqual({ label: 'この日だけ削除', description: undefined });
  }
});
it.each([{ date: '2026-10-06', time: '01:00' }, { date: '2026-10-07', time: '00:00' }])('explains the entire occurrence range for a cross-day cancellation ending $date $time', end => {
  const copy = dayOccurrenceCancellationPresentation({ ...occurrence, end });
  expect(copy.label).toBe('この回だけ削除');
  expect(copy.description).toContain('10/5(月)'); expect(copy.description).toContain(end.time);
  expect(copy.description).toContain('開始から終了まで、この回全体');
});
