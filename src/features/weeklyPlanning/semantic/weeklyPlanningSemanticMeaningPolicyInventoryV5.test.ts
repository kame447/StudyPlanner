import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5,
  WEEKLY_PLANNING_SEMANTIC_RULE_RETENTION_BASES_V5,
  createWeeklyPlanningSemanticMeaningPolicyV5,
} from './weeklyPlanningSemanticMeaningPolicyV5';

describe('Stable V5 semantic meaning-rule inventory', () => {
  it('assigns every always-on rule a unique stable ID and an explicit retention basis', () => {
    const ids = WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const rule of WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5) {
      expect(WEEKLY_PLANNING_SEMANTIC_RULE_RETENTION_BASES_V5).toContain(
        rule.retentionBasis,
      );
      expect(rule.retentionReason.trim().length).toBeGreaterThan(20);
      expect(rule.instruction.trim().length).toBeGreaterThan(0);
    }
  });

  it('keeps only interpretation, contextual binding, or semantic-scope reasons in the always-on inventory', () => {
    const bases = new Set(
      WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5.map((rule) => rule.retentionBasis),
    );

    expect([...bases].sort()).toEqual([
      'contextual_reference_resolution',
      'language_interpretation',
      'semantic_scope_boundary',
    ]);
  });

  it('does not leak inventory metadata into the provider prompt', () => {
    const prompt = createWeeklyPlanningSemanticMeaningPolicyV5();

    for (const rule of WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5) {
      expect(prompt).toContain(rule.instruction);
      expect(prompt).not.toContain(rule.retentionReason);
      expect(prompt).not.toContain(rule.retentionBasis);
      expect(prompt).not.toContain(rule.id);
    }
  });

  it('reserves fixed_interval for clock intervals and uses date-bound kinds for date-only periods', () => {
    const temporalRule = WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5.find(
      (rule) => rule.id === 'temporal_scope_and_deadline',
    );

    expect(temporalRule?.instruction).toContain(
      'fixed_interval requires both clock startTime/endTime',
    );
    expect(temporalRule?.instruction).toContain(
      'Date-only from/after -> earliest_start; until/by -> latest_end or deadline',
    );
  });
});
