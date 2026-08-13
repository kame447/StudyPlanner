import {
  CANONICAL_RELATIVE_DAY_EXPRESSIONS,
  CANONICAL_RELATIVE_WEEK_EXPRESSIONS,
  isValidCalendarDate,
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
 */
export const WEEKLY_PLANNING_CANONICAL_WINDOW_CONTRACT_V5 =
  'weekly-planning-canonical-window-contract-v5' as const;

export interface PlanningWindowCanonicalNormalizationV5 {
  window: SemanticPlanningWindowV5 | null;
  repairs: string[];
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

export function planningWindowCanonicalValueErrors(
  window: SemanticPlanningWindowV5 | null,
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
