import {
  CANONICAL_RELATIVE_DAY_EXPRESSIONS,
  CANONICAL_RELATIVE_WEEK_EXPRESSIONS,
  isCanonicalMonthDayExpression,
  isValidCalendarDate,
  resolveCanonicalMonthDayOnOrAfter,
} from './weeklyPlanningCalendarResolver';
import type { SemanticPlanningWindowV5 } from './weeklyPlanningSemanticDocumentV5';

/*
 * Semantic ownership boundary
 *
 * Relative dates are interpreted by the semantic AI. Deterministic code verifies
 * canonical values but never reads sourceText to choose a different meaning.
 *
 * For absolute windows, start/end carry the interpreted dates. Once those dates
 * are valid and ordered, value is only a derived wire representation and is
 * canonicalized deterministically as <start>/<end>.
 *
 * When the user states a month and day without a year, the AI writes that bound
 * as ISO 8601 month-day --MM-DD instead of choosing a year. Deterministic code
 * resolves it against calendarContext.currentDate to the next occurrence on or
 * after that date (an end bound on or after the resolved start), the same
 * calendar arithmetic used for canonical weekday expressions. Without a valid
 * reference date the bound stays unresolved and validation fails closed.
 */
export const WEEKLY_PLANNING_CANONICAL_WINDOW_CONTRACT_V5 =
  'weekly-planning-canonical-window-contract-v5' as const;

const MAX_ABSOLUTE_WINDOW_YEAR_DISTANCE = 10;

export interface PlanningWindowCanonicalNormalizationV5 {
  window: SemanticPlanningWindowV5 | null;
  repairs: string[];
}

export interface PlanningWindowCanonicalRawNormalizationV5 {
  rawResponse: string;
  repairs: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizePlanningWindowCanonicalV5(
  window: SemanticPlanningWindowV5 | null,
): PlanningWindowCanonicalNormalizationV5 {
  if (
    !window
    || window.kind !== 'absolute'
    || !window.start
    || !window.end
    || !isValidCalendarDate(window.start)
    || !isValidCalendarDate(window.end)
    || window.start > window.end
  ) {
    return { window, repairs: [] };
  }

  const canonicalValue = `${window.start}/${window.end}`;
  if (window.value === canonicalValue) {
    return { window, repairs: [] };
  }

  return {
    window: { ...window, value: canonicalValue },
    repairs: ['planning-window-value-canonicalized-from-validated-range'],
  };
}

function resolveMonthDayBoundsRaw(
  window: Record<string, unknown>,
  referenceDate: string | null,
): { window: Record<string, unknown>; repairs: string[] } {
  if (window.kind !== 'absolute' || !referenceDate || !isValidCalendarDate(referenceDate)) {
    return { window, repairs: [] };
  }
  const repairs: string[] = [];
  let { start, end } = window;
  if (typeof start === 'string' && isCanonicalMonthDayExpression(start)) {
    const resolved = resolveCanonicalMonthDayOnOrAfter(start, referenceDate);
    if (!resolved) return { window, repairs: [] };
    repairs.push(`planning-window-month-day-resolved:start:${resolved}`);
    start = resolved;
  }
  if (typeof end === 'string' && isCanonicalMonthDayExpression(end)) {
    const endNotBefore = typeof start === 'string' && isValidCalendarDate(start)
      ? start
      : referenceDate;
    const resolved = resolveCanonicalMonthDayOnOrAfter(end, endNotBefore);
    if (!resolved) return { window, repairs: [] };
    repairs.push(`planning-window-month-day-resolved:end:${resolved}`);
    end = resolved;
  }
  return repairs.length === 0
    ? { window, repairs }
    : { window: { ...window, start, end }, repairs };
}

export function normalizePlanningWindowCanonicalRawV5(
  rawResponse: string,
  referenceDate: string | null = null,
): PlanningWindowCanonicalRawNormalizationV5 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponse);
  } catch {
    return { rawResponse, repairs: [] };
  }
  if (!isRecord(parsed) || !isRecord(parsed.planningWindow)) {
    return { rawResponse, repairs: [] };
  }
  const monthDay = resolveMonthDayBoundsRaw(parsed.planningWindow, referenceDate);
  const window = monthDay.window;
  const unchanged = {
    rawResponse: monthDay.repairs.length === 0
      ? rawResponse
      : JSON.stringify({ ...parsed, planningWindow: window }),
    repairs: monthDay.repairs,
  };
  if (
    window.kind !== 'absolute'
    || typeof window.start !== 'string'
    || typeof window.end !== 'string'
    || !isValidCalendarDate(window.start)
    || !isValidCalendarDate(window.end)
    || window.start > window.end
  ) {
    return unchanged;
  }

  const canonicalValue = `${window.start}/${window.end}`;
  if (window.value === canonicalValue) {
    return unchanged;
  }
  return {
    rawResponse: JSON.stringify({
      ...parsed,
      planningWindow: { ...window, value: canonicalValue },
    }),
    repairs: [
      ...monthDay.repairs,
      'planning-window-value-canonicalized-from-validated-range',
    ],
  };
}

export function planningWindowCanonicalValueErrors(
  window: SemanticPlanningWindowV5 | null,
  referenceDate: string | null = null,
): string[] {
  if (!window) return [];

  if (window.kind === 'absolute') {
    if (
      !window.start
      || !window.end
      || !isValidCalendarDate(window.start)
      || !isValidCalendarDate(window.end)
    ) {
      return ['document.planningWindow:absolute-iso-range-required'];
    }
    if (window.start > window.end) {
      return ['document.planningWindow:absolute-range-order'];
    }
    const canonicalValue = `${window.start}/${window.end}`;
    if (window.value !== canonicalValue) {
      return [
        `document.planningWindow.value:absolute-canonical-range:${canonicalValue}`,
      ];
    }
    if (referenceDate && isValidCalendarDate(referenceDate)) {
      const referenceYear = Number(referenceDate.slice(0, 4));
      const startYear = Number(window.start.slice(0, 4));
      const endYear = Number(window.end.slice(0, 4));
      if (
        Math.abs(startYear - referenceYear) > MAX_ABSOLUTE_WINDOW_YEAR_DISTANCE
        || Math.abs(endYear - referenceYear) > MAX_ABSOLUTE_WINDOW_YEAR_DISTANCE
      ) {
        return ['document.planningWindow:absolute-year-outside-reference-horizon'];
      }
    }
    return [];
  }

  if (
    window.kind === 'relative_day'
    && !(CANONICAL_RELATIVE_DAY_EXPRESSIONS as readonly string[]).includes(window.value)
  ) {
    return [`document.planningWindow.value:canonical-relative-day:${window.value}`];
  }
  if (
    window.kind === 'relative_week'
    && !(CANONICAL_RELATIVE_WEEK_EXPRESSIONS as readonly string[]).includes(window.value)
  ) {
    return [`document.planningWindow.value:canonical-relative-week:${window.value}`];
  }
  return [];
}
