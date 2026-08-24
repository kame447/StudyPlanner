import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5,
  WEEKLY_PLANNING_SEMANTIC_RULE_RETENTION_BASES_V5,
  createWeeklyPlanningSemanticMeaningPolicyV5,
} from './weeklyPlanningSemanticMeaningPolicyV5';

function instructionFor(id: string): string {
  const rule = WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5.find(
    (candidate) => candidate.id === id,
  );
  if (!rule) throw new Error(`missing semantic meaning rule: ${id}`);
  return rule.instruction;
}

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

  it('keeps historically load-bearing semantic distinctions explicit after prompt compaction audits', () => {
    expect(instructionFor('task_decomposition_status')).toContain('needs_breakdown');
    expect(instructionFor('task_decomposition_status')).toContain('never invent constituents');

    expect(instructionFor('workload_unit_code')).toContain('unitLabel');
    expect(instructionFor('workload_unit_code')).toContain('custom only if none matches');

    expect(instructionFor('workload_quantity_effort')).toContain('use declared');
    expect(instructionFor('workload_quantity_effort')).toContain('do not guess a stronger quantityRole');
    expect(instructionFor('workload_quantity_effort')).toContain('instead of inventing a number');
    expect(instructionFor('workload_quantity_effort')).toContain('Distinguish workload quantity from duration');

    expect(instructionFor('modifier_target_ambiguity')).toContain('one uniquely supported semantic target');
    expect(instructionFor('modifier_target_ambiguity')).toContain('proximity, list order, or convenience');

    expect(instructionFor('temporal_clock_evidence')).toContain('explicit clock-time evidence');
    expect(instructionFor('temporal_clock_evidence')).toContain('must not be converted into invented exact clock times');

    expect(instructionFor('event_occurrence_vs_work_deadline')).toContain('is not automatically a work deadline');
    expect(instructionFor('event_occurrence_vs_work_deadline')).toContain('goal_event');

    expect(instructionFor('contextual_reference_binding')).toContain('Emit relations only when stated');
    expect(instructionFor('contextual_reference_binding')).toContain('workload size');
  });
});
