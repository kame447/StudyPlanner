import { describe, expect, it } from 'vitest';
import { weeklyPlanningTraceLocalDate } from './weeklyPlanningTraceDate';

describe('weeklyPlanningTraceLocalDate', () => {
  it('UTCでは前日でもJSTの表示日でfilterできる', () => {
    expect(weeklyPlanningTraceLocalDate(
      '2026-07-14T15:30:00.000Z',
      'Asia/Tokyo',
    )).toBe('2026-07-15');
  });

  it('JSTの日付境界直前を前日として扱う', () => {
    expect(weeklyPlanningTraceLocalDate(
      '2026-07-14T14:59:59.999Z',
      'Asia/Tokyo',
    )).toBe('2026-07-14');
  });
});
