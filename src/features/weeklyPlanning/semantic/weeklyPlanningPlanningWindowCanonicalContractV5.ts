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

export interface PlanningWindowCanonicalNormalizationV5 {
  window: SemanticPlanningWindowV5 | null;
  repairs: string[];
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
  const matched = RELATIVE_WINDOW_SOURCE_EXPECTATIONS_V5
    .filter((expectation) =>
      expectation.phrases.some((phrase) => normalized.includes(phrase)))
    .map(({ kind, value }) => ({ kind, value }));
  const unique = new Map(
    matched.map((expectation) => [
      `${expectation.kind}:${expectation.value}`,
      expectation,
    ]),
  );
  return unique.size === 1 ? [...unique.values()][0] : null;
}

export function normalizePlanningWindowCanonicalV5(
  window: SemanticPlanningWindowV5 | null,
): PlanningWindowCanonicalNormalizationV5 {
  if (!window || (window.kind !== 'relative_day' && window.kind !== 'relative_week')) {
    return { window, repairs: [] };
  }

  const expected = relativeWindowSourceExpectationV5(window.sourceText);
  if (!expected || (window.kind === expected.kind && window.value === expected.value)) {
    return { window, repairs: [] };
  }

  return {
    window: {
      ...window,
      kind: expected.kind,
      value: expected.value,
      start: null,
      end: null,
    },
    repairs: [
      `planning-window-source-canonicalized:${window.localId}:${window.kind}:${window.value}->${expected.kind}:${expected.value}`,
    ],
  };
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
