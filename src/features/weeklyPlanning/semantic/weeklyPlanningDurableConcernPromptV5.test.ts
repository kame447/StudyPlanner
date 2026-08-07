import { describe, expect, it } from 'vitest';
import { createWeeklyPlanningSemanticSystemPromptV5 } from './weeklyPlanningSemanticDocumentV5';

describe('Stable V5 durable concern prompt boundary', () => {
  it('distinguishes subjective continuing concern from descriptive workload comparison', () => {
    const prompt = createWeeklyPlanningSemanticSystemPromptV5();
    expect(prompt).toContain('A concern requires one explicit basis');
    expect(prompt).toContain('difficulty, weakness, worry, low_confidence, behind, or motivation_problem');
    expect(prompt).toContain('Descriptive amount, relative size, frequency, duration, or workload comparison alone supports none of these bases');
    expect(prompt).not.toContain('数学のワークの方が量は多い');
    expect(prompt).not.toContain('夏休みの課題');
  });
});