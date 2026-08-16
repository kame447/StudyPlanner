import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5,
} from './weeklyPlanningSemanticMeaningPolicyV5';

function meaningRuleIds(): string[] {
  return WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5.map((rule) => rule.id);
}

describe('Stable V5 semantic meaning policy', () => {
  it('keeps standard unit selection as an explicit semantic contract', () => {
    expect(meaningRuleIds()).toContain('workload_unit_code');
  });

  it('keeps contextual target resolution as an explicit semantic contract', () => {
    expect(meaningRuleIds()).toContain('contextual_reference_binding');
  });

  it('keeps independent clause meaning as an explicit semantic contract', () => {
    expect(meaningRuleIds()).toContain('independent_clause_decision_correction');
  });
});
