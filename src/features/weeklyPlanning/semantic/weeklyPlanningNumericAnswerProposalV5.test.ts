import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { numericAnswerProposalV5, numericDigitRunsV5, scanNumericQuantityMentionsV5 } from './weeklyPlanningNumericAnswerProposalV5';

describe('uninterpreted numeric answer proposals', () => {
  it.each([
    ['1問5分です', [1, 60, 5, 300]],
    ['150分です', [150]],
    ['２時間です', [2, 120]],
    ['0 00 5', [5, 300]],
    ['1440 1441', [1440]],
    ['5 5 300', [5, 300]],
    ['9007199254740992 99999999999999999999999999999 2', [2, 120]],
  ])('proposes every bounded expansion in occurrence order: %s', (text, minutes) => {
    expect(numericAnswerProposalV5(text)?.minutes).toEqual(minutes);
  });
  it.each(['十五分', 'はい', '0', '9007199254740992', '1 2 3 4 5', '0.5時間', '1.5時間', '1,500分', '１．５時間', '２，０００分', '1:30です', '１：３０', '.5時間', '1/2時間'])('fails closed without a bounded complete menu: %s', text => {
    expect(numericAnswerProposalV5(text)).toBeNull();
  });
  it('reads digit runs without joining or interpreting separators', () => {
    expect(numericDigitRunsV5('p.１５-0x2 0')).toEqual([15, 2]);
  });
  it('retains all source integers when expansions overlap', () => {
    expect(numericAnswerProposalV5('1 60')?.sourceIntegers.get(60)).toEqual([1, 60]);
  });
  it.each([
    ['十五分', [15]], ['１５です', [15]], ['15分の予定', [15]], ['一時間半', [90]], ['1時間30分', [90]],
    ['１．５時間', [90]], ['0.5時間', [30]], ['数学は1問5分。英語は15分', [1, 5, 15]],
  ])('v2 proposes converted mentions without deciding meaning: %s', (text, minutes) => {
    expect(numericAnswerProposalV5(text as string, true)?.minutes).toEqual(minutes);
  });
  it.each(['5分くらい', '約5分', '5分ほど', '5分前後', '5分程度', '1.5分', '.5時間',
    '1,500分', '1/2時間', '1:30', '5〜10分', '五から十分', '1441分', '99999999999999999999999分',
    '千五分', '2分の1時間', '1 2 3 4 5 6 7 8 9'])('v2 has no exact candidate: %s', text => {
    expect(numericAnswerProposalV5(text, true)).toBeNull();
  });
  it('keeps composite spans and whole-clause offsets, with approximation marked', () => {
    const text = '数学は1時間30分くらい。英語も15分';
    const mentions = scanNumericQuantityMentionsV5(text)!;
    expect(mentions.map(m => m.minutes)).toEqual([90, 15]);
    expect(mentions[0]).toMatchObject({ form: 'composite', approximate: true });
    for (const m of mentions) expect(text.slice(m.span.start, m.span.end)).toBe(m.surface);
    const source = readFileSync(new URL('./weeklyPlanningNumericAnswerProposalV5.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('naturalLanguageRules');
  });
});
