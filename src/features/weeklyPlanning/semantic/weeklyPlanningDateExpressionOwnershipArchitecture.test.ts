import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('weekly planning scheduler date-expression ownership', () => {
  it('keeps raw canonical date resolution out of scheduler fact consumers', () => {
    const central = source('./weeklyPlanningResolvedDateExpressionsV5.ts');
    const consumers = [
      './weeklyPlanningResolvedTemporalConstraintsV5.ts',
      './weeklyPlanningTaskDateRuleResolver.ts',
      './weeklyPlanningTaskCommitmentResolver.ts',
      './weeklyPlanningAvailabilityResolver.ts',
      './weeklyPlanningGenericSchedulerInput.ts',
    ].map(source);

    expect(central).toContain('resolveCanonicalDateExpression');
    for (const consumer of consumers) {
      expect(consumer).not.toContain('resolveCanonicalDateExpression');
    }
  });

  it('creates one active-graph snapshot and reuses it for baseline and calibration compilation', () => {
    const planningEvaluation = source('../application/weeklyPlanningStableV5PlanningEvaluation.ts');

    expect(planningEvaluation).toContain(
      'const resolvedDateExpressions = resolveWeeklyPlanningDateExpressionsV5',
    );
    expect(planningEvaluation).toContain('graph: activeGraph');
    expect(planningEvaluation).toContain('resolvedDateExpressions,\n    resolvedTemporalConstraints,');
    expect(planningEvaluation).toContain('resolvedDateExpressions,\n        resolvedTemporalConstraints,');
  });

  it('keeps planning-window horizon grounding as an explicit separate responsibility', () => {
    const temporalContext = source('../application/weeklyPlanningTemporalContext.ts');

    expect(temporalContext).toContain('resolveCanonicalDateExpression');
    expect(temporalContext).toContain('expression: window.value.trim()');
  });
});
