import { describe, expect, it } from 'vitest';
import { clockExpressionsGroundedByCalendar } from './weeklyPlanningCalendarClockGrounding';

const free = [
  { date: '2026-10-12', freeMinutes: 0, windows: [] },
  { date: '2026-10-13', freeMinutes: 780, windows: ['09:00-22:00'] },
  { date: '2026-10-14', freeMinutes: 360, windows: ['09:00-12:00', '18:00-21:00'] },
];

describe('clockExpressionsGroundedByCalendar', () => {
  it('a time inside a listed free window is grounded (colon and 時 forms)', () => {
    expect(clockExpressionsGroundedByCalendar('火曜の20:00から21:00が空いています', free)).toEqual(['20:00', '21:00']);
    expect(clockExpressionsGroundedByCalendar('午後8時から9時', free)).toEqual(['午後8時', '9時']);
  });
  it('the window boundaries count as free (a proposal may end at the window end)', () => {
    expect(clockExpressionsGroundedByCalendar('21:00から22:00', free)).toEqual(['21:00', '22:00']);
    expect(clockExpressionsGroundedByCalendar('22:01', free)).toEqual([]);
  });
  it('夜/晩/夕方 + h (h <= 11) is the evening hour; 朝 + h stays; a duration is never a clock', () => {
    expect(clockExpressionsGroundedByCalendar('火曜の夜8時から9時は空いています', free)).toEqual(['8時', '9時']);
    expect(clockExpressionsGroundedByCalendar('夕方5時から', free)).toEqual(['5時']);
    expect(clockExpressionsGroundedByCalendar('朝9時から', free)).toEqual(['9時']);
    expect(clockExpressionsGroundedByCalendar('朝8時から', free)).toEqual([]);
    expect(clockExpressionsGroundedByCalendar('夜1時から', free)).toEqual([]);
    expect(clockExpressionsGroundedByCalendar('月曜と水曜の夜に1時間ずつ空きがあります', free)).toEqual([]);
  });
  it('a time outside every free window is not grounded', () => {
    expect(clockExpressionsGroundedByCalendar('朝の6:00から', free)).toEqual([]);
    expect(clockExpressionsGroundedByCalendar('13:00から', [{ date: '2026-10-14', freeMinutes: 360, windows: ['09:00-12:00', '18:00-21:00'] }])).toEqual([]);
  });
  it('a named date binds the time to THAT day: a fully busy day grounds nothing', () => {
    expect(clockExpressionsGroundedByCalendar('10月12日の20:00に', free)).toEqual([]);
    expect(clockExpressionsGroundedByCalendar('10月13日の20:00に', free)).toEqual(['20:00']);
    expect(clockExpressionsGroundedByCalendar('10月14日の13:00に', free)).toEqual([]);
    expect(clockExpressionsGroundedByCalendar('10月14日の19:30に', free)).toEqual(['19:30']);
  });
  it('documented residual (availability claims are not verified): a time free on ANOTHER day, attributed to a busy day by a weekday word, is grounded today', () => {
    // 月曜 is fully busy and 火曜 is free at 20:00; a weekday word cannot be paired with a time by the validator's literal patterns.
    expect(clockExpressionsGroundedByCalendar('月曜の20:00から21:00が空いています', free)).toEqual(['20:00', '21:00']);
  });
  it('without calendarFree nothing is grounded (today\'s behaviour)', () => {
    expect(clockExpressionsGroundedByCalendar('20:00から', undefined)).toEqual([]);
    expect(clockExpressionsGroundedByCalendar('20:00から', [])).toEqual([]);
  });
});
