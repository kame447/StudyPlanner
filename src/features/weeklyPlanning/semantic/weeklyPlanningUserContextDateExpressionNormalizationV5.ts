import { isCanonicalDateExpressionSyntax } from './weeklyPlanningCalendarResolver';

export interface WeeklyPlanningUserContextDateExpressionNormalizationResultV5 {
  rawResponse: string;
  repairs: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Durable goal events may be stated at month / period precision rather than as
 * one exact calendar day. Preserve the provider's already-interpreted symbolic
 * value under the canonical custom: namespace instead of inventing a day.
 */
export function normalizeWeeklyPlanningUserContextDateExpressionsV5(
  rawResponse: string,
): WeeklyPlanningUserContextDateExpressionNormalizationResultV5 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponse);
  } catch {
    return { rawResponse, repairs: [] };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.userContextFacts)) {
    return { rawResponse, repairs: [] };
  }

  const repairs: string[] = [];
  parsed.userContextFacts.forEach((fact, index) => {
    if (
      !isRecord(fact)
      || fact.kind !== 'goal_event'
      || typeof fact.dateExpression !== 'string'
    ) return;
    const expression = fact.dateExpression.trim();
    if (!expression || isCanonicalDateExpressionSyntax(expression)) return;
    fact.dateExpression = `custom:${expression}`;
    repairs.push(`user-context-date-symbolic-normalized:${index}`);
  });

  return repairs.length > 0
    ? { rawResponse: JSON.stringify(parsed), repairs }
    : { rawResponse, repairs: [] };
}
