import type { RecurrenceFact } from './weeklyPlanningFactGraph';
import type {
  TaskDateRuleFact,
  WeeklyPlanningFactGraphV2,
} from './weeklyPlanningFactGraphV2';
import {
  calendarWeekday,
  intersectCalendarDates,
  listCalendarDatesInclusive,
  resolveCanonicalDateExpression,
} from './weeklyPlanningCalendarResolver';

export interface ResolvedTaskDateEligibility {
  taskId: string;
  allowedDates: string[] | null;
  excludedDates: string[];
  sourceFactIds: string[];
}

export type TaskDateRuleResolutionIssueCode =
  | 'orphan_task_date_rule'
  | 'invalid_task_date_rule_level'
  | 'unsupported_task_date_expression'
  | 'task_date_rule_outside_planning_window'
  | 'conflicting_task_date_rule'
  | 'orphan_task_recurrence'
  | 'invalid_task_recurrence_weekday';

export interface TaskDateRuleResolutionIssue {
  code: TaskDateRuleResolutionIssueCode;
  taskDateRuleFactId: string;
  taskId: string;
  blocking: boolean;
  details?: Record<string, string | number | boolean | null>;
}

export interface TaskDateRuleResolutionResult {
  eligibilities: ResolvedTaskDateEligibility[];
  issues: TaskDateRuleResolutionIssue[];
  readiness: 'ready' | 'needs_resolution' | 'empty';
}

interface MutableTaskDateEligibility {
  hasPositiveDateScope: boolean;
  allowedDates: Set<string>;
  excludedDates: Set<string>;
  sourceFactIds: Set<string>;
  explicitAllowedRuleByDate: Map<string, string>;
  excludedRuleByDate: Map<string, string>;
}

const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

function mutableState(
  mutable: Map<string, MutableTaskDateEligibility>,
  taskId: string,
): MutableTaskDateEligibility {
  const existing = mutable.get(taskId);
  if (existing) return existing;
  const created: MutableTaskDateEligibility = {
    hasPositiveDateScope: false,
    allowedDates: new Set<string>(),
    excludedDates: new Set<string>(),
    sourceFactIds: new Set<string>(),
    explicitAllowedRuleByDate: new Map<string, string>(),
    excludedRuleByDate: new Map<string, string>(),
  };
  mutable.set(taskId, created);
  return created;
}

function resolveRuleDates(params: {
  rule: TaskDateRuleFact;
  currentDate: string;
  planningStartDate: string;
  planningEndDate: string;
  issues: TaskDateRuleResolutionIssue[];
}): string[] | null {
  const resolution = resolveCanonicalDateExpression({
    expression: params.rule.dateExpression,
    currentDate: params.currentDate,
  });
  if (resolution.status !== 'resolved') {
    params.issues.push({
      code: 'unsupported_task_date_expression',
      taskDateRuleFactId: params.rule.id,
      taskId: params.rule.taskId,
      blocking: true,
      details: {
        expression: params.rule.dateExpression,
        resolutionStatus: resolution.status,
      },
    });
    return null;
  }

  const dates = listCalendarDatesInclusive(
    resolution.range.start,
    resolution.range.end,
  ) ?? [];
  const inWindow = intersectCalendarDates(
    dates,
    params.planningStartDate,
    params.planningEndDate,
  ) ?? [];
  if (dates.length > 0 && inWindow.length === 0) {
    params.issues.push({
      code: 'task_date_rule_outside_planning_window',
      taskDateRuleFactId: params.rule.id,
      taskId: params.rule.taskId,
      blocking: false,
      details: { expression: params.rule.dateExpression },
    });
  }
  return inWindow;
}

function resolveRecurrenceDates(params: {
  recurrence: RecurrenceFact;
  planningDates: string[];
  issues: TaskDateRuleResolutionIssue[];
}): string[] | null {
  if (params.recurrence.kind === 'daily') return [...params.planningDates];
  if (params.recurrence.kind === 'weekdays') {
    return params.planningDates.filter((date) => {
      const day = calendarWeekday(date);
      return day !== null && day >= 1 && day <= 5;
    });
  }
  if (params.recurrence.kind === 'weekends') {
    return params.planningDates.filter((date) => {
      const day = calendarWeekday(date);
      return day === 0 || day === 6;
    });
  }
  if (params.recurrence.kind === 'custom') return null;
  if (params.recurrence.days.length === 0) return null;

  const indexes = new Set<number>();
  let invalid = false;
  for (const day of params.recurrence.days) {
    const index = WEEKDAY_INDEX[day];
    if (index === undefined) {
      invalid = true;
      params.issues.push({
        code: 'invalid_task_recurrence_weekday',
        taskDateRuleFactId: params.recurrence.id,
        taskId: params.recurrence.taskId,
        blocking: true,
        details: { day },
      });
    } else {
      indexes.add(index);
    }
  }
  if (invalid || indexes.size === 0) return null;
  return params.planningDates.filter((date) => {
    const day = calendarWeekday(date);
    return day !== null && indexes.has(day);
  });
}

