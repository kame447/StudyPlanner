import { describe, expect, it } from 'vitest';
import { resolveWeeklyPlanningTraceFeatureEnabled } from './configureWeeklyPlanningTraceRepository';

describe('resolveWeeklyPlanningTraceFeatureEnabled', () => {
  it('enables the feature by default only in development', () => {
    expect(resolveWeeklyPlanningTraceFeatureEnabled(undefined, true)).toBe(true);
    expect(resolveWeeklyPlanningTraceFeatureEnabled(undefined, false)).toBe(false);
  });

  it('respects explicit enable and disable settings', () => {
    expect(resolveWeeklyPlanningTraceFeatureEnabled('true', false)).toBe(true);
    expect(resolveWeeklyPlanningTraceFeatureEnabled('false', true)).toBe(false);
  });
});
