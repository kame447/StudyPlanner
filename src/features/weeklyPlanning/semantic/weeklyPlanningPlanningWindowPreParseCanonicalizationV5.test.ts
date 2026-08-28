import { describe, expect, it } from 'vitest';
import { normalizePlanningWindowCanonicalRawV5 } from './weeklyPlanningPlanningWindowCanonicalContractV5';

function response(value: string, start = '2026-08-28', end = '2026-09-30'): string {
  return JSON.stringify({
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'create_plan',
    planningWindow: {
      localId: 'window-1',
      kind: 'absolute',
      value,
      start,
      end,
      sourceText: '今日から9月30日まで',
    },
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  });
}

describe('Stable V5 planning-window pre-parse canonicalization', () => {
  it('fills a derived absolute value from already interpreted valid start/end dates', () => {
    const result = normalizePlanningWindowCanonicalRawV5(response(''));
    const parsed = JSON.parse(result.rawResponse) as {
      planningWindow: { value: string };
    };
    expect(parsed.planningWindow.value).toBe('2026-08-28/2026-09-30');
    expect(result.repairs).toEqual([
      'planning-window-value-canonicalized-from-validated-range',
    ]);
  });

  it('does not repair invalid or reversed absolute date ranges', () => {
    const reversed = response('', '2026-09-30', '2026-08-28');
    expect(normalizePlanningWindowCanonicalRawV5(reversed)).toEqual({
      rawResponse: reversed,
      repairs: [],
    });
  });
});
