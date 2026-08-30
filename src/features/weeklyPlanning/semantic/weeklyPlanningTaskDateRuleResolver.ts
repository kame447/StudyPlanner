import type { RecurrenceFact } from './weeklyPlanningFactGraph';
import type { TaskDateRuleFact } from './weeklyPlanningFactGraphV2';
import {
  intersectCalendarDates,
  listCalendarDatesInclusive,
  type CalendarWeekStartsOn,
} from './weeklyPlanningCalendarResolver';
import {
  resolveWeeklyPlanningCalendarRecurrenceDatesV5,
} from './weeklyPlanningRecurrenceCalendarV5';
import {
  resolvedWeeklyPlanningDateExpressionForFactV5,
  type WeeklyPlanningResolvedDateExpressionsV5,
} from './weeklyPlanningResolvedDateExpressionsV5';

export interface WeeklyPlanningTaskDateRuleGraphView {
  readonly tasks: ReadonlyArray<{ id: string }>;
  readonly taskDateRules: ReadonlyArray<TaskDateRuleFact>;
  readonly recurrences: ReadonlyArray<RecurrenceFact>;
}

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
  planningStartDate: string;
  planningEndDate: string;
  resolvedDateExpressions: WeeklyPlanningResolvedDateExpressionsV5;
  issues: TaskDateRuleResolutionIssue[];
}): string[] | null {
  const resolution = resolvedWeeklyPlanningDateExpressionForFactV5({
    resolved: params.resolvedDateExpressions,
    factId: params.rule.id,
  });
  if (!resolution || resolution.status !== 'resolved' || !resolution.range) {
    params.issues.push({
      code: 'unsupported_task_date_expression',
      taskDateRuleFactId: params.rule.id,
      taskId: params.rule.taskId,
      blocking: true,
      details: {
        expression: params.rule.dateExpression,
        resolutionStatus: resolution?.status ?? 'missing_resolved_snapshot',
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
  const resolution = resolveWeeklyPlanningCalendarRecurrenceDatesV5({
    kind: params.recurrence.kind,
    days: params.recurrence.days,
    dates: params.planningDates,
  });
  for (const day of resolution.invalidDays) {
    params.issues.push({
      code: 'invalid_task_recurrence_weekday',
      taskDateRuleFactId: params.recurrence.id,
      taskId: params.recurrence.taskId,
      blocking: true,
      details: { day },
    });
  }
  if (resolution.invalidDays.length > 0) return null;
  return resolution.calendarDates;
}

export function resolveWeeklyPlanningTaskDateRules(params: {
  graph: WeeklyPlanningTaskDateRuleGraphView;
  currentDate: string;
  weekStartsOn?: CalendarWeekStartsOn;
  planningStartDate: string;
  planningEndDate: string;
  resolvedDateExpressions: WeeklyPlanningResolvedDateExpressionsV5;
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
      planningStartDate: params.planningStartDate,
      planningEndDate: params.planningEndDate,
      resolvedDateExpressions: params.resolvedDateExpressions,
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
    for (const date of dates) state.allowedDates.add(date);
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
