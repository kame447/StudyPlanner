import { describe, expect, it } from 'vitest';
import {
  CANONICAL_RELATIVE_DAY_EXPRESSIONS,
  CANONICAL_RELATIVE_WEEK_EXPRESSIONS,
  resolveCanonicalDateExpression,
} from './weeklyPlanningCalendarResolver';
import {
  normalizePlanningWindowCanonicalV5,
  planningWindowCanonicalValueErrors,
  relativeWindowSourceExpectationV5,
} from './weeklyPlanningPlanningWindowCanonicalContractV5';

describe('Stable V5 planning window validation boundary', () => {
  it('keeps the canonical runtime vocabulary resolvable', () => {
    for (const expression of [
      ...CANONICAL_RELATIVE_DAY_EXPRESSIONS,
      ...CANONICAL_RELATIVE_WEEK_EXPRESSIONS,
    ]) {
      expect(resolveCanonicalDateExpression({
        expression,
        currentDate: '2026-08-03',
      }).status).toBe('resolved');
    }
  });

  it.each(['次の日', '翌日', '明日', '翌週', '来週', '今週'])
    ('does not infer a canonical value from sourceText: %s', (sourceText) => {
      expect(relativeWindowSourceExpectationV5(sourceText)).toBeNull();
    });

  it('does not overwrite an AI-selected relative value from conflicting sourceText', () => {
    const window = {
      localId: 'planning-window-1',
      kind: 'relative_day' as const,
      value: 'today',
      start: null,
      end: null,
      sourceText: '明日',
    };
    expect(normalizePlanningWindowCanonicalV5(window)).toEqual({
      window,
      repairs: [],
    });
  });

  it('rejects non-canonical values without choosing a replacement meaning', () => {
    expect(planningWindowCanonicalValueErrors({
      localId: 'planning-window-1',
      kind: 'relative_day',
      value: 'next_day',
      start: null,
      end: null,
      sourceText: '次の日',
    })).toEqual([
      'document.planningWindow.value:canonical-relative-day:next_day',
    ]);
  });
});
