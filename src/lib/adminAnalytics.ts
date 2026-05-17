import {
  addDays,
  addMonths,
  startOfMonth,
  startOfWeek,
  todayIsoDate,
  sortByDateTime,
} from './date';
import {
  buildPlanOccurrenceKey,
  expandPlansForDate,
  expandPlansForDateRange,
  getActualOccurrenceKey,
} from './planRecurrence';
import {
  calculateTodayStudyMinutes,
  calculateWeeklyStudyMinutes,
  getActualMinutes,
  getPlannedMinutes,
  isStudyTimePlan,
} from './studyAnalytics';
import type {
  Actual,
  AdminDailyRecordSummary,
  AdminDashboardStats,
  AdminMaterialSummary,
  AdminPeriodReportSummary,
  AdminReportMode,
  AdminUserSummary,
  AdminWeeklyRecordSummary,
  DayNote,
  Plan,
  StudyMaterial,
  TodoTask,
} from '../types/domain';

interface AdminDashboardStatsInput {
  plans: Plan[];
  actuals: Actual[];
  todos: TodoTask[];
  dayNotes?: DayNote[];
  referenceDate?: string;
  profileCreatedAt?: string | null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function getTodayRange(referenceDate = todayIsoDate()): {
  startDate: string;
  endDate: string;
} {
  return getDayRange(referenceDate);
}

export function getDayRange(referenceDate = todayIsoDate()): {
  startDate: string;
  endDate: string;
} {
  return {
    startDate: referenceDate,
    endDate: referenceDate,
  };
}

export function getWeekRange(referenceDate = todayIsoDate()): {
  startDate: string;
  endDate: string;
} {
  const startDate = startOfWeek(referenceDate);

  return {
    startDate,
    endDate: addDays(startDate, 6),
  };
}

export function getMonthRange(referenceDate = todayIsoDate()): {
  startDate: string;
  endDate: string;
} {
  const startDate = startOfMonth(referenceDate);

  return {
    startDate,
    endDate: addDays(addMonths(startDate, 1), -1),
  };
}

export function getAdminReportRange(
  mode: AdminReportMode,
  referenceDate = todayIsoDate(),
): {
  startDate: string;
  endDate: string;
} {
  if (mode === 'day') {
    return getDayRange(referenceDate);
  }

  if (mode === 'week') {
    return getWeekRange(referenceDate);
  }

  return getMonthRange(referenceDate);
}

function isDateInRange(date: string, startDate: string, endDate: string): boolean {
  return date.localeCompare(startDate) >= 0 && date.localeCompare(endDate) <= 0;
}

function getDatesInRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let cursor = startDate;

  while (cursor.localeCompare(endDate) <= 0) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }

  return dates;
}

export function sumDurationMinutes(actuals: Actual[]): number {
  return actuals.reduce((sum, actual) => sum + getActualMinutes(actual), 0);
}

export function countTodayActuals(
  actuals: Actual[],
  referenceDate = todayIsoDate(),
): number {
  return actuals.filter((actual) => actual.occurrenceDate === referenceDate).length;
}

export function isIncompleteTodo(todo: TodoTask): boolean {
  return todo.status === 'open' || todo.status === 'scheduled';
}

export function countIncompleteTodos(todos: TodoTask[]): number {
  return todos.filter(isIncompleteTodo).length;
}

export function getLatestUpdatedAt(
  records: Array<Array<{ updatedAt?: string; createdAt?: string }>>,
  fallback: string | null = null,
): string | null {
  const timestamps = records
    .flatMap((items) =>
      items.flatMap((item) => [item.updatedAt, item.createdAt].filter(isNonEmptyString)),
    )
    .sort((left, right) => right.localeCompare(left));

  return timestamps[0] ?? fallback;
}

export function buildAdminDashboardStats({
  plans,
  actuals,
  todos,
  dayNotes = [],
  referenceDate = todayIsoDate(),
  profileCreatedAt = null,
}: AdminDashboardStatsInput): AdminDashboardStats {
  return {
    todayStudyMinutes: calculateTodayStudyMinutes(referenceDate, plans, actuals),
    weekStudyMinutes: calculateWeeklyStudyMinutes(referenceDate, plans, actuals),
    todayActualCount: countTodayActuals(actuals, referenceDate),
    incompleteTodoCount: countIncompleteTodos(todos),
    lastUpdatedAt: getLatestUpdatedAt(
      [plans, actuals, todos, dayNotes],
      profileCreatedAt,
    ),
  };
}

