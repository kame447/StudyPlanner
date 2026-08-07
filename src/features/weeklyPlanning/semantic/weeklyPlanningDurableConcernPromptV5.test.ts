import { describe, expect, it } from 'vitest';
import { createWeeklyPlanningSemanticSystemPromptV5 } from './weeklyPlanningSemanticDocumentV5';

describe('Stable V5 durable concern prompt boundary', () => {
  it('distinguishes subjective continuing concern from descriptive workload comparison', () => {
    const prompt = createWeeklyPlanningSemanticSystemPromptV5();
    expect(prompt).toContain('subjective or evaluative continuing difficulty');
    expect(prompt).toContain('descriptive amount, relative size, frequency, duration, or workload comparison alone is not a concern');
    expect(prompt).not.toContain('数学のワークの方が量は多い');
    expect(prompt).not.toContain('夏休みの課題');
  });
});
