import { describe, expect, it } from 'vitest';
import { requiredLabelsForStableV5Dialogue } from './weeklyPlanningStableV5DialogueContext';

describe('Stable V5 dialogue context', () => {
  it('extracts an unquoted deterministic target for quantity-role questions', () => {
    expect(requiredLabelsForStableV5Dialogue({
      questionCode: 'quantity_role_unresolved',
      fallbackText: '分野1の量は、今回進めたい量ですか、それとも残っている全体量ですか？',
    })).toEqual(['分野1']);
  });

  it('preserves every quoted task label in a missing-work question', () => {
    expect(requiredLabelsForStableV5Dialogue({
      questionCode: 'missing_schedulable_work',
      fallbackText: '「研究」、「院試の勉強」は把握しました。それぞれどれくらい進めたいですか？',
    })).toEqual(['研究', '院試の勉強']);
  });

  it('does not invent a target for a generic question', () => {
    expect(requiredLabelsForStableV5Dialogue({
      questionCode: 'invalid_planning_horizon',
      fallbackText: 'いつからいつまでの予定を作るか教えてください。',
    })).toEqual([]);
  });
});
