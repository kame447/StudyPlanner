import { describe, expect, it } from 'vitest';
import { evaluateReplyVerifierResponse, literalRequirementFailures, replyDigitRuns, replyDurationMinutes } from './weeklyPlanningReplyVerification';
import type { WeeklyPlanningMustConveyEntry } from './weeklyPlanningMustConvey';

const entry = (requiredMinutes: number, unmet: Array<{ label: string; minutes: number }> = []): WeeklyPlanningMustConveyEntry =>
  ({ code: 'shortfall', requiredMinutes, unmet, moreCount: 0 });
const fails = (text: string, e: WeeklyPlanningMustConveyEntry) => literalRequirementFailures(text, [e]).length > 0;

describe('V3 literal requirements', () => {
  it('folds full-width digits and thousands separators', () => {
    expect(replyDigitRuns('合計１，２００分と1,808分')).toEqual(['1200', '1808']);
  });
  it('accepts equivalent hour/minute renderings, rejects an omitted figure', () => {
    expect(fails('必要なのは4時間です', entry(240))).toBe(false);
    expect(fails('必要なのは240分です', entry(240))).toBe(false);
    expect(fails('必要なのは1時間30分です', entry(90))).toBe(false);
    expect(fails('必要なのは1.5時間です', entry(90))).toBe(false);
    expect(fails('必要なのは1時間半です', entry(90))).toBe(false);
    expect(fails('必要なのは2時間半です', entry(150))).toBe(false);
    expect(fails('必要なのは1時間半です', entry(60))).toBe(true);
    expect(fails('時間が足りませんでした', entry(240))).toBe(true);
    expect(fails('必要なのは3時間です', entry(240))).toBe(true);
    expect([...replyDurationMinutes('2時間15分')]).toEqual([135]);
  });
  it('requires each label literally', () => {
    expect(fails('合計60分。物理・力学は入りません', entry(60, [{ label: '物理・力学', minutes: 60 }]))).toBe(false);
    expect(fails('合計60分。物理は入りません', entry(60, [{ label: '物理・力学', minutes: 60 }]))).toBe(true);
  });
});

describe('V2 verdict evaluation', () => {
  const entries = [entry(240)];
  it('a forbidden claim fails even when every verdict is stated_accurately', () => {
    const raw = JSON.stringify({ verdicts: [{ code: 'shortfall', verdict: 'stated_accurately' }], forbidden: ['plan_fits'] });
    expect(evaluateReplyVerifierResponse(raw, entries)).toEqual({ ok: false, reason: 'verdict', failedCodes: [], forbidden: ['plan_fits'] });
  });
  it('accurate and nothing forbidden passes', () => {
    const raw = JSON.stringify({ verdicts: [{ code: 'shortfall', verdict: 'stated_accurately' }], forbidden: [] });
    expect(evaluateReplyVerifierResponse(raw, entries)).toEqual({ ok: true });
  });
});
