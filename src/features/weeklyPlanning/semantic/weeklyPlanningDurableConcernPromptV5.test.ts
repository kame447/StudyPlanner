import { describe, expect, it } from 'vitest';
import { createWeeklyPlanningSemanticMeaningPolicyV5 } from './weeklyPlanningSemanticMeaningPolicyV5';

describe('Stable V5 durable concern prompt boundary', () => {
  it('distinguishes subjective continuing concern from descriptive workload comparison', () => {
    const prompt = createWeeklyPlanningSemanticMeaningPolicyV5();
    expect(prompt).toContain('A concern requires explicit evidence');
    expect(prompt).toContain('difficulty, weakness, worry, low confidence, being behind, or a motivation problem');
    expect(prompt).toContain('amount, frequency, duration, or workload size alone');
    expect(prompt).not.toContain('数学のワークの方が量は多い');
    expect(prompt).not.toContain('夏休みの課題');
  });
});