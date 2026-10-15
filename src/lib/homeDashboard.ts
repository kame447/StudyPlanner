import { elapsedEntryMinutes, getEntryDurationMinutes } from './entryTimeRange';
import {
  addDays,
  getWeekDates,
  getWeekdayLabel,
  sortByDateTime,
  toIsoDate,
} from './date';
import {
  buildPlanOccurrenceKey,
  expandPlansForDate,
  getActualOccurrenceKey,
} from './planRecurrence';
import { isActualProgressSourceIncluded, canRecordProgressActual, DEFAULT_STUDY_PROGRESS_PREFERENCES, isIncludedInStudyProgress, type StudyProgressPreferences } from './studyProgressPolicy';
import {
  normalizeStudyRecordsForDisplay,
} from './studyRecords';
import type { Actual, MonthEvent, Plan, TodoTask } from '../types/domain';
import { calculateStudyStreaks } from './studyStreak';

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
  upcomingPlans: Plan[];
  actualByOccurrenceKey: Map<string, Actual>;
  missingActualPlans: Plan[];
  nearDueTodos: TodoTask[];
  primaryDueTodo: TodoTask | null;
  weekDays: HomeDayProgress[];
  weekPlannedMinutes: number;
  weekActualMinutes: number;
  weekExpectedMinutesByNow: number;
  weekActualMinutesByNow: number;
  weekDeltaMinutesByNow: number;
  weekProgressPercent: number;
  currentStreak: number;
  bestStreak: number;
}

function timeNowLabel(now: Date): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function studyMinutes(actual: Actual): number {
  return Math.max(0, getEntryDurationMinutes(actual.actualStartTime, actual.actualEndTime));
}

function plannedMinutesByNow(plan: Plan, date: string, today: string, nowTime: string): number {
  return elapsedEntryMinutes(date, plan.startTime, plan.endTime, today, nowTime);
}

function actualMinutesByNow(actual: Actual, today: string, nowTime: string): number {
  return elapsedEntryMinutes(actual.occurrenceDate, actual.actualStartTime, actual.actualEndTime, today, nowTime);
}

function buildStudyDateSet(actuals: Actual[]): Set<string> {
  return new Set(
    actuals
      .filter((actual) => studyMinutes(actual) > 0)
      .map((actual) => actual.occurrenceDate),
  );
}

function sortDueTodos(todos: TodoTask[]): TodoTask[] {
  return todos.slice().sort((left, right) => {
    const leftKey = `${left.dueDate ?? '9999-12-31'}T${left.dueTime ?? '23:59'}`;
    const rightKey = `${right.dueDate ?? '9999-12-31'}T${right.dueTime ?? '23:59'}`;
    return leftKey.localeCompare(rightKey) || left.createdAt.localeCompare(right.createdAt);
  });
}

function buildUpcomingPlans(plans: Plan[], today: string): Plan[] {
  const projected = Array.from({ length: 7 }, (_, index) => addDays(today, index + 1))
    .flatMap((date) => expandPlansForDate(plans, date));

  return sortByDateTime(projected).slice(0, 6);
}

function resolveStudyActuals(
  plans: Plan[],
  actuals: Actual[],
  monthEvents: MonthEvent[],
  preferences: StudyProgressPreferences,
): Actual[] {
  const studyActualIds = new Set(
    normalizeStudyRecordsForDisplay({ actuals, plans, monthEvents })
      .filter((record) => record.monthEvent
        ? preferences.includeGeneralEvents
        : record.plan ? isIncludedInStudyProgress(record.plan, preferences)
          : isActualProgressSourceIncluded(record.actual.progressSource, preferences))
      .map((record) => record.actualId),
  );

  return actuals.filter((actual) => studyActualIds.has(actual.id));
}

export function buildHomeDashboardModel({
  plans,
  actuals,
  monthEvents = [],
  todos,
  now = new Date(),
  progressPreferences = DEFAULT_STUDY_PROGRESS_PREFERENCES,
}: {
  plans: Plan[];
  actuals: Actual[];
  monthEvents?: MonthEvent[];
  todos: TodoTask[];
  now?: Date;
  progressPreferences?: StudyProgressPreferences;
}): HomeDashboardModel {
  const today = toIsoDate(now);
  const nowTime = timeNowLabel(now);
  const todayPlans = sortByDateTime(expandPlansForDate(plans, today));
  const todayStudyPlans = todayPlans.filter((plan) => isIncludedInStudyProgress(plan, progressPreferences));
  const upcomingPlans = buildUpcomingPlans(plans, today);
  const studyActuals = resolveStudyActuals(plans, actuals, monthEvents, progressPreferences);
  const actualByOccurrenceKey = new Map(
    actuals.map((actual) => [getActualOccurrenceKey(actual), actual]),
  );
  const nextPlan = todayPlans.find((plan) =>
    getEntryDurationMinutes(plan.startTime, plan.endTime) > plannedMinutesByNow(plan, today, today, nowTime)) ?? null;
  const missingActualPlans = todayStudyPlans.filter((plan) => {
    const occurrenceKey = buildPlanOccurrenceKey(plan.id, plan.date);
    return canRecordProgressActual(plan)
      && getEntryDurationMinutes(plan.startTime, plan.endTime) > 0
      && plannedMinutesByNow(plan, today, today, nowTime) >= getEntryDurationMinutes(plan.startTime, plan.endTime)
      && !actualByOccurrenceKey.has(occurrenceKey);
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

  let weekExpectedMinutesByNow = 0;
  let weekActualMinutesByNow = 0;
  const weekDays = getWeekDates(today).map((date) => {
    const dayPlans = expandPlansForDate(plans, date).filter((plan) => isIncludedInStudyProgress(plan, progressPreferences));
    const dayActuals = studyActuals.filter((actual) => actual.occurrenceDate === date);

    weekExpectedMinutesByNow += dayPlans.reduce(
      (sum, plan) => sum + plannedMinutesByNow(plan, date, today, nowTime),
      0,
    );
    weekActualMinutesByNow += dayActuals.reduce(
      (sum, actual) => sum + actualMinutesByNow(actual, today, nowTime),
      0,
    );

    return {
      date,
      label: getWeekdayLabel(date),
      plannedMinutes: dayPlans.reduce(
        (sum, plan) => sum + Math.max(0, getEntryDurationMinutes(plan.startTime, plan.endTime)),
        0,
      ),
      actualMinutes: dayActuals.reduce((sum, actual) => sum + studyMinutes(actual), 0),
    };
  });
  const weekPlannedMinutes = weekDays.reduce((sum, day) => sum + day.plannedMinutes, 0);
  const weekActualMinutes = weekDays.reduce((sum, day) => sum + day.actualMinutes, 0);
  const weekDeltaMinutesByNow = weekActualMinutesByNow - weekExpectedMinutesByNow;
  const weekProgressPercent =
    weekPlannedMinutes > 0
      ? Math.round((weekActualMinutes / weekPlannedMinutes) * 100)
      : weekActualMinutes > 0
        ? 100
        : 0;
  const streaks = calculateStudyStreaks([...buildStudyDateSet(studyActuals)], today);

  return {
    today,
    nextPlan,
    todayPlans,
    upcomingPlans,
    actualByOccurrenceKey,
    missingActualPlans,
    nearDueTodos,
    primaryDueTodo,
    weekDays,
    weekPlannedMinutes,
    weekActualMinutes,
    weekExpectedMinutesByNow,
    weekActualMinutesByNow,
    weekDeltaMinutesByNow,
    weekProgressPercent,
    currentStreak: streaks.current,
    bestStreak: streaks.best,
  };
}
