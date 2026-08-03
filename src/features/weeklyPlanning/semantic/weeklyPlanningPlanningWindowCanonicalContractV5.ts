import {
  CANONICAL_RELATIVE_DAY_EXPRESSIONS,
  CANONICAL_RELATIVE_WEEK_EXPRESSIONS,
} from './weeklyPlanningCalendarResolver';
import type { SemanticPlanningWindowV5 } from './weeklyPlanningSemanticDocumentV5';

/*
 * Semantic ownership boundary
 *
 * Relative dates in sourceText are interpreted by the semantic AI. Deterministic
 * code may verify that the returned kind/value belongs to the canonical enum,
 * but must not read Japanese phrases and overwrite the AI-selected value.
 *
 * Canonical rationale:
 * - docs/ai/tasks/20260803-weekly-planning-ai-semantic-ownership-reset.md
 * - docs/ai/design/20260803-weekly-planning-semantic-ownership-phase2-design.md
 */
export const WEEKLY_PLANNING_CANONICAL_WINDOW_CONTRACT_V5 =
  'weekly-planning-canonical-window-contract-v5' as const;

export interface PlanningWindowCanonicalNormalizationV5 {
  window: SemanticPlanningWindowV5 | null;
  repairs: string[];
}

export function relativeWindowSourceExpectationV5(
  _sourceText: string,
): null {
  return null;
}

export function normalizePlanningWindowCanonicalV5(
  window: SemanticPlanningWindowV5 | null,
): PlanningWindowCanonicalNormalizationV5 {
  return { window, repairs: [] };
}

export function planningWindowCanonicalValueErrors(
  window: SemanticPlanningWindowV5 | null,
): string[] {
  if (!window) return [];
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