export function getTodayPlans(
  plans: Plan[],
  referenceDate = todayIsoDate(),
): Plan[] {
  return sortByDateTime(expandPlansForDate(plans, referenceDate));
}

export function getActualsInRange(
  actuals: Actual[],
  startDate: string,
  endDate: string,
): Actual[] {
  return [...actuals]
    .filter((actual) => isDateInRange(actual.occurrenceDate, startDate, endDate))
    .sort((left, right) => {
      const dateComparison = left.occurrenceDate.localeCompare(right.occurrenceDate);

      if (dateComparison !== 0) {
        return dateComparison;
      }

      return left.actualStartTime.localeCompare(right.actualStartTime);
    });
}

export function getTodayActuals(
  actuals: Actual[],
  referenceDate = todayIsoDate(),
): Actual[] {
  return getActualsInRange(actuals, referenceDate, referenceDate);
}

export function getRecentDayNotes(dayNotes: DayNote[], limit = 5): DayNote[] {
  return [...dayNotes]
    .filter(
      (dayNote) =>
        dayNote.quickMemo.trim() ||
        dayNote.reflection.trim() ||
        dayNote.nextFocus.trim(),
    )
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, limit);
}

export function summarizeLast7Days(
  plans: Plan[],
  actuals: Actual[],
  referenceDate = todayIsoDate(),
): AdminDailyRecordSummary[] {
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(referenceDate, index - 6);
    const dayActuals = actuals.filter((actual) => actual.occurrenceDate === date);

    return {
      date,
      minutes: calculateTodayStudyMinutes(date, plans, actuals),
      actualCount: dayActuals.length,
    };
  });
}

export function summarizeByDate(
  plans: Plan[],
  actuals: Actual[],
  startDate: string,
  endDate: string,
): AdminDailyRecordSummary[] {
  return getDatesInRange(startDate, endDate).map((date) => {
    const dayActuals = actuals.filter((actual) => actual.occurrenceDate === date);

    return {
      date,
      minutes: calculateTodayStudyMinutes(date, plans, actuals),
      actualCount: dayActuals.length,
    };
  });
}

export function summarizeByWeek(
  plans: Plan[],
  actuals: Actual[],
  startDate: string,
  endDate: string,
): AdminWeeklyRecordSummary[] {
  const dailySummaries = summarizeByDate(plans, actuals, startDate, endDate);
  const summariesByWeek = new Map<string, AdminWeeklyRecordSummary>();

  dailySummaries.forEach((dailySummary) => {
    const weekStartDate = startOfWeek(dailySummary.date);
    const boundedStartDate =
      weekStartDate.localeCompare(startDate) < 0 ? startDate : weekStartDate;
    const rawWeekEndDate = addDays(weekStartDate, 6);
    const boundedEndDate =
      rawWeekEndDate.localeCompare(endDate) > 0 ? endDate : rawWeekEndDate;
    const current = summariesByWeek.get(weekStartDate) ?? {
      startDate: boundedStartDate,
      endDate: boundedEndDate,
      minutes: 0,
      actualCount: 0,
    };

    summariesByWeek.set(weekStartDate, {
      ...current,
      minutes: current.minutes + dailySummary.minutes,
      actualCount: current.actualCount + dailySummary.actualCount,
    });
  });

  return [...summariesByWeek.values()].sort((left, right) =>
    left.startDate.localeCompare(right.startDate),
  );
}

export function calculateWeekPlannedMinutes(
  plans: Plan[],
  referenceDate = todayIsoDate(),
): number {
  const { startDate, endDate } = getWeekRange(referenceDate);

  return expandPlansForDateRange(plans, startDate, endDate)
    .filter(isStudyTimePlan)
    .reduce((sum, plan) => sum + getPlannedMinutes(plan), 0);
}

export function calculatePlannedMinutesInRange(
  plans: Plan[],
  startDate: string,
  endDate: string,
): number {
  return expandPlansForDateRange(plans, startDate, endDate)
    .filter(isStudyTimePlan)
    .reduce((sum, plan) => sum + getPlannedMinutes(plan), 0);
}