export function resolveWeeklyPlanningTaskDateRules(params: {
  graph: WeeklyPlanningFactGraphV2;
  currentDate: string;
  planningStartDate: string;
  planningEndDate: string;
}): TaskDateRuleResolutionResult {
  const issues: TaskDateRuleResolutionIssue[] = [];
  const taskIds = new Set(params.graph.tasks.map((task) => task.id));
  const planningDates = listCalendarDatesInclusive(
    params.planningStartDate,
    params.planningEndDate,
  ) ?? [];
  const mutable = new Map<string, MutableTaskDateEligibility>();

  for (const rule of params.graph.taskDateRules) {
    if (!taskIds.has(rule.taskId)) {
      issues.push({
        code: 'orphan_task_date_rule',
        taskDateRuleFactId: rule.id,
        taskId: rule.taskId,
        blocking: true,
      });
      continue;
    }
    if (rule.constraintLevel !== 'hard') {
      issues.push({
        code: 'invalid_task_date_rule_level',
        taskDateRuleFactId: rule.id,
        taskId: rule.taskId,
        blocking: true,
      });
      continue;
    }
    const dates = resolveRuleDates({
      rule,
      currentDate: params.currentDate,
      planningStartDate: params.planningStartDate,
      planningEndDate: params.planningEndDate,
      issues,
    });
    if (!dates) continue;

    const state = mutableState(mutable, rule.taskId);
    state.sourceFactIds.add(rule.id);
    if (rule.kind === 'allowed_date') {
      state.hasPositiveDateScope = true;
      for (const date of dates) {
        state.allowedDates.add(date);
        state.explicitAllowedRuleByDate.set(date, rule.id);
      }
    } else {
      for (const date of dates) {
        state.excludedDates.add(date);
        state.excludedRuleByDate.set(date, rule.id);
      }
    }
  }

  for (const recurrence of params.graph.recurrences) {
    if (!taskIds.has(recurrence.taskId)) {
      issues.push({
        code: 'orphan_task_recurrence',
        taskDateRuleFactId: recurrence.id,
        taskId: recurrence.taskId,
        blocking: true,
      });
      continue;
    }
    if (recurrence.targetFactId !== recurrence.taskId) continue;
    const dates = resolveRecurrenceDates({ recurrence, planningDates, issues });
    if (!dates) continue;

    const state = mutableState(mutable, recurrence.taskId);
    state.hasPositiveDateScope = true;
    state.sourceFactIds.add(recurrence.id);
    for (const date of dates) {
      state.allowedDates.add(date);
    }
  }

  const eligibilities: ResolvedTaskDateEligibility[] = [];
  for (const [taskId, state] of mutable.entries()) {
    for (const [date, allowedRuleId] of state.explicitAllowedRuleByDate.entries()) {
      if (!state.excludedDates.has(date)) continue;
      issues.push({
        code: 'conflicting_task_date_rule',
        taskDateRuleFactId: state.excludedRuleByDate.get(date) ?? allowedRuleId,
        taskId,
        blocking: true,
        details: { date },
      });
    }
    const allowedDates = state.hasPositiveDateScope
      ? [...state.allowedDates]
        .filter((date) => !state.excludedDates.has(date))
        .sort()
      : null;
    eligibilities.push({
      taskId,
      allowedDates,
      excludedDates: [...state.excludedDates].sort(),
      sourceFactIds: [...state.sourceFactIds].sort(),
    });
  }

  const blocking = issues.some((issue) => issue.blocking);
  return {
    eligibilities: eligibilities.sort((left, right) =>
      left.taskId.localeCompare(right.taskId)),
    issues,
    readiness: blocking
      ? 'needs_resolution'
      : eligibilities.length === 0
        ? 'empty'
        : 'ready',
  };
}

export function isTaskAllowedOnDate(
  eligibility: ResolvedTaskDateEligibility | undefined,
  date: string,
): boolean {
  if (!eligibility) return true;
  if (eligibility.excludedDates.includes(date)) return false;
  return eligibility.allowedDates === null || eligibility.allowedDates.includes(date);
}
