import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPairedWorkerSource } from './jev-contextual-paired-runtime.mjs';
import { applyJointLabels, REQUIRED_OWNER_THRESHOLDS, validateApproval, validateCorpus } from './jev-contextual-paired-eval.mjs';
import { observedTotal, clopperPearsonUpper95, summarizePairs } from './jev-contextual-eval-metrics.mjs';
import { summarize, summarizeLunaBaseline } from './jev-contextual-cloud-eval.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const corpus = JSON.parse(await readFile(resolve(root, 'scripts/jev-contextual-development-corpus.json'), 'utf8'));
let runTurn;
beforeAll(async () => {
  const bundle = await build({ stdin: { contents: createPairedWorkerSource({ root, cases: corpus.cases,
    digest: 'offline-only', expiresAt: 0 }), resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
  ({ runTurn } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const env = { OPENROUTER_API_KEY: 'offline-jev', OPENAI_API_KEY: 'offline-luna' };
const roleAnswer = { decision: 'quantity_role_answer', effortTarget: null, effortMeasurement: null,
  minutes: null, precision: null, quantityRole: 'target' };
function installProvider(choice = 'target', failLuna = false) {
  const wire = [];
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    wire.push({ url: String(url), body: JSON.parse(init.body) });
    if (String(url).includes('/decisions')) return Response.json({ model: 'typesafe/jev-1.13',
      answers: { contextual_answer: { type: 'choice', choice, confidence: 0.999,
        probabilities: Object.fromEntries(['target', 'remaining', 'completed', 'focused_luna', 'fallback'].map((key) => [key, key === choice ? 0.9996 : 0.0001])) },
      condition_change: { type: 'noul', noul: 0.001 }, independent_meaning: { type: 'noul', noul: 0.001 } },
      usage: { input_tokens: 10, output_tokens: 3, cost: 0.00001 } });
    if (failLuna) throw new Error('offline transport fault after dispatch');
    return Response.json({ choices: [{ message: { content: JSON.stringify(roleAnswer) } }],
      usage: { prompt_tokens: 20, completion_tokens: 4 } }); // actual cost intentionally unavailable
  }));
  return wire;
}

describe('paired contextual evaluation preparation (offline)', () => {
  it('runs the real normalizer with wire-visible identity and counts actual calls in both arms', async () => {
    const wire = installProvider();
    const treatment = await runTurn(corpus.cases[0], env, new AbortController().signal, 'jevFirst');
    const baseline = await runTurn(corpus.cases[0], env, new AbortController().signal, 'lunaOnly');
    expect(wire.map((record) => record.url)).toEqual([
      'https://openrouter.ai/api/alpha/decisions', 'https://api.openai.com/v1/chat/completions',
    ]);
    expect(wire[0].body.state.questionCode).toBe('quantity_role_unresolved');
    expect(wire[0].body.state).not.toHaveProperty('requestId');
    expect(treatment).toMatchObject({ lunaDispatches: 0, directRoleAccepted: true,
      catalogVersion: 'focused-contextual-answer-2026-10-04-v3', gateVersion: 'contextual-conservative-v2-calibrated',
      inputTokens: 10, actualCostUsd: 0.00001, jointCorrect: null });
    expect(treatment.semanticResult.document.tasks[0]).toMatchObject({ existingPublicId: 'task-synthetic',
      workloads: [{ localId: 'workload-question', quantityRole: 'target', amount: 14 }] });
    expect(baseline).toMatchObject({ lunaDispatches: 1, directRoleAccepted: false,
      inputTokens: 20, outputTokens: 4, actualCostUsd: null, jointCorrect: null });
  });

  it('includes generic fallback/repair and failures after actual dispatch in the turn count', async () => {
    const wire = installProvider('fallback', true);
    const record = await runTurn(corpus.cases[6], env, new AbortController().signal, 'jevFirst');
    const lunaCalls = wire.filter((item) => item.url.includes('/chat/completions'));
    expect(lunaCalls.length).toBeGreaterThan(0);
    expect(record.lunaDispatches).toBe(lunaCalls.length);
    expect(record.directRoleAccepted).toBe(false);
    expect(record.actualCostUsd).toBeNull();
    expect(record.inputTokens).toBeNull();
    expect(record.jointCorrect).toBeNull();
    expect(record.dispatches.filter((item) => item.provider === 'luna').every((item) => item.status === 'failed_after_dispatch')).toBe(true);
  });

  it('separates development groups and refuses implementation-authored holdout', () => {
    expect(validateCorpus(corpus, 'tuning')).toHaveLength(12);
    expect(validateCorpus(corpus, 'calibration')).toHaveLength(12);
    const leak = structuredClone(corpus);
    leak.cases[12].group = leak.cases[0].group;
    expect(() => validateCorpus(leak, 'tuning')).toThrow('Group crosses splits');
    expect(() => validateCorpus({ ...corpus, status: 'sealed_unconsumed',
      cases: corpus.cases.map((item) => ({ ...item, split: 'holdout' })),
      provenance: { ...corpus.provenance, tuningExposure: false, derivedFromConsumedHoldout: false } }, 'holdout')).toThrow();
  });

  it('refuses real execution approval without owner-registered thresholds and fingerprints', () => {
    const approval = { approved: true, owner: 'owner-fixture', approvedAt: '2026-10-04T00:00:00Z',
      environment: 'isolated_synthetic_evaluation', corpusSha256: 'corpus-fixture', split: 'tuning', worker: 'synthetic-eval',
      catalogVersion: 'focused-contextual-answer-2026-10-04-v3', gateVersion: 'contextual-conservative-v2-calibrated',
      runtimeSha256: 'a'.repeat(64), policySha256: 'b'.repeat(64), thresholds: {},
      executionLimits: { providerDispatchesPerTurn: 10, totalElapsedMs: 300000 }, inferenceProcedure: 'owner-fixture-procedure' };
    const binding = { corpusHash: 'corpus-fixture', split: 'tuning', worker: 'synthetic-eval' };
    expect(() => validateApproval(approval, binding)).toThrow('Owner must preregister');
    approval.thresholds = Object.fromEntries(REQUIRED_OWNER_THRESHOLDS.map((key) => [key, 1]));
    expect(() => validateApproval(approval, binding)).not.toThrow();
    expect(() => validateApproval(approval, { ...binding, corpusHash: 'changed' })).toThrow();
  });

  it('keeps missing usage NA in legacy diagnostics and paired summaries', () => {
    expect(observedTotal([12, null])).toBeNull();
    expect(observedTotal([12, undefined])).toBeNull();
    expect(observedTotal([])).toBe(0);
    const legacy = [{ split: 'tuning', group: 'g', lunaCalled: true, lunaPromptTokens: null,
      lunaCompletionTokens: 3, jevInputTokens: undefined, jevOutputTokens: 2, jevCostUsd: undefined }];
    expect(summarize(legacy).jevUsage).toMatchObject({ inputTokens: null, reportedCostUsd: null });
    expect(summarizeLunaBaseline(legacy).usage.promptTokens).toBeNull();
    expect(summarizeLunaBaseline([{}]).usage.promptTokens).toBeNull();
    const complete = { group: 'g', observationComplete: true, questionCode: 'quantity_role_unresolved',
      lunaDispatches: 0, directRoleAccepted: true, jointCorrect: null, elapsedMs: 7,
      inputTokens: null, outputTokens: 2, actualCostUsd: null };
    const pairs = [{ caseId: 'case-fixture', group: 'g', labelSource: 'synthetic_unreviewed',
      jevFirst: { ...complete }, lunaOnly: { ...complete, lunaDispatches: 2, directRoleAccepted: false } }];
    const summary = summarizePairs(pairs);
    expect(summary.pairedLunaDispatchDifferencePerTurn).toBe(-2);
    expect(summary.jevFirst.jointFalseAcceptance.rate).toBeNull();
    expect(summary.jevFirst.usage.inputTokens).toBeNull();
    expect(summary.jevFirst.usage.actualCostUsd).toBeNull();
    const incomplete = summarizePairs(pairs, { cases: [corpus.cases[0], corpus.cases[1]] });
    expect(incomplete.denominator).toBe(2);
    expect(incomplete.jevFirst.lunaDispatchesPerTurn).toBeNull();
    expect(incomplete.pairedLunaDispatchDifferencePerTurn).toBeNull();
    applyJointLabels(pairs, [{ caseId: 'case-fixture', arm: 'jevFirst', correct: false,
      source: 'synthetic_unreviewed', independent: false, reviewer: 'fixture-reviewer', rationale: 'Additional scope was dropped.' }]);
    const judged = summarizePairs(pairs);
    expect(judged.jevFirst.jointFalseAcceptance).toMatchObject({ count: 1, rate: 1 });
    expect(clopperPearsonUpper95(0, 10)).toBeCloseTo(1 - 0.05 ** 0.1, 8);
    expect(() => applyJointLabels(pairs, [{ caseId: 'unknown', arm: 'jevFirst' }])).toThrow();
  });

  it.each(['missing pair', 'missing arm', 'incomplete observation'])(
    'reports full-denominator correctness as unknown with %s', (failure) => {
      const record = { group: 'g', observationComplete: true, questionCode: 'quantity_role_unresolved',
        lunaDispatches: 0, directRoleAccepted: true, jointCorrect: true, elapsedMs: 5,
        inputTokens: 1, outputTokens: 1, actualCostUsd: 0.001 };
      const first = { caseId: 'a', group: 'g', labelSource: 'synthetic_unreviewed', jevFirst: { ...record }, lunaOnly: { ...record } };
      const second = { caseId: 'b', group: 'h', labelSource: 'synthetic_unreviewed', jevFirst: { ...record, group: 'h' }, lunaOnly: { ...record, group: 'h' } };
      const pairs = failure === 'missing pair' ? [first] : [first, second];
      if (failure === 'missing arm') delete second.jevFirst;
      if (failure === 'incomplete observation') second.jevFirst.observationComplete = false;
      const summary = summarizePairs(pairs, { cases: [{ id: 'a', group: 'g', questionCode: 'quantity_role_unresolved' },
        { id: 'b', group: 'h', questionCode: 'quantity_role_unresolved' }] });
      expect(summary.denominator).toBe(2);
      expect(summary.jevFirst).toMatchObject({ observationComplete: false, unobservedTurns: 1,
        jointJudgedTurns: 1, jointUnknownTurns: 1, jointCorrectness: null,
        rawDispatchFreeRate: null, correctResolutionAndFreeRate: null, lunaDispatchesPerTurn: null,
        d1DirectAcceptance: { denominator: 2, rate: null }, jointFalseAcceptance: { rate: null } });
      expect(summary.pairedLunaDispatchDifferencePerTurn).toBeNull();
    },
  );
});
