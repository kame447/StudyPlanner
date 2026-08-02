import { describe, expect, it } from 'vitest';
import {
  groundedDurationMinutesFromUserTextV5,
  groundedQuantityRoleFromUserTextV5,
} from './weeklyPlanningContextualAnswerGroundingV5';

describe('Stable V5 contextual answer grounding', () => {
  it.each([
    ['3時間です', [180]],
    ['1時間30分です', [90]],
    ['1時間半くらい', [90]],
    ['90分です', [90]],
    ['１．５時間です', [90]],
    ['2 hours', [120]],
    ['45 min', [45]],
    ['3ページです', []],
  ])('grounds explicit duration without converting other units: %s', (text, expected) => {
    expect(groundedDurationMinutesFromUserTextV5(text)).toEqual(expected);
  });

  it('keeps multiple explicit duration candidates ambiguous', () => {
    expect(groundedDurationMinutesFromUserTextV5('1時間か2時間です')).toEqual([
      60,
      120,
    ]);
  });

  it.each([
    ['今回進めたい量です', 'target'],
    ['この計画でやりたい量です', 'target'],
    ['今回分です', 'target'],
    ['まだ残っている全体量です', 'remaining'],
    ['残りの量です', 'remaining'],
    ['もう完了した量です', 'completed'],
    ['実施済みです', 'completed'],
    ['英語を追加したいです', null],
    ['今回の量か残りの量です', null],
  ])('grounds one quantity role from the current answer: %s', (text, expected) => {
    expect(groundedQuantityRoleFromUserTextV5(text)).toBe(expected);
  });
});
