import { describe, expect, it } from 'vitest';
import {
  extractDirectWorkExpectationsV5,
} from './weeklyPlanningDirectWorkCoverageV5';
import {
  normalizePlanningWindowCanonicalV5,
  relativeWindowSourceExpectationV5,
} from './weeklyPlanningPlanningWindowCanonicalContractV5';

describe('Stable V5 semantic abstraction guards', () => {
  it.each([
    '明日',
    '明日か明後日のどちらか',
    '来週ではなく今週に変更',
    '今日または来週',
  ])('does not derive a planning-window meaning from sourceText: %s', (sourceText) => {
    expect(relativeWindowSourceExpectationV5(sourceText)).toBeNull();

    const window = {
      localId: 'window-ai-selected',
      kind: 'relative_week' as const,
      value: 'next_week',
      start: null,
      end: null,
      sourceText,
    };
    expect(normalizePlanningWindowCanonicalV5(window)).toEqual({
      window,
      repairs: [],
    });
  });

  it.each([
    '作業を2時間半進める',
    '演習を10〜15問進める',
    '資料確認を2時間30分行う',
    '作業を2.5時間進める',
    '英語40問に3時間かかる',
  ])('does not extract work semantics from user text: %s', (userText) => {
    expect(extractDirectWorkExpectationsV5(userText)).toEqual([]);
  });
});
