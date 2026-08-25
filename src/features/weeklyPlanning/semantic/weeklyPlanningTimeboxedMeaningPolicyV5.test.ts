import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5,
  createWeeklyPlanningSemanticMeaningPolicyV5,
} from './weeklyPlanningSemanticMeaningPolicyV5';

describe('Stable V5 timeboxed planning meaning policy', () => {
  const workloadRule = WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5.find(
    (rule) => rule.id === 'workload_quantity_effort',
  );

  it('treats requested study time as schedulable work instead of progress evidence', () => {
    expect(workloadRule).toBeDefined();
    expect(workloadRule?.instruction).toContain('Time the user wants scheduled');
    expect(workloadRule?.instruction).toContain('target minute/hour workload');
    expect(workloadRule?.instruction).toContain('do not ask for content progress');
    expect(workloadRule?.instruction).toContain('perOccurrence/recurrence');
  });

  it('keeps duration cost separate when a non-time workload is already stated', () => {
    expect(workloadRule?.instruction).toContain('separately stated workload');
    expect(workloadRule?.instruction).toContain('total_duration/duration_per_unit effort');
    expect(workloadRule?.instruction).toContain('session_duration');
  });

  it('keeps the rule in the generic semantic prompt', () => {
    const policy = createWeeklyPlanningSemanticMeaningPolicyV5();
    expect(policy).toContain(workloadRule?.instruction ?? '__missing_rule__');
  });
});
