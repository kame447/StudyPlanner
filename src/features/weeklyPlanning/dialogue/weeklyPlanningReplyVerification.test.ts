import { describe, expect, it } from 'vitest';
import { createReplyVerifierMessages, evaluateReplyVerifierResponse, literalRequirementFailures, replyDigitRuns, replyDurationMinutes } from './weeklyPlanningReplyVerification';
import type { WeeklyPlanningMustConveyEntry } from './weeklyPlanningMustConvey';

const entry = (requiredMinutes: number, unmet: Array<{ label: string; minutes: number }> = [], moreCount = 0): WeeklyPlanningMustConveyEntry =>
  ({ code: 'shortfall', requiredMinutes, unmet, moreCount });
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
    const raw = JSON.stringify({ verdicts: [{ key: 'shortfall', verdict: 'stated_accurately' }], forbidden: ['plan_fits'] });
    expect(evaluateReplyVerifierResponse(raw, entries)).toEqual({ ok: false, reason: 'verdict', failedCodes: [], forbidden: ['plan_fits'] });
  });
  it('accurate and nothing forbidden passes', () => {
    const raw = JSON.stringify({ verdicts: [{ key: 'shortfall', verdict: 'stated_accurately' }], forbidden: [] });
    expect(evaluateReplyVerifierResponse(raw, entries)).toEqual({ ok: true });
  });
});

describe('shortfall: the further unmet items (V3) and the verifier definition (V2)', () => {
  const item = [{ label: '物理・力学', minutes: 720 }];
  it('requires the moreCount number when there are further items', () => {
    expect(fails('合計1808分。物理・力学（720分）が入りません', entry(1808, item, 3))).toBe(true);
    expect(fails('合計1808分。物理・力学（720分）とほか3件が入りません', entry(1808, item, 3))).toBe(false);
    expect(fails('合計1808分。物理・力学（720分）が入りません', entry(1808, item, 0))).toBe(false);
  });
  it('the verifier prompt separates the plan total from the unmet work and names the further items', () => {
    const system = createReplyVerifierMessages({ entries: [entry(1808, item, 3)], text: 'x' })[0].content;
    expect(system).toContain('planTotalMinutes is NOT the amount that did not fit');
    expect(system).toContain('furtherUnmetItemCount is above zero');
    const user = JSON.parse(createReplyVerifierMessages({ entries: [entry(1808, item, 3)], text: 'x' })[1].content);
    expect(user.required[0]).toMatchObject({ key: 'shortfall', planTotalMinutes: 1808, furtherUnmetItemCount: 3 });
  });
});

describe('shortfall: the whole plan is the unmet work (D1)', () => {
  const only = [{ label: '英語の長文問題', minutes: 1320 }];
  it('the verifier prompt says a total equal to the single unmet item is accurate and not a confusion', () => {
    const system = createReplyVerifierMessages({ entries: [entry(1320, only)], text: 'x' })[0].content;
    expect(system).toContain('the unmet work IS the whole plan');
    expect(system).toContain('need not be repeated separately');
    expect(system).toContain('planTotalMinutes is NOT the amount that did not fit');
  });
  it('V3 accepts the natural single-item reply (total stated once, work named) and still rejects an omission', () => {
    expect(fails('英語の長文問題に必要な時間は1320分で、今日中には収まりません。どの方法にしますか？', entry(1320, only))).toBe(false);
    expect(fails('英語の長文問題は今日中には収まりません。', entry(1320, only))).toBe(true);
  });
});

describe('declared_amount_waiting (P3 S1 payload; derivation elsewhere)', () => {
  const waiting = (amount: number, unitCode: 'minute' | 'hour', quote = '合計2時間くらい'): WeeklyPlanningMustConveyEntry =>
    ({ code: 'declared_amount_waiting', factId: 'wpf_workload_1', quote, amount, unitCode });
  it('V3: the quote or the amount (declared unit or equivalent hours/minutes) must appear', () => {
    expect(fails('合計2時間くらいというお話はまだ使っていません', waiting(120, 'minute'))).toBe(false);
    expect(fails('2時間の分はまだ使っていません', waiting(120, 'minute'))).toBe(false);
    expect(fails('120分の分はまだ使っていません', waiting(2, 'hour'))).toBe(false);
    expect(fails('お話の分はまだ使っていません', waiting(120, 'minute'))).toBe(true);
  });
  it('is keyed by code and fact id, so two waiting amounts need two verdicts', () => {
    const entries = [waiting(120, 'minute'), { ...waiting(60, 'minute'), factId: 'wpf_workload_2' } as WeeklyPlanningMustConveyEntry];
    const one = JSON.stringify({ verdicts: [{ key: 'declared_amount_waiting:wpf_workload_1', verdict: 'stated_accurately' }], forbidden: [] });
    expect(evaluateReplyVerifierResponse(one, entries)).toEqual({ ok: false, reason: 'malformed' });
    const both = JSON.stringify({ verdicts: entries.map(e => ({ key: e.code === 'declared_amount_waiting' ? `${e.code}:${e.factId}` : e.code, verdict: 'stated_accurately' })), forbidden: [] });
    expect(evaluateReplyVerifierResponse(both, entries)).toEqual({ ok: true });
  });
  it('a wrong key with the right count is malformed (single entry)', () => {
    const raw = JSON.stringify({ verdicts: [{ key: 'shortfall', verdict: 'stated_accurately' }], forbidden: [] });
    expect(evaluateReplyVerifierResponse(raw, [waiting(120, 'minute')])).toEqual({ ok: false, reason: 'malformed' });
  });
  it('a duplicated key with the right count is malformed (two entries answered [k1, k1])', () => {
    const entries = [waiting(120, 'minute'), { ...waiting(60, 'minute'), factId: 'wpf_workload_2' } as WeeklyPlanningMustConveyEntry];
    const raw = JSON.stringify({ verdicts: [
      { key: 'declared_amount_waiting:wpf_workload_1', verdict: 'stated_accurately' },
      { key: 'declared_amount_waiting:wpf_workload_1', verdict: 'stated_accurately' },
    ], forbidden: [] });
    expect(evaluateReplyVerifierResponse(raw, entries)).toEqual({ ok: false, reason: 'malformed' });
  });
  it('adding the code does not change the shortfall request', () => {
    const shortfallOnly = createReplyVerifierMessages({ entries: [entry(240)], text: 'x' })[1].content;
    expect(shortfallOnly).not.toContain('statedAmount');
    expect(createReplyVerifierMessages({ entries: [waiting(120, 'minute')], text: 'x' })[0].content).toContain('NOT used in the plan yet');
  });
});
