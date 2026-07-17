import { describe, expect, it } from 'vitest';
import { isValidWeeklyPlanningCommand } from './weeklyPlanningCommandRuntimeValidation';

describe('weekly planning command runtime validation', () => {
  it('rejects duplicate exam fields at the command boundary', () => {
    expect(isValidWeeklyPlanningCommand({
      type: 'set_exam_scope',
      scope: {
        fields: ['数学', '数学'],
        yearRange: { startYear: 2025, endYear: 2020, sourceText: '2025〜2020' },
        rawText: ['数学'],
      },
      sourceText: '数学',
      confidence: 'high',
    })).toBe(false);
  });

  it.each([
    {
      type: 'set_priority_policy',
      policy: { kind: 'field_first' },
      sourceText: '数学優先',
      confidence: 'high',
    },
    {
      type: 'set_priority_policy',
      policy: { kind: 'field_first', order: [null] },
      sourceText: '数学優先',
      confidence: 'high',
    },
    {
      type: 'set_priority_policy',
      policy: { kind: 'field_first', order: ['数学'] },
      sourceText: null,
      confidence: 'high',
    },
    {
      type: 'set_priority_policy',
      policy: { kind: 'field_first', order: ['数学'] },
      sourceText: '数学優先',
      confidence: null,
    },
    {
      type: 'set_priority_policy',
      policy: { kind: 'field_first', order: ['数学'] },
      sourceText: '数学優先',
    },
  ])('rejects malformed required command fields %#', (command) => {
    expect(isValidWeeklyPlanningCommand(command)).toBe(false);
  });
});
