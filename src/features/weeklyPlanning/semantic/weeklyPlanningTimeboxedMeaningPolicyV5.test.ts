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
    expect(workloadRule?.instruction).toContain('Scheduled time is target minute/hour workload');
    expect(workloadRule?.instruction).toContain('do not ask content progress');
    expect(workloadRule?.instruction).toContain('perOccurrence/recurrence');
  });

  it('keeps duration cost separate when a non-time workload is already stated', () => {
    expect(workloadRule?.instruction).toContain('Separate workload cost');
    expect(workloadRule?.instruction).toContain('total_duration/duration_per_unit');
    expect(workloadRule?.instruction).toContain('session_duration only for one session');
  });

  it('keeps the rule in the generic semantic prompt', () => {
    const policy = createWeeklyPlanningSemanticMeaningPolicyV5();
    expect(policy).toContain(workloadRule?.instruction ?? '__missing_rule__');
  });
});
