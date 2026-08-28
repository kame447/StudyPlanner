import { describe, expect, it } from 'vitest';
import { shouldApplyWeeklyPlanningExistingEntityBindingsV5 } from './weeklyPlanningSemanticPipelineV5';

describe('Stable V5 contextual existing-entity binding policy', () => {
  it('applies exact-ID rebase to ordinary and resolved semantic-uncertainty document turns', () => {
    expect(shouldApplyWeeklyPlanningExistingEntityBindingsV5({
      contextualAnswer: false,
      questionCode: null,
      localReferenceCount: 0,
    })).toBe(true);
    expect(shouldApplyWeeklyPlanningExistingEntityBindingsV5({
      contextualAnswer: true,
      questionCode: 'semantic_uncertainty',
      localReferenceCount: 1,
    })).toBe(true);
  });

  it('does not rebase an unresolved semantic-uncertainty contextual no-op', () => {
    expect(shouldApplyWeeklyPlanningExistingEntityBindingsV5({
      contextualAnswer: true,
      questionCode: 'semantic_uncertainty',
      localReferenceCount: 0,
    })).toBe(false);
  });

  it('keeps direct effort and quantity contextual paths out of document rebasing', () => {
    expect(shouldApplyWeeklyPlanningExistingEntityBindingsV5({
      contextualAnswer: true,
      questionCode: 'missing_effort_estimate',
      localReferenceCount: 1,
    })).toBe(false);
    expect(shouldApplyWeeklyPlanningExistingEntityBindingsV5({
      contextualAnswer: true,
      questionCode: 'quantity_role_unresolved',
      localReferenceCount: 1,
    })).toBe(false);
  });
});
