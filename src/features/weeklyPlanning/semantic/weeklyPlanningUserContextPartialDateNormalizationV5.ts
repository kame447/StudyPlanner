import {
  canonicalizeUserPlanningContextPartialDateV1,
} from '../../userPlanningContext/userPlanningContextDateExpression';

interface RawNormalizationResult {
  rawResponse: string;
  repairs: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function resolveWeeklyPlanningUserContextPartialDateV5(
  expression: string,
): { start: string; end: string } | null {
  const canonical = canonicalizeUserPlanningContextPartialDateV1(expression);
  if (!canonical) return null;
  const [start, end] = canonical.split('/');
  return start && end ? { start, end } : null;
}

export function normalizeWeeklyPlanningUserContextPartialDatesV5(
  rawResponse: string,
): RawNormalizationResult {
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
  const userContextFacts = parsed.userContextFacts.map((fact, index) => {
    if (
      !isRecord(fact)
      || fact.kind !== 'goal_event'
      || typeof fact.dateExpression !== 'string'
    ) {
      return fact;
    }

    const canonical = canonicalizeUserPlanningContextPartialDateV1(fact.dateExpression);
    if (!canonical || canonical === fact.dateExpression) return fact;

    repairs.push(`user-context-partial-date-canonicalized:${index}:${canonical}`);
    return {
      ...fact,
      dateExpression: canonical,
    };
  });

  if (repairs.length === 0) return { rawResponse, repairs };
  return {
    rawResponse: JSON.stringify({ ...parsed, userContextFacts }),
    repairs,
  };
}
