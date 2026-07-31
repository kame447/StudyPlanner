export interface WeeklyPlanningPendingQuestionV5 {
  actionId: string | null;
  questionCode: string;
  targetFactId: string | null;
  graphRevision: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  ) {
    return null;
  }
  return {
    actionId: value.actionId,
    questionCode: value.questionCode,
    targetFactId: value.targetFactId,
    graphRevision: Number(value.graphRevision),
  };
}

export function isWeeklyPlanningContextualQuestionCodeV5(
  code: string,
): code is 'missing_effort_estimate' | 'quantity_role_unresolved' {
  return code === 'missing_effort_estimate' || code === 'quantity_role_unresolved';
}
