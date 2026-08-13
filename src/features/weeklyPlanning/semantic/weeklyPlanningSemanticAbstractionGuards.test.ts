import { describe, expect, it } from 'vitest';
import {
  normalizePlanningWindowCanonicalV5,
} from './weeklyPlanningPlanningWindowCanonicalContractV5';

describe('Stable V5 semantic abstraction guards', () => {
  it.each([
    '明日',
    '明日か明後日のどちらか',
    '来週ではなく今週に変更',
    '今日または来週',
  ])('does not reinterpret an AI-selected relative window from sourceText: %s', (sourceText) => {
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
});
