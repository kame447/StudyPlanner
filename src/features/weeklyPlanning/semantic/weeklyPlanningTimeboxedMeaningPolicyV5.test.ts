import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5,
  createWeeklyPlanningSemanticMeaningPolicyV5,
} from './weeklyPlanningSemanticMeaningPolicyV5';

describe('Stable V5 timeboxed planning meaning policy', () => {
  const workloadRule = WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5.find(
    (rule) => rule.id === 'workload_quantity_effort',
  );
  const effortRule = WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5.find(
    (rule) => rule.id === 'effort_measurement',
  );

  it('treats requested study time as schedulable work instead of progress evidence', () => {
    expect(workloadRule).toBeDefined();
    expect(workloadRule?.instruction).toContain('Scheduled time is target minute/hour workload');
    expect(workloadRule?.instruction).toContain('do not ask content progress');
    expect(workloadRule?.instruction).toContain('perOccurrence/recurrence');
  });

  it('keeps duration cost separate when a non-time workload is already stated', () => {
    expect(effortRule).toBeDefined();
    expect(effortRule?.instruction).toContain('duration_per_unit = time per explicit unit');
    expect(effortRule?.instruction).toContain('total_duration = whole-work cost');
    expect(effortRule?.instruction).toContain('session_duration = one-session duration/limit');
    expect(effortRule?.instruction).toContain('Do not omit a stated effort because quantity or another effort is present');
  });

  it('keeps the rule in the generic semantic prompt', () => {
    const policy = createWeeklyPlanningSemanticMeaningPolicyV5();
    expect(policy).toContain(workloadRule?.instruction ?? '__missing_rule__');
    expect(policy).toContain(effortRule?.instruction ?? '__missing_effort_rule__');
  });
});
