import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { numericAnswerProposalV5, numericDigitRunsV5 } from './weeklyPlanningNumericAnswerProposalV5';

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
  it.each(['十五分', 'はい', '0', '9007199254740992', '1 2 3 4 5', '0.5時間', '1.5時間', '1,500分', '１．５時間', '２，０００分'])('fails closed without a bounded complete menu: %s', text => {
    expect(numericAnswerProposalV5(text)).toBeNull();
  });
  it('reads digit runs without joining or interpreting separators', () => {
    expect(numericDigitRunsV5('p.１５-0x2 0')).toEqual([15, 2]);
  });
  it('retains all source integers when expansions overlap', () => {
    expect(numericAnswerProposalV5('1 60')?.sourceIntegers.get(60)).toEqual([1, 60]);
  });
  it('contains no Japanese vocabulary, units or semantic parser imports', () => {
    const source = readFileSync(new URL('./weeklyPlanningNumericAnswerProposalV5.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
    expect(source).not.toMatch(/\b(?:hour|minute|second|page|problem|unit|counter|parse|import)\b/i);
  });
});
