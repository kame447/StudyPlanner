import { describe, expect, it } from 'vitest';
import { createWeeklyPlanningSemanticMeaningPolicyV5 } from './weeklyPlanningSemanticMeaningPolicyV5';

describe('Stable V5 workload unit semantic policy', () => {
  it('keeps standard unit selection in semantic interpretation and reserves custom as fallback', () => {
    const policy = createWeeklyPlanningSemanticMeaningPolicyV5();

    expect(policy).toContain(
      'minute, hour, page, problem, word, lesson, chapter, section, exam_year, mock_exam, or session',
    );
    expect(policy).toContain('Use custom only if none matches.');
    expect(policy).toContain(
      'unitLabel may preserve the user’s wording without changing an otherwise matching standard unit into custom.',
    );
  });
});
