import { describe, expect, it } from 'vitest';
import { isSavedPlanTitle } from '../../tests/e2e/support/schedule-plan-title.mjs';

const title = 'E2E-E2E-VNEXT-run-123-読書';

describe('saved smoke plan title identity', () => {
  it.each(['', ' 60分', ' 1時間', ' 0.5時間', ' 1.5時間', ' 30.0分', ' 0.5分'])('accepts the displayed duration %j', suffix => {
    expect(isSavedPlanTitle(title + suffix, title)).toBe(true);
  });

  it.each([
    'E2E-E2E-VNEXT-run-1234-読書 60分',
    'E2E-E2E-VNEXT-run-124-読書 1時間',
    title + 'の続き 60分',
    title + ' 1時間の補足',
    title + ' 30ページ',
    '読書 60分',
  ])('rejects a different run or task: %s', blockTitle => {
    expect(isSavedPlanTitle(blockTitle, title)).toBe(false);
  });

  it('retains exact full-display-title matching for the existing leftover sweep', () => {
    const fullTitle = title + ' 0.5時間';
    expect(isSavedPlanTitle(fullTitle, fullTitle)).toBe(true);
  });

  it('treats punctuation in the unique title literally', () => {
    const punctuated = 'E2E-E2E-VNEXT-run-123-演習 [A+B]';
    expect(isSavedPlanTitle(punctuated + ' 60分', punctuated)).toBe(true);
    expect(isSavedPlanTitle('E2E-E2E-VNEXT-run-123-演習 AAB 60分', punctuated)).toBe(false);
  });
});
