import type { CalendarFreeDayV5 } from '../application/weeklyPlanningPlanningNeedsV5';

/**
 * Clock expressions of a rendered reply that the typed calendar grounds (Issue #488 P3 S2, a declared P4 re-targeting like M1):
 * a time is grounded when it lies INSIDE a free window the application listed for the day (`communication.calendarFree`), so a
 * proposal made from the calendar is not rejected as ungrounded. When the reply names a date (「10月12日」), the time must lie in
 * a window of THAT day (a fully busy day grounds nothing); with no date it must lie in a window of some listed day. Without
 * `calendarFree` nothing is grounded (today's behaviour). Interaction only (the field exists only there). No language is parsed
 * beyond the validator's own literal clock/date patterns.
 */
const CLOCK = /(?:[01]?\d|2[0-3])[:：][0-5]\d|(?:午前|午後)?\s*(?:[01]?\d|2[0-3])\s*時(?:\s*(?:[0-5]?\d\s*分|半))?/g;
const DATE = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/g;

function minutesOf(expression: string): number | null {
  const compact = expression.replace(/\s+/g, '').replace('：', ':');
  const colon = /^(\d{1,2}):(\d{2})$/.exec(compact);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);
  const japanese = /^(午前|午後)?(\d{1,2})時(?:(\d{1,2})分|半)?$/.exec(compact);
  if (!japanese) return null;
  let hour = Number(japanese[2]);
  const minute = japanese[3] !== undefined ? Number(japanese[3]) : compact.endsWith('半') ? 30 : 0;
  if (japanese[1] === '午前' && hour === 12) hour = 0;
  if (japanese[1] === '午後' && hour < 12) hour += 12;
  return hour * 60 + minute;
}

function windowsOf(day: CalendarFreeDayV5): Array<{ start: number; end: number }> {
  return day.windows.flatMap((window) => {
    const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(window);
    return match ? [{ start: Number(match[1]) * 60 + Number(match[2]), end: Number(match[3]) * 60 + Number(match[4]) }] : [];
  });
}

export function clockExpressionsGroundedByCalendar(text: string, calendarFree: readonly CalendarFreeDayV5[] | undefined): string[] {
  if (!calendarFree || calendarFree.length === 0) return [];
  const named = [...text.matchAll(DATE)].map((match) => ({ month: Number(match[1]), day: Number(match[2]) }));
  const days = named.length === 0
    ? calendarFree
    : calendarFree.filter((day) => named.some((date) => Number(day.date.slice(5, 7)) === date.month && Number(day.date.slice(8, 10)) === date.day));
  const windows = days.flatMap(windowsOf);
  return [...text.matchAll(CLOCK)].map((match) => match[0]).filter((expression) => {
    const minutes = minutesOf(expression);
    // The end of a window (22:00) is inside the free time as a boundary.
    return minutes !== null && windows.some((window) => minutes >= window.start && minutes <= window.end);
  });
}
