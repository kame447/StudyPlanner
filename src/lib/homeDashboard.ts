import { addDays, getWeekDates, getWeekdayLabel, minutesBetween, sortByDateTime, todayIsoDate } from './date';
import { buildPlanOccurrenceKey, expandPlansForDate, getActualOccurrenceKey } from './planRecurrence';
import type { Actual, Plan, TodoTask } from '../types/domain';

export interface HomeDayProgress {
  date: string;
  label: string;
  plannedMinutes: number;
  actualMinutes: number;
}

export interface HomeDashboardModel {
  today: string;
  nextPlan: Plan | null;
  todayPlans: Plan[];
  actualByOccurrenceKey: Map<string, Actual>;
  missingActualPlans: Plan[];
  nearDueTodos: TodoTask[];
  primaryDueTodo: TodoTask | null;
  weekDays: HomeDayProgress[];
  weekPlannedMinutes: number;
  weekActualMinutes: number;
  weekProgressPercent: number;
  currentStreak: number;
  bestStreak: number;
}

function timeNowLabel(now: Date): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function studyMinutes(actual: Actual): number {
  return Math.max(0, minutesBetween(actual.actualStartTime, actual.actualEndTime));
}

function buildStudyDateSet(actuals: Actual[]): Set<string> {
  return new Set(
    actuals
      .filter((actual) => studyMinutes(actual) > 0)
      .map((actual) => actual.occurrenceDate),
  );
}

function calculateStreaks(actuals: Actual[], today: string): { current: number; best: number } {
  const studyDates = buildStudyDateSet(actuals);
  const sortedDates = Array.from(studyDates).sort();

  let best = 0;
  let running = 0;
  let previous: string | null = null;

  for (const date of sortedDates) {
    running = previous && addDays(previous, 1) === date ? running + 1 : 1;
    best = Math.max(best, running);
    previous = date;
  }

  let cursor = studyDates.has(today) ? today : addDays(today, -1);
  if (!studyDates.has(cursor)) {
    return { current: 0, best };
  }

  let current = 0;
  while (studyDates.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }

  return { current, best };
}

function sortDueTodos(todos: TodoTask[]): TodoTask[] {
  return todos.slice().sort((left, right) => {
    const leftKey = `${left.dueDate ?? '9999-12-31'}T${left.dueTime ?? '23:59'}`;
    const rightKey = `${right.dueDate ?? '9999-12-31'}T${right.dueTime ?? '23:59'}`;
    return leftKey.localeCompare(rightKey) || left.createdAt.localeCompare(right.createdAt);
  });
}

export function buildHomeDashboardModel({
  plans,
  actuals,
  todos,
  now = new Date(),
}: {
  plans: Plan[];
  actuals: Actual[];
  todos: TodoTask[];
  now?: Date;
}): HomeDashboardModel {
  const today = todayIsoDate();
  const nowTime = timeNowLabel(now);
  const todayPlans = sortByDateTime(expandPlansForDate(plans, today));
  const actualByOccurrenceKey = new Map(
    actuals.map((actual) => [getActualOccurrenceKey(actual), actual]),
  );
  const nextPlan =
    todayPlans.find((plan) => plan.endTime > nowTime) ?? null;
  const missingActualPlans = todayPlans.filter((plan) => {
    const occurrenceKey = buildPlanOccurrenceKey(plan.id, plan.date);
    return plan.endTime <= nowTime && !actualByOccurrenceKey.has(occurrenceKey);
  });

  const nearDueLimit = addDays(today, 2);
  const nearDueTodos = sortDueTodos(
    todos.filter(
      (todo) =>
        todo.status === 'open' &&
        Boolean(todo.dueDate) &&
        (todo.dueDate as string) <= nearDueLimit,
    ),
  );
  const primaryDueTodo = nearDueTodos[0] ?? null;

  const weekDays = getWeekDates(today).map((date) => {
    const dayPlans = expandPlansForDate(plans, date);
    const dayActuals = actuals.filter((actual) => actual.occurrenceDate === date);
    return {
      date,
      label: getWeekdayLabel(date),
      plannedMinutes: dayPlans.reduce(
        (sum, plan) => sum + Math.max(0, minutesBetween(plan.startTime, plan.endTime)),
        0,
      ),
      actualMinutes: dayActuals.reduce((sum, actual) => sum + studyMinutes(actual), 0),
    };
  });
  const weekPlannedMinutes = weekDays.reduce((sum, day) => sum + day.plannedMinutes, 0);
  const weekActualMinutes = weekDays.reduce((sum, day) => sum + day.actualMinutes, 0);
  const weekProgressPercent =
    weekPlannedMinutes > 0
      ? Math.round((weekActualMinutes / weekPlannedMinutes) * 100)
      : weekActualMinutes > 0
        ? 100
        : 0;
  const streaks = calculateStreaks(actuals, today);

  return {
    today,
    nextPlan,
    todayPlans,
    actualByOccurrenceKey,
    missingActualPlans,
    nearDueTodos,
    primaryDueTodo,
    weekDays,
    weekPlannedMinutes,
    weekActualMinutes,
    weekProgressPercent,
    currentStreak: streaks.current,
    bestStreak: streaks.best,
  };
}
