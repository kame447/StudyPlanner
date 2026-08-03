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
    '明日か明後日のどちらか',
    '来週ではなく今週に変更',
    '今日または来週',
  ])('does not choose one relative window from ambiguous source evidence: %s', (sourceText) => {
    expect(relativeWindowSourceExpectationV5(sourceText)).toBeNull();

    const window = {
      localId: 'window-ambiguous',
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
  ])('does not coerce a non-scalar quantity into one exact value: %s', (userText) => {
    expect(extractDirectWorkExpectationsV5(userText)).toEqual([]);
  });

  it('keeps an explicitly stated decimal scalar', () => {
    expect(extractDirectWorkExpectationsV5('作業を2.5時間進める')).toEqual([
      {
        label: '作業',
        amount: 2.5,
        unitCode: 'hour',
        unitLabel: '時間',
      },
    ]);
  });
});
