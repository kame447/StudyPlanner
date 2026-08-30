import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningTurnFailure } from '../weeklyPlanningTurnExecutionTypes';
import { isWeeklyPlanningStableV5SystemResult } from './weeklyPlanningStableV5TurnDialogue';

const failure: WeeklyPlanningTurnFailure = {
  code: 'stable_v5_provider_failure',
  userMessage: 'provider failed',
  traceCode: 'provider_failed',
  diagnostics: {
    attemptCount: 1,
    repairAttempted: false,
    validationErrorCategories: [],
    providerErrorCategory: 'provider_error',
  },
};

describe('Stable V5 system result classification', () => {
  it('classifies explicit system response source as system', () => {
    expect(isWeeklyPlanningStableV5SystemResult({ responseSource: 'system' })).toBe(true);
  });

  it('classifies an explicit failure as system even without a response source', () => {
    expect(isWeeklyPlanningStableV5SystemResult({ failure })).toBe(true);
  });

  it('does not classify non-system response sources as system', () => {
    expect(isWeeklyPlanningStableV5SystemResult({ responseSource: 'ai' })).toBe(false);
    expect(isWeeklyPlanningStableV5SystemResult({ responseSource: 'rules' })).toBe(false);
    expect(isWeeklyPlanningStableV5SystemResult({ responseSource: 'deterministic_fallback' })).toBe(false);
  });

  it('requires explicit machine state rather than presentation text', () => {
    expect(isWeeklyPlanningStableV5SystemResult({})).toBe(false);
  });
});
