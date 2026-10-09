import { describe, expect, it } from 'vitest';
import { weeklyPlanningUncertaintyReleaseText } from './weeklyPlanningUncertaintyReleaseDisclosure';

describe('weeklyPlanningUncertaintyReleaseText', () => {
  it('quotes the user\'s own words and says the point stays unconfirmed', () => {
    expect(weeklyPlanningUncertaintyReleaseText('あとこれって1日でまとめて読んでも平気？'))
      .toBe('「あとこれって1日でまとめて読んでも平気？」について未確定の点を残したまま、仮予定を作りました。');
  });
  it('caps the quote at the question excerpt limit', () => {
    const text = weeklyPlanningUncertaintyReleaseText('あ'.repeat(200));
    expect(text).toBe(`「${'あ'.repeat(80)}…」について未確定の点を残したまま、仮予定を作りました。`);
  });
  it('falls back to a generic sentence without a quote, never claiming resolution', () => {
    for (const quote of [null, undefined, '  ']) expect(weeklyPlanningUncertaintyReleaseText(quote)).toBe('いくつか未確定の点を残したまま、仮予定を作りました。');
  });
});
