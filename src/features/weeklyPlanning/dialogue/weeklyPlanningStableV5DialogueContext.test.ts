import { describe, expect, it } from 'vitest';
import {
  isStableV5QuestionLikeText,
  requiredLabelsForStableV5Dialogue,
} from './weeklyPlanningStableV5DialogueContext';

describe('Stable V5 dialogue context', () => {
  it('extracts an unquoted deterministic target for quantity-role questions', () => {
    expect(requiredLabelsForStableV5Dialogue({
      questionCode: 'quantity_role_unresolved',
      fallbackText: '分野1の量は、今回進めたい量ですか、それとも残っている全体量ですか？',
    })).toEqual(['分野1']);
  });

  it('preserves task labels but not quoted examples in a missing-work question', () => {
    expect(requiredLabelsForStableV5Dialogue({
      questionCode: 'missing_schedulable_work',
      fallbackText: '「研究」、「院試の勉強」は把握しました。それぞれどれくらい進めたいですか？「2時間」「30ページ」「20問」のように、量を教えてください。',
    })).toEqual(['研究', '院試の勉強']);
  });

  it('does not invent a target for a generic question', () => {
    expect(requiredLabelsForStableV5Dialogue({
      questionCode: 'invalid_planning_horizon',
      fallbackText: 'いつからいつまでの予定を作るか教えてください。',
    })).toEqual([]);
  });

  it('preserves the preview promotion control label in status rendering', () => {
    expect(requiredLabelsForStableV5Dialogue({
      questionCode: null,
      fallbackText: '問題なければ下の「この内容で仮予定にする」ボタンを押してください。',
    })).toEqual(['この内容で仮予定にする']);
  });

  it('treats a deterministic information request without a question code as a question action', () => {
    expect(isStableV5QuestionLikeText(
      '予定に入れる作業量がまだありません。何をどれくらい進めたいか教えてください。',
    )).toBe(true);
    expect(isStableV5QuestionLikeText('2件の仮予定候補を作りました。')).toBe(false);
  });
});
