// Which week the AI planner is on, read from localStorage KEY NAMES (pure: no browser import, unit-tested).
//
// The product keeps one `.ui` per (week, chat) and a `.core` per week with an accepted turn
// (weeklyPlanningVNextLocalSession.ts:22), and the planner follows the selected date's week for the same chat
// (useWeeklyPlanningVNextApplication.ts:65-74, :152). After any week change one chat therefore has several `.ui` keys, and
// a reader must never pick one of them by order: it either names the week or fails loudly.
const PREFIX = 'studyplanner.weeklyPlanning.vnext.';

/** Weeks (YYYY-MM-DD, sorted) of the active chat's keys with this suffix ('ui' or 'core'); the signed-out owner is ignored. */
export function weeksOf(names, chatId, suffix) {
  const tail = `.${chatId}.${suffix}`;
  return names
    .filter(name => name.startsWith(PREFIX) && !name.includes('.anonymous.') && name.endsWith(tail))
    .map(name => name.slice(PREFIX.length, name.length - tail.length).split('.').pop())
    .sort();
}

/** The one week, null when there is none; throws when the chat has more than one (never "whichever is first"). */
export function onlyWeek(weeks, what) {
  if (weeks.length > 1) {
    throw new Error(`Ambiguous planner week: the active chat has ${what} for weeks [${weeks.join(', ')}]. `
      + 'Read it only before any week change, or name the week explicitly.');
  }
  return weeks[0] ?? null;
}

/** The exact key name for (week, chat, suffix): exactly one must exist. */
export function keyForWeek(names, chatId, week, suffix) {
  const tail = `.${week}.${chatId}.${suffix}`;
  const keys = names.filter(name => name.startsWith(PREFIX) && !name.includes('.anonymous.') && name.endsWith(tail));
  if (keys.length !== 1) throw new Error(`Expected exactly one ${suffix} key for week ${week}, found ${keys.length}.`);
  return keys[0];
}

const addDays = (date, days) => new Date(date.getTime() + days * 86_400_000);
const isoDay = date => date.toISOString().slice(0, 10);
const utcDay = ms => { const d = new Date(ms); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };

/**
 * The target day for the plan flows, given the planner's current week start. Tomorrow (Asia/Tokyo, by the browser's clock)
 * when it lies in that week. Otherwise the planner must move to tomorrow's week: the third day of it, or tomorrow itself
 * when that is later, so the target is never in the past.
 */
export function chooseTargetDay(plannerWeekStart, browserNowMs) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(plannerWeekStart ?? '')) throw new Error('The planner week must be a YYYY-MM-DD date.');
  const start = new Date(`${plannerWeekStart}T00:00:00Z`);
  const tomorrow = utcDay(browserNowMs + 9 * 3600_000 + 86_400_000);
  const weeksAhead = Math.floor((tomorrow.getTime() - start.getTime()) / (7 * 86_400_000));
  if (weeksAhead === 0) return { date: tomorrow, switchWeek: false, weekStart: plannerWeekStart };
  const weekStart = addDays(start, 7 * weeksAhead);
  const third = addDays(weekStart, 2);
  return { date: third.getTime() >= tomorrow.getTime() ? third : tomorrow, switchWeek: true, weekStart: isoDay(weekStart) };
}

export { addDays, isoDay };
