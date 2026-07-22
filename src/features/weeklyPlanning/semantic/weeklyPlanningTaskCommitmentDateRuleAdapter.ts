import type { WeeklyPlanningFactGraphV2 } from './weeklyPlanningFactGraphV2';
import {
  resolveWeeklyPlanningTaskCommitments,
  type TaskCommitmentResolutionContext,
  type TaskCommitmentResolutionResult,
} from './weeklyPlanningTaskCommitmentResolver';
import {
  isTaskAllowedOnDate,
  resolveWeeklyPlanningTaskDateRules,
  type TaskDateRuleResolutionResult,
} from './weeklyPlanningTaskDateRuleResolver';

export interface TaskCommitmentWithDateRulesResult {
  commitments: TaskCommitmentResolutionResult;
  dateRules: TaskDateRuleResolutionResult;
}

export function resolveWeeklyPlanningTaskCommitmentsWithDateRules(params: {
  graph: WeeklyPlanningFactGraphV2;
  context: TaskCommitmentResolutionContext;
}): TaskCommitmentWithDateRulesResult {
  const dateRules = resolveWeeklyPlanningTaskDateRules({
    graph: params.graph,
    currentDate: params.context.currentDate,
    planningStartDate: params.context.planningStartDate,
    planningEndDate: params.context.planningEndDate,
  });
  const base = resolveWeeklyPlanningTaskCommitments(params);
  const eligibilityByTaskId = new Map(
    dateRules.eligibilities.map((eligibility) => [eligibility.taskId, eligibility]),
  );
  const reservations = base.reservations.filter((reservation) =>
    isTaskAllowedOnDate(
      eligibilityByTaskId.get(reservation.taskId),
      reservation.start.date,
    ));
  const dateRuleBlocking = dateRules.issues.some((issue) => issue.blocking);
  const commitmentBlocking = base.issues.some((issue) => issue.blocking);
  const blocking = dateRuleBlocking || commitmentBlocking;

  return {
    dateRules,
    commitments: {
      reservations,
      issues: base.issues,
      readiness: blocking
        ? 'needs_resolution'
        : reservations.length === 0
          ? 'empty'
          : 'ready',
    },
  };
}
