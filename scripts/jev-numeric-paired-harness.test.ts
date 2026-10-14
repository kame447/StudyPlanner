import { describe, expect, it } from 'vitest';
import { runPairedNumericCase, numericCardinalityDiagnostics, runNumericCardinalityDiagnostics } from './jev-numeric-paired-harness';
import { numericFixture, normalizedChoice } from '../src/features/weeklyPlanning/semantic/weeklyPlanningNumericPendingChoiceV5.testUtils';
describe('D5 symmetric offline paired harness', () => {
  it('records actual provider dispatch, retains missing usage as NA, and shares binder/leaves', async () => {
    const h = numericFixture();
    const rows = await runPairedNumericCase({ pairId: crypto.randomUUID(), source: 'synthetic', input: h.input, uninterpretedSpans: [{ start: 0, end: 2 }], labelProvenance: 'synthetic-fixture-not-gold' }, {
      createLunaClient(_arm, recorder) { return { async createChatCompletion() {
        await recorder.providerFetch('openai', 'luna', 'focused', async () => Response.json({ fixture: true }))('https://fixture.invalid');
        return JSON.stringify({ decision: 'effort_answer', effortTarget: 'question_target', effortMeasurement: 'total_duration', minutes: 30, precision: 'exact', quantityRole: null });
      } }; },
      createChoicePort(_arm, recorder) { return { ...h.port, readCurrent(input) { return { ...h.state, binding: { ...h.state.binding, requestId: input.traceRequestId! } }; }, async choose(r, before) {
        before(); await recorder.providerFetch('openrouter', 'jev', 'focused', async () => Response.json({ fixture: true }))('https://fixture.invalid');
        return normalizedChoice(r, 'leaf:2');
      } }; },
    });
    expect(rows.map(r => r.summary.lunaDispatches)).toEqual([0, 0, 0, 1]);
    expect(rows.map(r => r.summary.jevDispatches)).toEqual([1, 1, 1, 0]);
    for (const row of rows) { expect(row.summary.status).toBe('known'); expect(row.summary.usage).toEqual({ inputTokens: null, outputTokens: null, costUsd: null });
      expect(row.graph?.graph.effortEstimates[0]).toMatchObject({ targetFactId: 'workload-1', kind: 'total_duration', minutes: 30, precision: 'exact' }); }
  });
  it('rejects asymmetric candidate omission before treating it as paired evidence', async () => {
    const h = numericFixture();
    await expect(runPairedNumericCase({ pairId: crypto.randomUUID(), source: 'synthetic', input: h.input, uninterpretedSpans: [], labelProvenance: 'synthetic' }, {
      createLunaClient: () => ({ createChatCompletion: async () => '' }),
      createChoicePort(arm) { return { ...h.port, domainMinutes: arm === 'hierarchy' ? [30] : h.port.domainMinutes, readCurrent(input) { return { ...h.state, binding: { ...h.state.binding, requestId: input.traceRequestId! } }; } }; },
    })).rejects.toThrow('Asymmetric');
  });
  it('keeps 10/50/100/250 diagnostics separate and flat-compatible including none', () => {
    expect(numericCardinalityDiagnostics().map(r => [r.cardinality, r.domainMinutes.length])).toEqual([[10, 10], [50, 50], [100, 100], [250, 250]]);
  });
  // Functional sweep of all 16 arms: observed 1.3s and 5.3s across full runs.
  // This finite runner budget preserves every assertion; it is not a performance guarantee.
  it('runs real multi-node hierarchy dispatch accounting separately at each fixed-binding cardinality', async () => {
    const h = numericFixture(); const spansReceived: Array<{ arm: string; count: number }> = [];
    const strata = await runNumericCardinalityDiagnostics({ pairId: crypto.randomUUID(), source: 'synthetic', input: { ...h.input, userText: '1分' }, uninterpretedSpans: [{ start: 0, end: 2 }], labelProvenance: 'synthetic-orchestration-only' }, {
      createLunaClient(_arm, recorder) { return { async createChatCompletion() {
        await recorder.providerFetch('openai', 'luna', 'focused', async () => Response.json({}))('https://fixture.invalid');
        return JSON.stringify({ decision: 'effort_answer', effortTarget: 'question_target', effortMeasurement: 'total_duration', minutes: 1, precision: 'exact', quantityRole: null });
      } }; },
      createChoicePort(arm, recorder, spans) {
        spansReceived.push({ arm, count: spans.length });
        return { ...h.port, choicePolicy: { ...h.port.choicePolicy, rules: ['groups', 'leaves'].flatMap(menuKind => Array.from({ length: 4 }, (_, depth) =>
          Array.from({ length: 250 }, (_, i) => ({ menuKind: menuKind as 'groups' | 'leaves', depth, optionCount: i + 2, minimumTopProbability: 0.98, minimumMargin: 0.9 }))).flat()) },
          readCurrent(input) { return { ...h.state, binding: { ...h.state.binding, requestId: input.traceRequestId! } }; }, async choose(r, before) {
            const option = r.menu.options.find(o => o.kind === 'leaf' ? o.candidate.tuple.minutes === 1 : o.kind === 'group' && o.candidates.some(c => c.tuple.minutes === 1));
            before(); await recorder.providerFetch('openrouter', 'jev', 'focused', async () => Response.json({}))('https://fixture.invalid');
            return normalizedChoice(r, option!.id);
          },
        };
      },
    });
    expect(strata.map(s => s.cardinality)).toEqual([10, 50, 100, 250]);
    expect(strata.map(s => s.rows.find(r => r.arm === 'hierarchy')!.summary.jevDispatches)).toEqual([1, 2, 2, 3]);
    for (const stratum of strata) for (const row of stratum.rows) expect(row.graph?.graph.effortEstimates[0].minutes).toBe(1);
    expect(spansReceived.every(s => s.count === (s.arm === 'unparsed_span' ? 1 : 0))).toBe(true);
  }, 15_000);
});
