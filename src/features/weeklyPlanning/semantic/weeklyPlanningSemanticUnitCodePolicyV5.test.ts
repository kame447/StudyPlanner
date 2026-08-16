import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5,
} from './weeklyPlanningSemanticMeaningPolicyV5';

function meaningRuleIds(): string[] {
  return WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5.map((rule) => rule.id);
}

function meaningRuleInstruction(id: string): string {
  return WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5.find(
    (rule) => rule.id === id,
  )?.instruction ?? '';
}

describe('Stable V5 semantic meaning policy', () => {
  it('keeps standard unit selection as an explicit semantic contract', () => {
    expect(meaningRuleIds()).toContain('workload_unit_code');
  });

  it('keeps contextual target resolution as an explicit semantic contract', () => {
    expect(meaningRuleIds()).toContain('contextual_reference_binding');
  });

  it('keeps independent clause meaning and complete correction replacement as an explicit semantic contract', () => {
    expect(meaningRuleIds()).toContain('independent_clause_decision_correction');
    const instruction = meaningRuleInstruction('independent_clause_decision_correction');
    expect(instruction).toContain('Interpret clauses independently');
    expect(instruction).toContain('replacement fact');
    expect(instruction).toContain('replacementLocalId');
  });
});
