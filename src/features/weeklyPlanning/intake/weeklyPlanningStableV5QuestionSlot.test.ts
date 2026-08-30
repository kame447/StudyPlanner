import { describe, expect, it } from 'vitest';
import {
  decodeWeeklyPlanningStableV5QuestionSlot,
  isWeeklyPlanningStableV5QuestionSlot,
} from './weeklyPlanningStableV5QuestionSlot';

describe('Stable V5 question-slot decoding', () => {
  it('decodes a valid Stable V5 question code', () => {
    expect(decodeWeeklyPlanningStableV5QuestionSlot('stable_v5:missing_effort_estimate'))
      .toBe('missing_effort_estimate');
  });

  it('normalizes surrounding whitespace in the encoded question code', () => {
    expect(decodeWeeklyPlanningStableV5QuestionSlot('stable_v5:  missing_effort_estimate  '))
      .toBe('missing_effort_estimate');
  });

  it('rejects unrelated slots', () => {
    expect(decodeWeeklyPlanningStableV5QuestionSlot('legacy:missing_effort_estimate')).toBeNull();
    expect(isWeeklyPlanningStableV5QuestionSlot('legacy:missing_effort_estimate')).toBe(false);
  });

  it('rejects empty and whitespace-only Stable V5 slots consistently', () => {
    expect(decodeWeeklyPlanningStableV5QuestionSlot('stable_v5:')).toBeNull();
    expect(decodeWeeklyPlanningStableV5QuestionSlot('stable_v5:   ')).toBeNull();
    expect(isWeeklyPlanningStableV5QuestionSlot('stable_v5:')).toBe(false);
    expect(isWeeklyPlanningStableV5QuestionSlot('stable_v5:   ')).toBe(false);
  });
});
