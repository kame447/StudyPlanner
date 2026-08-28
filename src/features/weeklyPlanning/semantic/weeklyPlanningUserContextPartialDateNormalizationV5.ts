interface RawNormalizationResult {
  rawResponse: string;
  repairs: string[];
}

interface CalendarDateRange {
  start: string;
  end: string;
}

type MonthPart = 'early' | 'mid' | 'late';

const STRUCTURED_PARTIAL_DATE_EXPRESSION_PATTERN =
  /^year:(\d{4});month:(\d{2})(?:;part:(early|mid|late))?$/;
const COMPACT_PARTIAL_DATE_EXPRESSION_PATTERN =
  /^(\d{4})-(\d{2})(?:-(early|mid|late))?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function daysInMonth(year: number, month: number): number | null {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (month === 2) {
    const leap = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parsePartialDateExpression(
  expression: string,
): { year: number; month: number; part?: MonthPart } | null {
  const unwrapped = expression.startsWith('custom:')
    ? expression.slice('custom:'.length)
    : expression;
  const structured = STRUCTURED_PARTIAL_DATE_EXPRESSION_PATTERN.exec(unwrapped);
  const compact = structured ? null : COMPACT_PARTIAL_DATE_EXPRESSION_PATTERN.exec(unwrapped);
  const match = structured ?? compact;
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    part: match[3] as MonthPart | undefined,
  };
}

export function resolveWeeklyPlanningUserContextPartialDateV5(
  expression: string,
): CalendarDateRange | null {
  const parsed = parsePartialDateExpression(expression);
  if (!parsed) return null;

  const lastDay = daysInMonth(parsed.year, parsed.month);
  if (lastDay === null) return null;

  const prefix = `${String(parsed.year).padStart(4, '0')}-${pad2(parsed.month)}`;
  if (!parsed.part) {
    return { start: `${prefix}-01`, end: `${prefix}-${pad2(lastDay)}` };
  }
  if (parsed.part === 'early') {
    return { start: `${prefix}-01`, end: `${prefix}-10` };
  }
  if (parsed.part === 'mid') {
    return { start: `${prefix}-11`, end: `${prefix}-20` };
  }
  return { start: `${prefix}-21`, end: `${prefix}-${pad2(lastDay)}` };
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

    const range = resolveWeeklyPlanningUserContextPartialDateV5(fact.dateExpression);
    if (!range) return fact;

    const canonical = `${range.start}/${range.end}`;
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
