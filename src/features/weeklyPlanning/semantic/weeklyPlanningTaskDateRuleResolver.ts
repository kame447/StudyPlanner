import type {
  TaskDateRuleFact,
  WeeklyPlanningFactGraphV2,
} from './weeklyPlanningFactGraphV2';
import {
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
  | 'conflicting_task_date_rule';

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

export function resolveWeeklyPlanningTaskDateRules(params: {
  graph: WeeklyPlanningFactGraphV2;
  currentDate: string;
  planningStartDate: string;
  planningEndDate: string;
}): TaskDateRuleResolutionResult {
  const issues: TaskDateRuleResolutionIssue[] = [];
  const taskIds = new Set(params.graph.tasks.map((task) => task.id));
  const mutable = new Map<string, {
    hasAllowedRule: boolean;
    allowedDates: Set<string>;
    excludedDates: Set<string>;
    sourceFactIds: Set<string>;
    allowedRuleByDate: Map<string, string>;
    excludedRuleByDate: Map<string, string>;
  }>();

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

    const state = mutable.get(rule.taskId) ?? {
      hasAllowedRule: false,
      allowedDates: new Set<string>(),
      excludedDates: new Set<string>(),
      sourceFactIds: new Set<string>(),
      allowedRuleByDate: new Map<string, string>(),
      excludedRuleByDate: new Map<string, string>(),
    };
    state.sourceFactIds.add(rule.id);
    if (rule.kind === 'allowed_date') {
      state.hasAllowedRule = true;
      for (const date of dates) {
        state.allowedDates.add(date);
        state.allowedRuleByDate.set(date, rule.id);
      }
    } else {
      for (const date of dates) {
        state.excludedDates.add(date);
        state.excludedRuleByDate.set(date, rule.id);
      }
    }
    mutable.set(rule.taskId, state);
  }

  const eligibilities: ResolvedTaskDateEligibility[] = [];
  for (const [taskId, state] of mutable.entries()) {
    for (const date of state.allowedDates) {
      if (!state.excludedDates.has(date)) continue;
      issues.push({
        code: 'conflicting_task_date_rule',
        taskDateRuleFactId: state.excludedRuleByDate.get(date)
          ?? state.allowedRuleByDate.get(date)
          ?? 'unknown',
        taskId,
        blocking: true,
        details: { date },
      });
    }
    const allowedDates = state.hasAllowedRule
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
