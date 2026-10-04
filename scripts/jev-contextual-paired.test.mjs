import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPairedWorkerSource } from './jev-contextual-paired-runtime.mjs';
import { applyJointLabels, REQUIRED_OWNER_THRESHOLDS, sha256, validateApproval, validateCorpus } from './jev-contextual-paired-eval.mjs';
import { PAIRED_ARTIFACT_SCHEMA } from './jev-contextual-paired-artifact.mjs';
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

describe('paired artifact summarize CLI (offline)', () => {
  let directory;
  let artifact;
  let sequence = 0;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'polarwatt-contextual-import-'));
    installProvider();
    const pairs = [];
    // Use actual producer outputs with mocked fetch, rather than inventing a
    // second expected arm schema that could drift from the evaluation runtime.
    for (const [index, item] of validateCorpus(corpus, 'tuning').entries()) {
      pairs.push({ caseId: item.id, group: item.group, labelSource: item.labelSource,
        order: index % 2 ? ['lunaOnly', 'jevFirst'] : ['jevFirst', 'lunaOnly'],
        jevFirst: await runTurn(item, env, new AbortController().signal, 'jevFirst'),
        lunaOnly: await runTurn(item, env, new AbortController().signal, 'lunaOnly') });
    }
    artifact = { schemaVersion: PAIRED_ARTIFACT_SCHEMA, corpusVersion: corpus.version,
      corpusHash: sha256(await readFile(resolve(root, 'scripts/jev-contextual-development-corpus.json'))),
      runtimeSha256: 'a'.repeat(64), policySha256: 'b'.repeat(64), split: 'tuning',
      attemptedAt: '2026-10-04T00:00:00.000Z', status: 'awaiting_joint_review',
      expectedTurns: pairs.length, summary: { untrusted: 'cached summary must never supply measurements' }, pairs };
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  });
  afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

  async function summarizeArtifact(value, labels) {
    const path = join(directory, 'artifact-' + sequence++ + '.json');
    await writeFile(path, JSON.stringify(value));
    const args = [resolve(root, 'scripts/jev-contextual-paired-eval.mjs'), '--summarize', '--results', path];
    if (labels) {
      const reviewPath = path + '.review';
      await writeFile(reviewPath, JSON.stringify(labels));
      args.push('--labels', reviewPath);
    }
    return spawnSync(process.execPath, args, { encoding: 'utf8', cwd: root, timeout: 10000 });
  }

  it('accepts actual producer records with explicit historical hashes and preserves NA usage', async () => {
    const result = await summarizeArtifact(artifact);
    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary).toMatchObject({ status: 'HOLD', denominator: 12,
      artifact: { schemaVersion: PAIRED_ARTIFACT_SCHEMA, runtimeSha256: 'a'.repeat(64), policySha256: 'b'.repeat(64) } });
    expect(summary.lunaOnly.lunaDispatches).toBe(artifact.pairs.reduce((sum, pair) => sum + pair.lunaOnly.lunaDispatches, 0));
    expect(summary.lunaOnly.usage.actualCostUsd).toBeNull();
    expect(summary.jevFirst.jointCorrectness).toBeNull();
  });

  it('recognizes fully framed legacy artifacts without substituting current provenance', async () => {
    const legacy = structuredClone(artifact);
    delete legacy.schemaVersion;
    const result = await summarizeArtifact(legacy);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).artifact).toMatchObject({ schemaVersion: 'legacy_unversioned_v0',
      runtimeSha256: legacy.runtimeSha256, policySha256: legacy.policySha256 });
  });

  it.each([
    ['unknown provider', (a) => { a.pairs[0].jevFirst.dispatches[0].provider = 'unrecognized'; }],
    ['missing provider', (a) => { delete a.pairs[0].jevFirst.dispatches[0].provider; }],
    ['missing dispatch usage', (a) => { delete a.pairs[0].jevFirst.dispatches[0].inputTokens; }],
    ['unknown dispatch field', (a) => { a.pairs[0].jevFirst.dispatches[0].synthetic = true; }],
    ['unknown dispatch status', (a) => { a.pairs[0].jevFirst.dispatches[0].status = 'fake'; }],
    ['coerced HTTP status', (a) => { a.pairs[0].lunaOnly.dispatches[0].status = ['http_500']; }],
    ['unfinished complete dispatch', (a) => { a.pairs[0].jevFirst.dispatches[0].status = 'dispatched'; }],
    ['missing phase', (a) => { delete a.pairs[0].jevFirst.dispatches[0].phase; }],
    ['invalid dispatches framing', (a) => { a.pairs[0].jevFirst.dispatches = {}; }],
    ['invalid pairs framing', (a) => { a.pairs = {}; }],
    ['unknown schema version', (a) => { a.schemaVersion = 'unknown-v2'; }],
    ['missing corpus version', (a) => { delete a.corpusVersion; }],
    ['invalid runtime hash', (a) => { a.runtimeSha256 = 'fixture-audit-invalid-provider'; }],
    ['missing runtime hash', (a) => { delete a.runtimeSha256; }],
    ['invalid policy hash', (a) => { a.policySha256 = 'bad'; }],
    ['missing policy hash', (a) => { delete a.policySha256; }],
    ['wrong corpus hash', (a) => { a.corpusHash = 'c'.repeat(64); }],
    ['missing timestamp', (a) => { delete a.attemptedAt; }],
    ['wrong registered denominator', (a) => { a.expectedTurns -= 1; }],
    ['unknown framing field', (a) => { a.synthetic = true; }],
    ['unknown arm field', (a) => { a.pairs[0].jevFirst.synthetic = true; }],
    ['wrong case identity', (a) => { a.pairs[0].jevFirst.caseId = a.pairs[1].caseId; }],
    ['wrong group identity', (a) => { a.pairs[0].jevFirst.group = a.pairs[1].group; }],
    ['wrong arm identity', (a) => { a.pairs[0].jevFirst.arm = 'lunaOnly'; }],
    ['wrong question identity', (a) => { a.pairs[0].jevFirst.questionCode = 'missing_effort_estimate'; }],
    ['wrong catalog version', (a) => { a.pairs[0].jevFirst.catalogVersion = 'unknown'; }],
    ['wrong gate version', (a) => { a.pairs[0].jevFirst.gateVersion = 'unknown'; }],
    ['duplicate pair', (a) => { a.pairs[1] = a.pairs[0]; }],
    ['invalid pair order', (a) => { a.pairs[0].order = ['jevFirst', 'jevFirst']; }],
    ['missing completeness', (a) => { delete a.pairs[0].jevFirst.observationComplete; }],
    ['nonboolean completeness', (a) => { a.pairs[0].jevFirst.observationComplete = 'true'; }],
    ['false complete status', (a) => { a.pairs.pop(); }],
    ['wrong Luna count', (a) => { a.pairs[0].lunaOnly.lunaDispatches = 0; }],
    ['unknown usage claimed as zero', (a) => { a.pairs[0].lunaOnly.actualCostUsd = 0; }],
    ['fractional tokens', (a) => { a.pairs[0].jevFirst.dispatches[0].inputTokens = 0.5; }],
    ['negative elapsed time', (a) => { a.pairs[0].jevFirst.elapsedMs = -1; }],
    ['missing semantic result', (a) => { delete a.pairs[0].jevFirst.semanticResult; }],
    ['unknown semantic status', (a) => { a.pairs[0].jevFirst.semanticResult.status = 'synthetic'; }],
    ['accepted without document', (a) => { a.pairs[0].jevFirst.semanticResult.document = null; }],
    ['wrong semantic schema', (a) => { a.pairs[0].jevFirst.semanticResult.document.schemaVersion = 'v4'; }],
    ['unproven joint correctness', (a) => { a.pairs[0].jevFirst.jointCorrect = true; }],
    ['inconsistent direct acceptance', (a) => { a.pairs[0].jevFirst.directRoleAccepted = false; }],
    ['Jev in Luna-only', (a) => { a.pairs[0].lunaOnly.dispatches[0] = a.pairs[0].jevFirst.dispatches[0]; a.pairs[0].lunaOnly.lunaDispatches = 0;
      a.pairs[0].lunaOnly.inputTokens = 10; a.pairs[0].lunaOnly.outputTokens = 3; a.pairs[0].lunaOnly.actualCostUsd = 0.00001; }],
  ])('refuses %s before emitting measurement numbers', async (_name, mutate) => {
    const changed = structuredClone(artifact);
    mutate(changed);
    const result = await summarizeArtifact(changed);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Paired evaluation refused or incomplete');
  });

  it.each(['missing pair', 'missing arm', 'incomplete observation'])('preserves the full denominator and NA for %s through CLI', async (failure) => {
    const partial = structuredClone(artifact);
    partial.status = 'incomplete_HOLD';
    if (failure === 'missing pair') partial.pairs.pop();
    if (failure === 'missing arm') delete partial.pairs.at(-1).jevFirst;
    if (failure === 'incomplete observation') partial.pairs.at(-1).jevFirst.observationComplete = false;
    const result = await summarizeArtifact(partial);
    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary.denominator).toBe(12);
    expect(summary.jevFirst).toMatchObject({ observationComplete: false, unobservedTurns: 1,
      jointCorrectness: null, rawDispatchFreeRate: null, lunaDispatchesPerTurn: null, usage: { inputTokens: null, actualCostUsd: null } });
    expect(summary.pairedLunaDispatchDifferencePerTurn).toBeNull();
  });

  it('refuses malformed joint review without dropping its intended labels', async () => {
    const result = await summarizeArtifact(artifact, { corpusHash: artifact.corpusHash,
      runtimeSha256: artifact.runtimeSha256 });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
  });

  it('counts failed dispatches and preserves missing usage through CLI', async () => {
    const failed = structuredClone(artifact);
    const record = failed.pairs[0].lunaOnly;
    for (const dispatch of record.dispatches) Object.assign(dispatch,
      { status: 'failed_after_dispatch', inputTokens: null, outputTokens: null, costUsd: null });
    Object.assign(record, { inputTokens: null, outputTokens: null, actualCostUsd: null,
      semanticResult: { status: 'provider_failure', document: null, contextualDirective: null, validationErrors: [] } });
    const result = await summarizeArtifact(failed);
    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary.lunaOnly.lunaDispatches).toBe(artifact.pairs.reduce((sum, pair) => sum + pair.lunaOnly.lunaDispatches, 0));
    expect(summary.lunaOnly).toMatchObject({ rawDispatchFreeRate: 0, usage: { inputTokens: null, outputTokens: null, actualCostUsd: null } });
  });

  it('allows a genuinely observed pre-dispatch failure to have zero calls without claiming correctness', async () => {
    const noCalls = structuredClone(artifact);
    noCalls.pairs[0].lunaOnly = await runTurn(corpus.cases[0], {}, new AbortController().signal, 'lunaOnly');
    expect(noCalls.pairs[0].lunaOnly).toMatchObject({ dispatches: [], lunaDispatches: 0,
      inputTokens: 0, outputTokens: 0, actualCostUsd: 0, semanticResult: { status: 'provider_failure' } });
    const result = await summarizeArtifact(noCalls);
    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary.lunaOnly.rawDispatchFreeRate).toBe(1 / 12);
    expect(summary.lunaOnly.correctResolutionAndFreeRate).toBeNull();
    expect(summary.lunaOnly.jointCorrectness).toBeNull();
  });

  it('joins explicit whole-turn review provenance against the historical runtime', async () => {
    const labels = artifact.pairs.flatMap((pair) => ['jevFirst', 'lunaOnly'].map((arm) => ({
      caseId: pair.caseId, arm, correct: true, source: 'synthetic_unreviewed', independent: false,
      reviewer: 'offline-fixture-reviewer', rationale: 'Offline fixture label, not independent evidence.' })));
    const result = await summarizeArtifact(artifact, { corpusHash: artifact.corpusHash,
      runtimeSha256: artifact.runtimeSha256, labels });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'HOLD',
      jevFirst: { jointCorrectness: 1 }, lunaOnly: { jointCorrectness: 1 } });
    const wrong = await summarizeArtifact(artifact, { corpusHash: artifact.corpusHash, runtimeSha256: 'c'.repeat(64), labels });
    expect(wrong.status).toBe(1);
    expect(wrong.stdout).toBe('');
  });
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

  it('refuses known exposed holdout authors even if the input claims no tuning exposure', () => {
    const holdout = { ...corpus, status: 'sealed_unconsumed',
      cases: corpus.cases.map((item) => ({ ...item, split: 'holdout' })),
      provenance: { ...corpus.provenance, tuningExposure: false, derivedFromConsumedHoldout: false } };
    for (const agent of ['PolarWatt', 'CopperHopper']) {
      holdout.provenance.generator = { ...corpus.provenance.generator, agent };
      expect(() => validateCorpus(holdout, 'holdout')).toThrow('Known development corpus viewers');
    }
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
