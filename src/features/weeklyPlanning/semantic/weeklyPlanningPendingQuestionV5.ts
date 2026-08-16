import {
  isWeeklyPlanningEffortMeasurementV5,
  type WeeklyPlanningEffortMeasurementV5,
} from './weeklyPlanningEffortQuestionPolicyV5';

export type { WeeklyPlanningEffortMeasurementV5 } from './weeklyPlanningEffortQuestionPolicyV5';

export interface WeeklyPlanningPendingQuestionV5 {
  actionId: string | null;
  questionCode: string;
  targetFactId: string | null;
  graphRevision: number;
  effortMeasurement?: WeeklyPlanningEffortMeasurementV5 | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readWeeklyPlanningPendingQuestionV5(
  publicStateSummary?: Record<string, unknown>,
): WeeklyPlanningPendingQuestionV5 | null {
  const value = publicStateSummary?.pendingQuestion;
  if (!isRecord(value)) return null;
  const effortMeasurement = value.effortMeasurement ?? null;
  if (
    (value.actionId !== null && typeof value.actionId !== 'string')
    || typeof value.questionCode !== 'string'
    || !value.questionCode.trim()
    || (value.targetFactId !== null && typeof value.targetFactId !== 'string')
    || !Number.isInteger(value.graphRevision)
    || Number(value.graphRevision) < 0
    || !(effortMeasurement === null || isWeeklyPlanningEffortMeasurementV5(effortMeasurement))
  ) {
    return null;
  }
  return {
    actionId: value.actionId,
    questionCode: value.questionCode,
    targetFactId: value.targetFactId,
    graphRevision: Number(value.graphRevision),
    effortMeasurement,
  };
}

export function isWeeklyPlanningContextualQuestionCodeV5(
  code: string,
): code is 'missing_effort_estimate' | 'quantity_role_unresolved' {
  return code === 'missing_effort_estimate' || code === 'quantity_role_unresolved';
}
