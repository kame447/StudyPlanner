import {
  CANONICAL_RELATIVE_DAY_EXPRESSIONS,
  CANONICAL_RELATIVE_WEEK_EXPRESSIONS,
} from './weeklyPlanningCalendarResolver';
import type { SemanticPlanningWindowV5 } from './weeklyPlanningSemanticDocumentV5';

export const WEEKLY_PLANNING_CANONICAL_WINDOW_CONTRACT_V5 =
  'weekly-planning-canonical-window-contract-v5' as const;

interface RelativeWindowSourceExpectationV5 {
  phrases: readonly string[];
  kind: 'relative_day' | 'relative_week';
  value: 'today' | 'tomorrow' | 'day_after_tomorrow' | 'this_week' | 'next_week';
}

const RELATIVE_WINDOW_SOURCE_EXPECTATIONS_V5: readonly RelativeWindowSourceExpectationV5[] = [
  {
    phrases: ['次の次の日', '翌々日', '明後日'],
    kind: 'relative_day',
    value: 'day_after_tomorrow',
  },
  {
    phrases: ['次の日', '翌日', '明日'],
    kind: 'relative_day',
    value: 'tomorrow',
  },
  {
    phrases: ['本日', '今日'],
    kind: 'relative_day',
    value: 'today',
  },
  {
    phrases: ['次の週', '次週', '翌週', '来週'],
    kind: 'relative_week',
    value: 'next_week',
  },
  {
    phrases: ['この週', '今週'],
    kind: 'relative_week',
    value: 'this_week',
  },
];

function includesValue(
  values: readonly string[],
  value: string,
): boolean {
  return values.includes(value);
}

function normalizeSourceText(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, '');
}

export function relativeWindowSourceExpectationV5(
  sourceText: string,
): Omit<RelativeWindowSourceExpectationV5, 'phrases'> | null {
  const normalized = normalizeSourceText(sourceText);
  const matched = RELATIVE_WINDOW_SOURCE_EXPECTATIONS_V5.find((expectation) =>
    expectation.phrases.some((phrase) => normalized.includes(phrase)));
  return matched ? { kind: matched.kind, value: matched.value } : null;
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

  const isRelativeWindow =
    window.kind === 'relative_day' || window.kind === 'relative_week';
  const sourceExpectation = relativeWindowSourceExpectationV5(window.sourceText);
  if (
    isRelativeWindow
    && sourceExpectation
    && (
      window.kind !== sourceExpectation.kind
      || window.value !== sourceExpectation.value
    )
  ) {
    return [
      `document.planningWindow:source-meaning-mismatch:expected-${sourceExpectation.kind}:${sourceExpectation.value}`,
    ];
  }

  return [];
}

export function canonicalPlanningWindowInstructionV5(): string {
  return [
    `Canonical relative_day values are: ${CANONICAL_RELATIVE_DAY_EXPRESSIONS.join(', ')}.`,
    `Canonical relative_week values are: ${CANONICAL_RELATIVE_WEEK_EXPRESSIONS.join(', ')}.`,
    'Map equivalent user expressions to these values. 次の日, 翌日, and 明日 mean tomorrow; 次の次の日, 翌々日, and 明後日 mean day_after_tomorrow; 次の週, 次週, 翌週, and 来週 mean next_week.',
    'Never invent aliases such as next_day, following_day, current_week, or following_week, and never replace a source expression with a different valid canonical meaning.',
  ].join(' ');
}
