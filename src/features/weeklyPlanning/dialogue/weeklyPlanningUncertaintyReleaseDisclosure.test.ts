import { describe, expect, it } from 'vitest';
import { weeklyPlanningUncertaintyReleaseText } from './weeklyPlanningUncertaintyReleaseDisclosure';

describe('weeklyPlanningUncertaintyReleaseText', () => {
  it('quotes the user\'s own words and states the release, never the plan', () => {
    const text = weeklyPlanningUncertaintyReleaseText({ quote: 'あとこれって1日でまとめて読んでも平気？' });
    expect(text).toBe('「あとこれって1日でまとめて読んでも平気？」については未確定のまま進めます。');
    expect(text).not.toMatch(/仮予定を作りました/);
  });
  it('caps the quote at the question excerpt limit', () => {
    expect(weeklyPlanningUncertaintyReleaseText({ quote: 'あ'.repeat(200) })).toBe(`「${'あ'.repeat(80)}…」については未確定のまま進めます。`);
  });
  it('falls back to a generic sentence without a quote, never claiming resolution', () => {
    for (const quote of [null, undefined, '  ']) expect(weeklyPlanningUncertaintyReleaseText({ quote })).toBe('未確定の点を残したまま進めます。');
  });
  it('a release that applied nothing says so (a dropped condition is never silent)', () => {
    expect(weeklyPlanningUncertaintyReleaseText({ quote: 'Q', nothingRead: true }))
      .toBe('「Q」については未確定のまま進めます。この返事からは新しい条件を読み取っていません。条件があれば、あらためて教えてください。');
  });
});
