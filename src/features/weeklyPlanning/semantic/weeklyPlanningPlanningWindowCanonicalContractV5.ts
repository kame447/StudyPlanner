import {
  CANONICAL_RELATIVE_DAY_EXPRESSIONS,
  CANONICAL_RELATIVE_WEEK_EXPRESSIONS,
} from './weeklyPlanningCalendarResolver';
import type { SemanticPlanningWindowV5 } from './weeklyPlanningSemanticDocumentV5';

export const WEEKLY_PLANNING_CANONICAL_WINDOW_CONTRACT_V5 =
  'weekly-planning-canonical-window-contract-v5' as const;

function includesValue(
  values: readonly string[],
  value: string,
): boolean {
  return values.includes(value);
}

export function planningWindowCanonicalValueErrors(
  window: SemanticPlanningWindowV5 | null,
): string[] {
  if (!window) return [];

  if (
    window.kind === 'relative_day'
    && !includesValue(CANONICAL_RELATIVE_DAY_EXPRESSIONS, window.value)
  ) {
    return [
      `document.planningWindow.value:canonical-relative-day:${window.value}`,
    ];
  }

  if (
    window.kind === 'relative_week'
    && !includesValue(CANONICAL_RELATIVE_WEEK_EXPRESSIONS, window.value)
  ) {
    return [
      `document.planningWindow.value:canonical-relative-week:${window.value}`,
    ];
  }

  return [];
}

export function canonicalPlanningWindowInstructionV5(): string {
  return [
    `Canonical relative_day values are: ${CANONICAL_RELATIVE_DAY_EXPRESSIONS.join(', ')}.`,
    `Canonical relative_week values are: ${CANONICAL_RELATIVE_WEEK_EXPRESSIONS.join(', ')}.`,
    'Map equivalent user expressions to these values. Never invent aliases such as next_day, following_day, current_week, or following_week.',
  ].join(' ');
}