export function buildMaterialSummaries(
  plans: Plan[],
  actuals: Actual[],
  materials: StudyMaterial[] = [],
  limit = 6,
): AdminMaterialSummary[] {
  if (actuals.length === 0) {
    return [];
  }

  const sortedDates = actuals
    .map((actual) => actual.occurrenceDate)
    .filter(isNonEmptyString)
    .sort();

  if (sortedDates.length === 0) {
    return [];
  }

  const plansByOccurrence = new Map(
    expandPlansForDateRange(plans, sortedDates[0], sortedDates[sortedDates.length - 1])
      .map((plan) => [buildPlanOccurrenceKey(plan.id, plan.date), plan]),
  );
  const materialsById = new Map(materials.map((material) => [material.id, material]));
  const totals = new Map<string, AdminMaterialSummary>();

  actuals.forEach((actual) => {
    const plan = actual.planId
      ? plansByOccurrence.get(getActualOccurrenceKey(actual))
      : undefined;
    const materialId = actual.materialId?.trim() || plan?.materialId?.trim() || '';
    const material = materialId ? materialsById.get(materialId) : undefined;
    const label =
      actual.materialName?.trim() ||
      plan?.materialName?.trim() ||
      material?.name.trim() ||
      actual.title?.trim() ||
      plan?.title.trim() ||
      actual.subject.trim() ||
      '記録';
    const key = materialId || label;
    const current = totals.get(key) ?? { key, label, minutes: 0 };

    totals.set(key, {
      ...current,
      minutes: current.minutes + getActualMinutes(actual),
    });
  });

  return [...totals.values()]
    .sort((left, right) => right.minutes - left.minutes)
    .slice(0, limit);
}

export function summarizeByMaterialOrTitle(
  plans: Plan[],
  actuals: Actual[],
  materials: StudyMaterial[] = [],
  startDate: string,
  endDate: string,
  limit = 6,
): AdminMaterialSummary[] {
  return buildMaterialSummaries(
    plans,
    getActualsInRange(actuals, startDate, endDate),
    materials,
    limit,
  );
}

export function summarizePeriodReport({
  mode,
  selectedDate,
  plans,
  actuals,
  todos,
  dayNotes,
  materials = [],
}: {
  mode: AdminReportMode;
  selectedDate: string;
  plans: Plan[];
  actuals: Actual[];
  todos: TodoTask[];
  dayNotes: DayNote[];
  materials?: StudyMaterial[];
}): AdminPeriodReportSummary {
  const { startDate, endDate } = getAdminReportRange(mode, selectedDate);
  const periodPlans = sortByDateTime(expandPlansForDateRange(plans, startDate, endDate));
  const periodActuals = getActualsInRange(actuals, startDate, endDate);
  const periodDayNotes = dayNotes
    .filter((dayNote) => isDateInRange(dayNote.date, startDate, endDate))
    .sort((left, right) => left.date.localeCompare(right.date));
  const plannedMinutes = calculatePlannedMinutesInRange(plans, startDate, endDate);
  const actualMinutes = mode === 'day'
    ? calculateTodayStudyMinutes(selectedDate, plans, actuals)
    : summarizeByDate(plans, actuals, startDate, endDate).reduce(
        (sum, entry) => sum + entry.minutes,
        0,
      );

  return {
    mode,
    startDate,
    endDate,
    plannedMinutes,
    actualMinutes,
    differenceMinutes: actualMinutes - plannedMinutes,
    actualCount: periodActuals.length,
    plans: periodPlans,
    actuals: periodActuals,
    incompleteTodos: todos.filter(isIncompleteTodo),
    dayNotes: periodDayNotes,
    dailySummaries: summarizeByDate(plans, actuals, startDate, endDate),
    weeklySummaries: summarizeByWeek(plans, actuals, startDate, endDate),
    materialSummaries: summarizeByMaterialOrTitle(
      plans,
      actuals,
      materials,
      startDate,
      endDate,
    ),
  };
}

export function summarizeDayReport(
  input: Omit<Parameters<typeof summarizePeriodReport>[0], 'mode'>,
): AdminPeriodReportSummary {
  return summarizePeriodReport({ ...input, mode: 'day' });
}

export function summarizeWeekReport(
  input: Omit<Parameters<typeof summarizePeriodReport>[0], 'mode'>,
): AdminPeriodReportSummary {
  return summarizePeriodReport({ ...input, mode: 'week' });
}

export function summarizeMonthReport(
  input: Omit<Parameters<typeof summarizePeriodReport>[0], 'mode'>,
): AdminPeriodReportSummary {
  return summarizePeriodReport({ ...input, mode: 'month' });
}

export function filterAdminUserSummaries(
  users: AdminUserSummary[],
  query: string,
): AdminUserSummary[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return users;
  }

  return users.filter(({ profile }) => {
    const haystack = [
      profile.username,
      profile.email,
      profile.id,
    ].join('\n').toLowerCase();

    return haystack.includes(normalizedQuery);
  });
}
