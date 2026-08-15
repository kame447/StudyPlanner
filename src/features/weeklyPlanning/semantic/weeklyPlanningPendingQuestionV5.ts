export type WeeklyPlanningEffortMeasurementV5 =
  | 'total_duration'
  | 'duration_per_unit'
  | 'session_duration';

export interface WeeklyPlanningPendingQuestionV5 {
  actionId: string | null;
  questionCode: string;
  targetFactId: string | null;
  graphRevision: number;
  effortMeasurement: WeeklyPlanningEffortMeasurementV5 | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEffortMeasurement(value: unknown): value is WeeklyPlanningEffortMeasurementV5 {
  return value === 'total_duration'
    || value === 'duration_per_unit'
    || value === 'session_duration';
}

export function readWeeklyPlanningPendingQuestionV5(
  publicStateSummary?: Record<string, unknown>,
): WeeklyPlanningPendingQuestionV5 | null {
  const value = publicStateSummary?.pendingQuestion;
  if (!isRecord(value)) return null;
  if (
    (value.actionId !== null && typeof value.actionId !== 'string')
    || typeof value.questionCode !== 'string'
    || !value.questionCode.trim()
    || (value.targetFactId !== null && typeof value.targetFactId !== 'string')
    || !Number.isInteger(value.graphRevision)
    || Number(value.graphRevision) < 0
    || !(value.effortMeasurement === null || isEffortMeasurement(value.effortMeasurement))
  ) {
    return null;
  }
  return {
    actionId: value.actionId,
    questionCode: value.questionCode,
    targetFactId: value.targetFactId,
    graphRevision: Number(value.graphRevision),
    effortMeasurement: value.effortMeasurement,
  };
}

export function isWeeklyPlanningContextualQuestionCodeV5(
  code: string,
): code is 'missing_effort_estimate' | 'quantity_role_unresolved' {
  return code === 'missing_effort_estimate' || code === 'quantity_role_unresolved';
}
