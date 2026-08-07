import { describe, expect, it } from 'vitest';
import { shouldApplyWeeklyPlanningExistingEntityBindingsV5 } from './weeklyPlanningSemanticPipelineV5';

describe('Stable V5 contextual existing-entity binding policy', () => {
  it('applies exact-ID rebase to ordinary and semantic-uncertainty document turns', () => {
    expect(shouldApplyWeeklyPlanningExistingEntityBindingsV5({ contextualAnswer: false, questionCode: null })).toBe(true);
    expect(shouldApplyWeeklyPlanningExistingEntityBindingsV5({ contextualAnswer: true, questionCode: 'semantic_uncertainty' })).toBe(true);
  });

  it('keeps direct effort and quantity contextual paths out of document rebasing', () => {
    expect(shouldApplyWeeklyPlanningExistingEntityBindingsV5({ contextualAnswer: true, questionCode: 'missing_effort_estimate' })).toBe(false);
    expect(shouldApplyWeeklyPlanningExistingEntityBindingsV5({ contextualAnswer: true, questionCode: 'quantity_role_unresolved' })).toBe(false);
  });
});
