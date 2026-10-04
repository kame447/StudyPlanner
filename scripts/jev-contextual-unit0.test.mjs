import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { BOOTSTRAP_SEED, CENSUS_BOOTSTRAP_SEED, EXECUTION_ORDER_SEED, bootstrapReplicates, createXoshiro128StarStar,
  executionOrder, seedWords } from './jev-contextual-unit0-random.mjs';
import { ConsumptionLedger, PREREGISTERED_LIMITS, PREREGISTERED_PRICING, classifyAttempt, reservePerCallUsd,
  validateLimits } from './jev-contextual-unit0-budget.mjs';
import { DECISION_RULES, evaluateUnit0, nearestRank } from './jev-contextual-unit0-decision.mjs';
import { DRY_RUN_LABEL_SOURCE, R2_LABEL_SOURCE, REVIEW_SCHEMA, canonicalJson, createBlindPacket, importBlindReview,
  sha256Text, validateLabelProvenance } from './jev-contextual-unit0-review.mjs';
import { DEVELOPMENT_CORPUS_SHA256, DURABLE_PERSISTENCE, EXECUTION_PATH, IN_PROCESS_DIRECTORY, ROSTER_SPEC, createWorkerTransport,
  productionSnapshot, runSerialEvaluation, runTerminalValidity, segmentWranglerConfig, unstableDevOptions, SMOKE_LIMITS, buildRoster, buildWorkerBundle, loadBundleInProcess, preSendFor, realRun,
  recordConsumptionAttempt, smokeCases, smokeRun, validateApprovalR2, workerCases, writeSegmentFiles } from './jev-contextual-unit0-eval.mjs';
import { DRY_RUN_PRICING, buildMockSets, createInProcessTransport, runDryRun } from './jev-contextual-unit0-dry-run.mjs';
import { runtimeFingerprint, sha256 } from './jev-contextual-paired-eval.mjs';

// Reference vectors computed independently by the external auditor and the
// parent (two Python implementations of preregistration §14, xoshiro128** 1.1
// checked against the author's reference C). Holdout content was not used.
const REFERENCE = {
  [EXECUTION_ORDER_SEED]: { words: [2336172142, 3160872934, 2473256179, 570587217],
    first10: [261732879, 2018136170, 582715785, 1067988100, 2160905018, 4281305351, 394586609, 2233301468, 1563481146, 3112970285] },
  [BOOTSTRAP_SEED]: { words: [1986455186, 2911928820, 3379279310, 3072764488],
    first10: [862712761, 3741566366, 4059900592, 2400358839, 1335740024, 1369110191, 4025629017, 1201841783, 2814269012, 759538672] },
  [CENSUS_BOOTSTRAP_SEED]: { words: [2880090792, 1089261937, 579461245, 4023788640],
    first10: [3496505266, 3172068920, 222532698, 2499666478, 677103084, 2071857059, 511931924, 2760286072, 3910551665, 2895547695] },
  orderFirst20: [3, 34, 69, 70, 55, 85, 121, 73, 10, 8, 32, 54, 30, 103, 47, 57, 127, 93, 46, 36],
  orderLast10: [87, 44, 125, 11, 124, 63, 31, 17, 60, 7],
  replicate1B: [6, 26, 28, 16, 9, 9, 28, 8, 19, 5, 18, 12, 15, 7, 18, 23, 26, 3, 25, 27, 10, 29, 21, 17, 17, 28, 8, 26, 9, 14],
  replicate1C: [26, 8, 32, 17, 1, 12, 31, 4, 22, 26, 13, 1, 11, 5, 16, 28, 23, 21, 29, 2, 0, 16, 32, 19, 31, 9, 4, 14, 27, 29, 15, 17, 21, 25, 33],
  zeroHarmUpper65: 0.045042258123013545,
};
// Read-only production snapshot stand-in: identical output before and after.
const fixedSnapshot = async (args) => JSON.stringify({ fixture: args.slice(0, 2) });
const freshRunState = () => ({ attempts: 0, infrastructureFailures: 0, consecutiveInfrastructureFailures: 0 });
const caseName = (n) => 'case-' + String(n).padStart(3, '0');

describe('preregistered random conventions (known answers)', () => {
  it.each([EXECUTION_ORDER_SEED, BOOTSTRAP_SEED, CENSUS_BOOTSTRAP_SEED])('matches seed words and first outputs for %s', (seed) => {
    expect(seedWords(seed)).toEqual(REFERENCE[seed].words);
    const random = createXoshiro128StarStar(seed);
    expect(Array.from({ length: 10 }, () => random.next())).toEqual(REFERENCE[seed].first10);
  });

  it('matches the Fisher–Yates execution order and alternates AB/BA by shuffled position', () => {
    const order = executionOrder(Array.from({ length: 130 }, (_, i) => caseName(129 - i)));
    expect(order.slice(0, 20).map((entry) => entry.caseId)).toEqual(REFERENCE.orderFirst20.map(caseName));
    expect(order.slice(-10).map((entry) => entry.caseId)).toEqual(REFERENCE.orderLast10.map(caseName));
    expect(order[0].arms).toEqual(['jevFirst', 'lunaOnly']);
    expect(order[1].arms).toEqual(['lunaOnly', 'jevFirst']);
    expect(() => executionOrder(['a', 'a'])).toThrow();
  });

  it('matches bootstrap replicate 1 (B 30 draws first, then C 35) and the 65-group zero-harm bound', () => {
    const [first] = bootstrapReplicates({ strata: [{ groupCount: 30 }, { groupCount: 35 }], replicates: 1 });
    expect(first).toEqual([REFERENCE.replicate1B, REFERENCE.replicate1C]);
    expect(1 - 0.05 ** (1 / 65)).toBe(REFERENCE.zeroHarmUpper65);
  });

  it('uses nearest-rank percentiles', () => {
    expect(nearestRank([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(nearestRank([1, 2, 3, 4], 0.5)).toBe(2);
    expect(nearestRank(Array.from({ length: 20 }, (_, i) => i + 1), 0.95)).toBe(19);
  });
});

// Minimal measured records; fields mirror the validated arm record.
// Each Luna dispatch carries usage under the frozen standard tariff.
function arm({ luna = 1, elapsed = 100, usage = { input: 1_000, output: 100 }, direct = false } = {}) {
  const dispatches = Array.from({ length: luna }, () => ({ provider: 'luna', phase: 'p', status: 'success', outcome: 'response',
    httpStatus: null, servedModel: 'gpt-5.6-luna', serviceTier: 'default', inputTokens: usage.input, outputTokens: usage.output, costUsd: null }));
  return { observationComplete: true, lunaDispatches: luna, elapsedMs: elapsed, actualCostUsd: null,
    directRoleAccepted: direct, dispatches };
}
function syntheticRoster(groupsB, groupsC) {
  const cases = [];
  const strata = [['B', groupsB], ['C', groupsC]].map(([id, count]) => ({ id, groups: Array.from({ length: count }, (_, g) => {
    const group = `${id}-g${String(g).padStart(2, '0')}`;
    const caseIds = [0, 1].map((v) => `${group}-${v}`);
    caseIds.forEach((caseId, v) => cases.push({ id: caseId, group, stratum: id,
      questionCode: v === 0 ? 'quantity_role_unresolved' : 'missing_effort_estimate' }));
    return { id: group, caseIds };
  }) }));
  return { strata, cases };
}
function scenario(roster, { jev = {}, luna = {}, labels = {} } = {}) {
  const pairs = new Map(roster.cases.map((item) => [item.id, {
    jevFirst: arm(typeof jev === 'function' ? jev(item) : jev), lunaOnly: arm(typeof luna === 'function' ? luna(item) : luna) }]));
  const labelMap = new Map(roster.cases.flatMap((item) => ['jevFirst', 'lunaOnly'].map((name) => {
    const custom = labels[item.id + ':' + name];
    return [item.id + ':' + name, custom === undefined ? { correct: true, criticalErrors: [] } : custom];
  })));
  return { pairs, labels: labelMap };
}
const decide = (roster, input) => evaluateUnit0({ roster, ...input, replicates: 2_000, dryRun: true, runTerminal: { status: 'PASS' } });

describe('decision computation (preregistration §2–§5, §9–§12)', () => {
  const roster = syntheticRoster(30, 35);
  // Output-only usage makes the upper and lower bounds coincide, so a real
  // saving can pass the bound-based cost gate (identical input usage cannot:
  // the asymmetric bounds are deliberately conservative).
  const outputOnly = { input: 0, output: 100 };
  const saving = { jev: (item) => ({ luna: item.questionCode === 'quantity_role_unresolved' ? 0 : 1, usage: outputOnly }),
    luna: { usage: outputOnly } };

  it('all concordant with a real saving passes every research gate but never adoption', () => {
    const result = decide(roster, scenario(roster, saving));
    expect(result.gates.nonInferiority).toMatchObject({ status: 'PASS', harmedGroups: 0, groups: 65,
      upperMeanHarmRate: REFERENCE.zeroHarmUpper65 });
    expect(result.gates.dispatchReduction).toMatchObject({ status: 'PASS', d1: { point: 1, lower95: 1 }, allTurns: { point: 0.5 } });
    expect(result.researchGates).toBe('PASS');
    expect(result).toMatchObject({ adoption: 'HOLD', production: 'not_authorized' });
  });

  it('all-zero dispatch differences give lower bound 0: overall non-regression holds, D1 usefulness fails', () => {
    const result = decide(roster, scenario(roster));
    expect(result.gates.dispatchReduction).toMatchObject({ status: 'FAIL',
      d1: { point: 0, lower95: 0, pass: false }, allTurns: { point: 0, lower95: 0, pass: true } });
    // No saving: latency/cost caps collapse to zero; equal values still pass.
    expect(result.gates.latency).toMatchObject({ tradeoffAllowed: false, p50: { cap: 0, excessPoint: 0, pass: true } });
  });

  it('one harmed group is HOLD; the general Clopper–Pearson bound is descriptive only', () => {
    const input = scenario(roster, { ...saving, labels: { 'C-g07-1:jevFirst': { correct: false, criticalErrors: [] } } });
    const result = decide(roster, input);
    expect(result.gates.nonInferiority).toMatchObject({ status: 'FAIL', harmedGroups: 1, upperMeanHarmRate: null,
      strata: { B: { harmedGroups: 0 }, C: { harmedGroups: 1 } } });
    expect(result.gates.nonInferiority.descriptive.clopperPearsonUpperSameP).toBeGreaterThan(0.05);
    expect(result.researchGates).toBe('HOLD');
  });

  it('all harmed groups fail; a baseline error does not excuse the treatment', () => {
    const labels = Object.fromEntries(roster.cases.map((item) => [item.id + ':jevFirst', { correct: false, criticalErrors: ['target_scope_error'] }]));
    const result = decide(roster, scenario(roster, { ...saving, labels }));
    expect(result.gates.nonInferiority).toMatchObject({ harmedGroups: 65 });
    expect(result.gates.criticalErrors.strata.B.jevFirstFinalCritical).toBe(60);
    const bothWrong = Object.fromEntries(roster.cases.flatMap((item) => ['jevFirst', 'lunaOnly']
      .map((name) => [item.id + ':' + name, { correct: false, criticalErrors: ['mixed_meaning_loss'] }])));
    const shared = decide(roster, scenario(roster, { ...saving, labels: bothWrong }));
    expect(shared.gates.nonInferiority.harmedGroups).toBe(0);
    expect(shared.gates.criticalErrors).toMatchObject({ status: 'FAIL', strata: { C: { lunaOnlyFinalCritical: 70 } } });
  });

  it('counts a fallback-path critical error and a direct joint false acceptance separately per set', () => {
    const fallback = decide(roster, scenario(roster, { ...saving,
      labels: { 'B-g00-1:jevFirst': { correct: false, criticalErrors: ['stale_acceptance'] }, 'B-g00-1:lunaOnly': { correct: false, criticalErrors: [] } } }));
    expect(fallback.gates.criticalErrors.strata).toMatchObject({ B: { jevFirstFinalCritical: 1, jevFirstDirectJointFalseAcceptance: 0 },
      C: { jevFirstFinalCritical: 0 } });
    const direct = decide(roster, scenario(roster, { jev: (item) => ({ luna: 0, direct: item.id === 'C-g03-0' }),
      labels: { 'C-g03-0:jevFirst': { correct: false, criticalErrors: [] }, 'C-g03-0:lunaOnly': { correct: false, criticalErrors: [] } } }));
    expect(direct.gates.criticalErrors).toMatchObject({ status: 'FAIL', strata: { C: { jevFirstDirectJointFalseAcceptance: 1 } } });
  });

  it('a missing label or observation keeps the gate unknown instead of dropping the case', () => {
    const missingLabel = decide(roster, scenario(roster, { ...saving, labels: { 'B-g05-0:lunaOnly': null } }));
    expect(missingLabel.gates.nonInferiority).toMatchObject({ status: 'UNKNOWN', unknownGroups: 1 });
    expect(missingLabel.gates.criticalErrors.status).toBe('PASS'); // Jev-first labels complete; Luna-only reported null
    expect(missingLabel.gates.criticalErrors.strata.B.lunaOnlyFinalCritical).toBeNull();
    expect(missingLabel.gates.completeness.status).toBe('UNKNOWN');
    const input = scenario(roster, saving);
    input.pairs.get('C-g01-1').jevFirst.observationComplete = false;
    const missingObservation = decide(roster, input);
    expect(missingObservation.gates).toMatchObject({ dispatchReduction: { status: 'UNKNOWN' }, latency: { status: 'UNKNOWN' },
      cost: { status: 'UNKNOWN' } });
    expect(missingObservation.researchGates).toBe('HOLD');
  });

  it('weights by case count across unequal strata and reports B and C separately', () => {
    const small = syntheticRoster(3, 7);
    const result = decide(small, scenario(small, { jev: (item) => ({ luna: item.stratum === 'B' ? 0 : 1 }) }));
    expect(result.gates.dispatchReduction.byStratum).toEqual({ B: { cases: 6, point: 1 }, C: { cases: 14, point: 0 } });
    expect(result.gates.dispatchReduction.allTurns.point).toBeCloseTo(6 / 20, 12);
    expect(result.gates.nonInferiority.upperMeanHarmRate).toBeCloseTo(1 - 0.05 ** (1 / 10), 12);
    expect(result.gates.nonInferiority.status).toBe('FAIL'); // 10 groups cannot certify 5%
  });

  it('a D1 stratum absent from the sample is minus infinity, never a silent pass', () => {
    const noD1 = syntheticRoster(2, 2);
    noD1.cases.forEach((item) => { item.questionCode = 'missing_effort_estimate'; });
    const result = decide(noD1, scenario(noD1));
    expect(result.gates.dispatchReduction.d1).toMatchObject({ cases: 0, point: null, lowerIsNegativeInfinity: true, pass: false });
  });

  it('zero baselines allow no latency or cost increase, and missing usage or another tariff is HOLD not zero', () => {
    const zero = decide(roster, scenario(roster, { jev: (item) => ({ luna: item.questionCode === 'quantity_role_unresolved' ? 0 : 1, elapsed: 1 }),
      luna: { elapsed: 0, usage: { input: 0, output: 0 } } }));
    expect(zero.gates.latency).toMatchObject({ status: 'FAIL', tradeoffAllowed: true, p50: { cap: 0, pass: false } });
    expect(zero.gates.cost).toMatchObject({ status: 'FAIL', cap: 0, lunaOnlyLowerBoundMeanUsd: 0 });
    // Jev-first upper bound vs Luna-only lower bound on identical usage: the
    // cache-read lower bound makes the same calls look cheaper for the baseline.
    const same = decide(roster, scenario(roster));
    const output = 100 * 1.2 / 1e6;
    expect(same.gates.cost).toMatchObject({ status: 'FAIL', tradeoffAllowed: false });
    expect(same.gates.cost.jevFirstUpperBoundMeanUsd).toBeCloseTo(1_000 * 0.25 / 1e6 + output, 12);
    expect(same.gates.cost.lunaOnlyLowerBoundMeanUsd).toBeCloseTo(1_000 * 0.02 / 1e6 + output, 12);
    // A genuinely observed zero-dispatch arm costs zero; no response is required.
    const free = decide(roster, scenario(roster, saving));
    expect(free.gates.cost.status).not.toBe('UNKNOWN');
    const withinCap = decide(roster, scenario(roster, { jev: (item) => ({ luna: item.questionCode === 'quantity_role_unresolved' ? 0 : 1,
      elapsed: 1_100, usage: outputOnly }), luna: { elapsed: 1_000, usage: outputOnly } }));
    expect(withinCap.gates.cost.status).toBe('PASS'); // D1 turns avoid Luna entirely
    expect(withinCap.gates.latency).toMatchObject({ status: 'PASS', p50: { cap: 100, excessPoint: 0 } });
    const input = scenario(roster, saving);
    input.pairs.get('B-g00-0').lunaOnly.dispatches[0].outputTokens = null;
    const missing = decide(roster, input);
    expect(missing.gates.cost).toMatchObject({ status: 'UNKNOWN', reason: 'usage_or_tariff_unverifiable', missingArmRecords: 1 });
    const tier = scenario(roster, saving);
    tier.pairs.get('C-g02-1').jevFirst.dispatches[0].serviceTier = 'priority';
    expect(decide(roster, tier).gates.cost.status).toBe('UNKNOWN');
    for (const missing of ['inputTokens', 'outputTokens']) {
      const reported = scenario(roster, saving);
      reported.pairs.get('B-g03-0').jevFirst.dispatches.push({ provider: 'jev', phase: 'focused', status: 'evaluated', outcome: 'response',
        httpStatus: null, servedModel: 'typesafe/jev-1.13', serviceTier: null, inputTokens: 900, outputTokens: 4, costUsd: 0.00001, [missing]: null });
      expect(decide(roster, reported).gates.cost.status).toBe('UNKNOWN');
    }
    const model = scenario(roster, saving);
    model.pairs.get('C-g02-1').lunaOnly.dispatches[0].servedModel = 'gpt-5.6-sol';
    expect(decide(roster, model).gates.cost.status).toBe('UNKNOWN');
  });

  it('the real decision refuses replicate counts other than the preregistered 20,000', () => {
    const input = scenario(roster, saving);
    expect(() => evaluateUnit0({ roster, ...input, replicates: 2_000, runTerminal: { status: 'PASS' } })).toThrow('preregistered');
    expect(() => evaluateUnit0({ roster, ...input, replicates: 2_000, dryRun: true })).toThrow('terminal');
    expect(evaluateUnit0({ roster, ...input, replicates: 2_000, dryRun: true, runTerminal: { status: 'FAIL', failures: ['stop_x'] } }))
      .toMatchObject({ researchGates: 'HOLD', failing: expect.arrayContaining(['runTerminal:FAIL']) });
    expect(DECISION_RULES.bootstrapReplicates).toBe(20_000);
  });
});

describe('execution budget, attempt taxonomy and ledger', () => {
  let directory;
  beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), 'unit0-r2-ledger-')); });
  afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

  it('classifies attempts symmetrically: 5xx/429/408/network/timeout are infrastructure, other 4xx stop', () => {
    const http = (httpStatus) => classifyAttempt({ outcome: 'http_failure', httpStatus });
    expect([500, 503, 429, 408].map(http)).toEqual(['infra', 'infra', 'infra', 'infra']);
    expect([400, 401, 403, 404, 302].map(http)).toEqual(['config', 'config', 'config', 'config', 'config']);
    expect(classifyAttempt({ outcome: 'timeout' })).toBe('infra');
    expect(classifyAttempt({ outcome: 'network_failure' })).toBe('infra');
    expect(classifyAttempt({ outcome: 'model_mismatch' })).toBe('config');
    expect(classifyAttempt({ outcome: 'invalid_response' })).toBe('invalid');
    expect(() => classifyAttempt({ outcome: 'http_failure', httpStatus: null })).toThrow();
  });

  it('refuses non-preregistered limits for real runs and only tightening in dry-runs', () => {
    expect(() => validateLimits({ ...PREREGISTERED_LIMITS, totalBudgetUsd: 6 }, { dryRun: false })).toThrow('differs');
    expect(() => validateLimits({ ...PREREGISTERED_LIMITS, totalBudgetUsd: 6 }, { dryRun: true })).toThrow('tighten');
    expect(validateLimits({ ...PREREGISTERED_LIMITS, totalDispatches: 40 }, { dryRun: true }).totalDispatches).toBe(40);
    expect(PREREGISTERED_LIMITS).toEqual({ normalizerTurns: 260, totalBudgetUsd: 5, totalDispatches: 2080,
      dispatchesPerTurn: 8, totalElapsedMs: 5_400_000, maxProviderFailureRate: 0.2 });
  });

  const pricing = { ...PREREGISTERED_PRICING, source: 'test copy of §19a' };
  const settled = (outcomes) => ({ dispatches: outcomes.map((outcome) => typeof outcome === 'number'
    ? { provider: 'luna', phase: 'p', status: 'http_' + outcome, outcome: 'http_failure', httpStatus: outcome,
      servedModel: null, serviceTier: null, inputTokens: null, outputTokens: null, costUsd: null }
    : { provider: 'luna', phase: 'p', status: 'success', outcome, httpStatus: null, servedModel: 'gpt-5.6-luna', serviceTier: 'default',
      inputTokens: 1_000, outputTokens: 100, costUsd: null }),
  preSend: { reservedUsd: outcomes.length * 0.01, reservations: outcomes.map(() => 0.01), refusedSends: 0 }, elapsedMs: 5 });
  const ledgerFor = (limits = PREREGISTERED_LIMITS) => new ConsumptionLedger(null, { limits, pricing });

  it('stops on five consecutive infrastructure failures before 20 attempts, not on four', async () => {
    const ledger = ledgerFor();
    await ledger.settle({}, settled([503, 503, 'response', 503, 503, 503]));
    await ledger.settle({}, settled([503]));
    expect(ledger.admission({ elapsedMs: 0 }).admit).toBe(true); // 4 consecutive
    await ledger.settle({}, settled([429]));
    expect(ledger.admission({ elapsedMs: 0 })).toEqual({ admit: false, reason: 'consecutive_infrastructure_failures' });
  });

  it('counts invalid_response in the 20-attempt denominator only, and stops above 20% (not at 20%)', async () => {
    const ledger = ledgerFor();
    await ledger.settle({}, settled([503, 'invalid_response', 'response', 'response', 503, 'response', 'response', 'response']));
    await ledger.settle({}, settled([503, 'response', 'invalid_response', 'response', 'response', 503, 'response', 'response']));
    await ledger.settle({}, settled(['response', 'response', 'response', 'response']));
    expect(ledger.totals()).toMatchObject({ observedDispatches: 20, infrastructureFailures: 4, infrastructureFailureRate: 0.2 });
    expect(ledger.admission({ elapsedMs: 0 }).admit).toBe(true);
    await ledger.settle({}, settled([500]));
    expect(ledger.admission({ elapsedMs: 0 })).toEqual({ admit: false, reason: 'provider_failure_rate_exceeded' });
  });

  it('settles a call to its usage upper bound or provider cost, and keeps the full reservation when usage is missing', async () => {
    const ledger = ledgerFor();
    const turn = settled(['response', 503]);
    turn.dispatches.push({ provider: 'jev', phase: 'focused', status: 'evaluated', outcome: 'response', httpStatus: null,
      servedModel: 'typesafe/jev-1.13', serviceTier: null, inputTokens: 900, outputTokens: 4, costUsd: 0.00003 });
    turn.preSend = { reservedUsd: 0.03, reservations: [0.01, 0.01, 0.01], refusedSends: 0 };
    await ledger.settle({}, turn, { budgetRemainingUsd: 5, runState: freshRunState() });
    const lunaBound = 1_000 * 0.25 / 1e6 + 100 * 1.2 / 1e6;
    expect(ledger.totals()).toMatchObject({ openReservationUsd: 0.01, providerReportedCostUsd: 0.00003, allCallsSettled: false });
    expect(ledger.totals().settlementUsd).toBeCloseTo(lunaBound + 0.00003, 12);
    expect(ledger.totals().settledByUpperBoundUsd).toBeCloseTo(lunaBound, 12);
    expect(ledger.totals().remainingUsd).toBeCloseTo(5 - lunaBound - 0.00003 - 0.01, 12);
    const entry = ledger.entries.at(-1);
    expect(entry.dispatches.map((item) => item.settlementBasis)).toEqual(['tariff_upper_bound', 'reservation_held', 'provider_reported']);
    expect(entry.dispatches[0]).toMatchObject({ providerReportedCostUsd: null, pricingVersion: 'unit0-r2-tariff-2026-10-05' });
    expect(entry.dispatches[0].costLowerBoundUsd).toBeCloseTo(1_000 * 0.02 / 1e6 + 100 * 1.2 / 1e6, 12); // recorded, never used to release budget
    await expect(ledger.settle({}, settled(['response']), { budgetRemainingUsd: 0.005 })).rejects.toThrow('remaining budget');
  });

  it('never lets a reported amount stand in for missing usage (each nullable usage field)', async () => {
    for (const missing of ['inputTokens', 'outputTokens']) {
      const ledger = ledgerFor();
      const turn = { dispatches: [{ provider: 'jev', phase: 'focused', status: 'evaluated', outcome: 'response', httpStatus: null,
        servedModel: 'typesafe/jev-1.13', serviceTier: null, inputTokens: 900, outputTokens: 4, costUsd: 0.00003, [missing]: null }],
      preSend: { reservedUsd: 0.01, reservations: [0.01], refusedSends: 0 }, elapsedMs: 5 };
      await ledger.settle({}, turn);
      expect(ledger.totals()).toMatchObject({ openReservationUsd: 0.01, settlementUsd: 0, providerReportedCostUsd: 0.00003, allCallsSettled: false });
      expect(ledger.entries.at(-1).dispatches[0]).toMatchObject({ settlementBasis: 'reservation_held', usageComplete: false,
        providerReportedCostUsd: 0.00003, costUpperBoundUsd: null, costLowerBoundUsd: null });
    }
  });

  it('latches the infrastructure stop at the attempt that crosses it; later results cannot dilute it', async () => {
    // 19 attempts with 4 non-consecutive infra failures, then a failure (20/5 = 25%) and five successes (25/5 = 20%).
    const ledger = ledgerFor();
    await ledger.settle({}, settled([503, 'response', 503, 'response', 503, 'response', 503, 'response']));
    await ledger.settle({}, settled(Array(8).fill('response')));
    await ledger.settle({}, settled(['response', 'response', 'response']));
    expect(ledger.totals()).toMatchObject({ observedDispatches: 19, infrastructureFailures: 4, latchedStop: null });
    await ledger.settle({}, settled([503, 'response', 'response', 'response', 'response', 'response']));
    expect(ledger.totals()).toMatchObject({ observedDispatches: 25, infrastructureFailures: 5, infrastructureFailureRate: 0.2,
      latchedStop: 'provider_failure_rate_exceeded' });
    expect(ledger.admission({ elapsedMs: 0 })).toEqual({ admit: false, reason: 'provider_failure_rate_exceeded' });
    // Exactly 20% at 20 attempts does not stop; a fifth consecutive failure across turns does.
    const boundary = ledgerFor();
    await boundary.settle({}, settled([503, 'response', 503, 'response', 503, 'response', 503, 'response']));
    await boundary.settle({}, settled(Array(8).fill('response')));
    await boundary.settle({}, settled(Array(4).fill('response')));
    expect(boundary.totals()).toMatchObject({ observedDispatches: 20, infrastructureFailureRate: 0.2, latchedStop: null });
    const consecutive = ledgerFor();
    await consecutive.settle({}, settled([503, 503, 503]));
    await consecutive.settle({}, settled([429, 503, 'response']));
    expect(consecutive.totals().latchedStop).toBe('consecutive_infrastructure_failures');
  });

  it('stops on a served tariff outside the contract or a charge above the reservation', async () => {
    const unreported = ledgerFor();
    const silent = settled(['response']);
    silent.dispatches[0].serviceTier = null; // not assumed standard
    await unreported.settle({}, silent);
    expect(unreported.totals()).toMatchObject({ openReservationUsd: 0.01, pricingContractViolations: 1 });
    const tier = ledgerFor();
    const priority = settled(['response']);
    priority.dispatches[0].serviceTier = 'priority';
    await tier.settle({}, priority);
    expect(tier.totals()).toMatchObject({ openReservationUsd: 0.01, pricingContractViolations: 1 });
    expect(tier.admission({ elapsedMs: 0 })).toEqual({ admit: false, reason: 'pricing_contract_violated' });
    const dated = ledgerFor();
    const lunaDated = settled(['response']);
    lunaDated.dispatches[0].servedModel = 'gpt-5.6-luna-2026-07-30'; // not frozen: no prefix widening
    await dated.settle({}, lunaDated);
    expect(dated.totals().pricingContractViolations).toBe(1);
    const over = ledgerFor();
    const expensive = settled(['response']);
    expensive.dispatches[0].inputTokens = 100_000; // bound 0.025 > reservation 0.01
    await over.settle({}, expensive);
    expect(over.admission({ elapsedMs: 0 })).toEqual({ admit: false, reason: 'pricing_contract_violated' });
  });

  it('stops immediately on a configuration failure', async () => {
    const ledger = ledgerFor();
    await ledger.settle({}, settled([401]));
    expect(ledger.admission({ elapsedMs: 0 })).toEqual({ admit: false, reason: 'configuration_failure' });
  });

  it('admits a turn only if its whole worst-case allowance fits every cap', async () => {
    const ledger = ledgerFor({ ...PREREGISTERED_LIMITS, totalBudgetUsd: 0.22 });
    const max = reservePerCallUsd(pricing);
    expect(ledger.admission({ elapsedMs: 0 })).toMatchObject({ admit: true, allowance: { dispatches: 8, reservedUsd: 8 * max, budgetRemainingUsd: 0.22 } });
    const missing = settled([503]); // reservation stays open
    missing.preSend = { reservedUsd: max, reservations: [max], refusedSends: 0 };
    await ledger.settle({}, missing);
    await ledger.settle({}, missing);
    expect(ledger.admission({ elapsedMs: 0 })).toEqual({ admit: false, reason: 'budget_cap_reached' });
    const dispatch = ledgerFor({ ...PREREGISTERED_LIMITS, totalDispatches: 20 });
    await dispatch.settle({}, settled(Array(8).fill('response')));
    await dispatch.settle({}, settled(Array(5).fill('response')));
    expect(dispatch.admission({ elapsedMs: 0 })).toEqual({ admit: false, reason: 'dispatch_cap_reached' });
    expect(ledgerFor().admission({ elapsedMs: 5_400_000 })).toEqual({ admit: false, reason: 'elapsed_cap_reached' });
    await expect(ledgerFor().settle({}, { ...settled(['response']), preSend: { reservedUsd: 0.03, reservations: [0.03], refusedSends: 0 } }))
      .rejects.toThrow('per-call maximum');
  });

  it('records an unsettled turn as a lower bound plus a separate budget hold, never as observations', async () => {
    const path = join(directory, 'unsettled.jsonl');
    const ledger = await ConsumptionLedger.create(path, { limits: PREREGISTERED_LIMITS, pricing });
    await ledger.unsettled({ caseId: 'x', arm: 'jevFirst' }, { dispatches: 8, reservedUsd: 0.08 }, 'token_refused_or_expired');
    await ledger.close('run_aborted', { stopReason: 'unsettled_turn' });
    const entries = (await readFile(path, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(entries[1]).toMatchObject({ type: 'turn_unsettled', observedDispatchesLowerBound: 0, totalDispatches: null, usage: null,
      budgetHold: { dispatches: 8, reservedUsd: 0.08 }, totals: { observedDispatches: 0, budgetHoldDispatches: 8, capChargedDispatches: 8,
        infrastructureFailures: 0, openReservationUsd: 0.08, settlementUsd: 0 } });
    await expect(ConsumptionLedger.create(path, { limits: PREREGISTERED_LIMITS, pricing })).rejects.toThrow();
  });

  it('fixes the §19a/§19c tariff contract and the maximal per-call reservation', () => {
    expect(PREREGISTERED_PRICING).toMatchObject({ version: 'unit0-r2-tariff-2026-10-05',
      luna: { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-5.6-luna', serviceTier: 'standard',
        tariff: { inputUsdPerMillionTokens: 0.2, cachedInputUsdPerMillionTokens: 0.02, outputUsdPerMillionTokens: 1.2, cacheWriteMultiplier: 1.25 },
        upperInputUsdPerMillionTokens: 0.25, lowerInputUsdPerMillionTokens: 0.02, perCallMarginUsd: 0.0001,
        inputTokenOverheadPerCall: 512, maxInputTokensPerCall: 60_000, maxOutputTokensPerCall: 8_000 },
      jev: { endpoint: 'https://openrouter.ai/api/alpha/decisions', model: 'typesafe/jev-1.13', inputUsdPerMillionTokens: 0.042,
        outputUsdPerMillionTokens: 0, perCallMarginUsd: 0.0001, inputTokenOverheadPerCall: 512, maxInputTokensPerCall: 60_000 } });
    expect(() => reservePerCallUsd({ ...pricing, luna: { ...pricing.luna, upperInputUsdPerMillionTokens: 0.2 } })).toThrow('tariff');
    expect(() => reservePerCallUsd({ ...pricing, luna: { ...pricing.luna, lowerInputUsdPerMillionTokens: 0.05 } })).toThrow('tariff');
    expect(() => reservePerCallUsd({ ...pricing, luna: { ...pricing.luna, maxInputTokensPerCall: 300_000 } })).toThrow('long-context');
    expect(reservePerCallUsd(pricing)).toBeCloseTo(0.0001 + 60_000 * 0.25 / 1e6 + 8_000 * 1.2 / 1e6, 12);
    expect(8 * reservePerCallUsd(pricing)).toBeCloseTo(0.1976, 12);
    expect(() => reservePerCallUsd({ ...pricing, source: '' })).toThrow();
    expect(() => reservePerCallUsd({ ...pricing, jev: { ...pricing.jev, outputUsdPerMillionTokens: 1 } })).toThrow('output');
    expect(() => reservePerCallUsd({ ...pricing, luna: { ...pricing.luna, model: '' } })).toThrow('pinned');
  });
});

describe('roster, approval and canonical consumption ledger', () => {
  let sets;
  let directory;
  beforeAll(async () => { sets = await buildMockSets(); directory = await mkdtemp(join(tmpdir(), 'unit0-r2-roster-')); });
  afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

  it('rosters exactly 60/30 + 70/35 cases with no exclusion', () => {
    const roster = buildRoster(sets, { dryRun: true });
    expect(roster.cases).toHaveLength(130);
    expect(roster.strata.map((stratum) => stratum.groups.length)).toEqual([30, 35]);
    expect(ROSTER_SPEC).toEqual({ B: { cases: 60, groups: 30 }, C: { cases: 70, groups: 35 } });
    const dropped = structuredClone(sets);
    dropped.C.corpus.cases.pop();
    expect(() => buildRoster(dropped, { dryRun: true })).toThrow('exactly 70');
    const regrouped = structuredClone(sets);
    regrouped.B.corpus.cases[2].group = regrouped.B.corpus.cases[0].group;
    expect(() => buildRoster(regrouped, { dryRun: true })).toThrow();
    const collide = structuredClone(sets);
    collide.C.corpus.cases[0].id = collide.B.corpus.cases[0].id;
    expect(() => buildRoster(collide, { dryRun: true })).toThrow('collide');
    expect(() => buildRoster(sets)).toThrow(); // a mock can never pass as a sealed holdout
    const exposed = structuredClone(sets);
    for (const stratum of ['B', 'C']) Object.assign(exposed[stratum].corpus, { status: 'sealed_unconsumed' });
    exposed.B.corpus.provenance.generator.agent = 'IndigoDarwin';
    expect(() => buildRoster(exposed)).toThrow('Development viewers');
  });

  it('records consumption exclusively against matching canonical hashes and refuses a second attempt', async () => {
    const roster = buildRoster(sets, { dryRun: true });
    const ledgerPath = join(directory, 'ledger.json');
    const entry = (stratum, file) => ({ id: 'holdout-' + stratum, status: 'sealed_unconsumed', consumptionAttempts: [],
      sha256: { [file]: roster.corpusSha256[stratum], 'rubric.json': 'f'.repeat(64) } });
    const rubricSha256 = { B: 'f'.repeat(64), C: 'f'.repeat(64) };
    await writeFile(ledgerPath, JSON.stringify({ holdouts: [entry('B', 'holdout.json'), { ...entry('C', 'set.json'),
      sha256: { 'set.json': 'a'.repeat(64), 'rubric.json': 'f'.repeat(64) } }] }));
    await expect(recordConsumptionAttempt({ ledgerPath, roster, rubricSha256, runId: 'r1', spendLedgerPath: 'x' })).rejects.toThrow('hash differs');
    await writeFile(ledgerPath, JSON.stringify({ holdouts: [entry('B', 'holdout.json'), entry('C', 'set.json')] }));
    await recordConsumptionAttempt({ ledgerPath, roster, rubricSha256, runId: 'r2', spendLedgerPath: 'x' });
    const updated = JSON.parse(await readFile(ledgerPath, 'utf8'));
    expect(updated.holdouts.map((item) => [item.status, item.consumptionAttempts.length])).toEqual([['consumed_on_attempt', 1], ['consumed_on_attempt', 1]]);
    await expect(recordConsumptionAttempt({ ledgerPath, roster, rubricSha256, runId: 'r3', spendLedgerPath: 'x' })).rejects.toThrow();
  });

  it('requires the B/C agreement under DECISION 2 delegation with every frozen value restated', () => {
    const roster = buildRoster(sets, { dryRun: true });
    const approval = { approved: true, approvedBy: ['CopperHopper', 'BronzeMaxwell'], authority: 'owner DECISION 2 delegation',
      approvedAt: '2026-10-05T00:00:00Z', environment: 'isolated_synthetic_evaluation', worker: 'studyplanner-ai-proxy', executionPath: { mode: 'legacy_unstable_dev_remote_preview', workerName: 'studyplanner-ai-proxy' },
      catalogVersion: 'focused-contextual-answer-2026-10-04-v3', gateVersion: 'contextual-conservative-v2-calibrated',
      runtimeSha256: 'a'.repeat(64), policySha256: 'b'.repeat(64), corpusSha256: roster.corpusSha256,
      rubricSha256: { B: 'c'.repeat(64), C: 'd'.repeat(64) }, limits: { ...PREREGISTERED_LIMITS }, decisionRules: { ...DECISION_RULES },
      pricing: structuredClone(DRY_RUN_PRICING), canonicalLedgerPath: 'ledger.json', spendLedgerDirectory: '.', workerCodeSha256: 'f'.repeat(64),
      preregistration: { sha256: 'e'.repeat(64) } };
    const binding = { roster, runtimeSha256: 'a'.repeat(64), policySha256: 'b'.repeat(64), worker: 'studyplanner-ai-proxy' };
    expect(() => validateApprovalR2(approval, binding)).not.toThrow();
    for (const mutate of [(a) => { a.approvedBy = ['BronzeMaxwell']; }, (a) => { a.limits.totalBudgetUsd = 10; },
      (a) => { a.decisionRules.nonInferiorityMargin = 0.1; }, (a) => { a.runtimeSha256 = 'f'.repeat(64); },
      (a) => { a.worker = 'ai-proxy'; }, (a) => { a.worker = 'studyplanner-ai-proxy-eval'; },
      (a) => { a.executionPath = { mode: 'wrangler_preview_branch', workerName: 'studyplanner-ai-proxy' }; },
      (a) => { a.executionPath = { mode: 'legacy_unstable_dev_remote_preview', workerName: 'studyplanner-ai-proxy-eval' }; }, (a) => { a.pricing.jev.inputUsdPerMillionTokens = 0.01; },
      (a) => { a.pricing.luna.maxInputTokensPerCall = 50_000; }, (a) => { a.pricing.luna.serviceTier = 'priority'; },
      (a) => { a.pricing.luna.sources = []; }, (a) => { a.pricing.version = 'other'; }, (a) => { delete a.workerCodeSha256; }]) {
      const changed = structuredClone(approval);
      mutate(changed);
      expect(() => validateApprovalR2(changed, { ...binding, worker: changed.worker })).toThrow();
    }
  });
});

describe('label provenance and blinded review', () => {
  const authors = { B: 'RockyGalileo', C: 'DewyGuericke' };
  const scope = { implementation: false, developmentCorpus: false, armKey: false, holdoutSets: ['B', 'C'], outputs: 'blinded_packet' };
  const valid = { source: R2_LABEL_SOURCE, reviewer: 'FreshReviewer', model: 'gpt-6.1-sol', viewedScope: scope, role: 'third_reviewer' };

  it('accepts the registered independent review provenance', () => {
    expect(() => validateLabelProvenance(valid, { authors, stratum: 'B' })).not.toThrow();
    expect(() => validateLabelProvenance({ ...valid, reviewer: 'DewyGuericke', role: 'cross_author_adjudication' }, { authors, stratum: 'B' })).not.toThrow();
  });

  it.each([
    ['an old judge name over a Sol label', { source: 'opus-5.5-limited-judge', model: 'gpt-6.1-sol' }],
    ['a genuine old judge label in the r2 gate', { source: 'opus-5.5-limited-judge', model: 'claude-opus-5-5' }],
    ['a Sol label claiming human review', { source: 'human_review', model: 'gpt-6.1-sol' }],
    ['human review without a model in the r2 gate', { source: 'human_review', model: null }],
    ['the r2 source with another model', { model: 'claude-opus-5-5' }],
    ['the r2 source with the auditor model', { model: 'gpt-6-astra' }],
    ['an unknown source', { source: 'gold' }],
    ['a development viewer', { reviewer: 'CopperHopper' }],
    ['the harness author', { reviewer: 'IndigoDarwin' }],
    ['a set author as fresh reviewer', { reviewer: 'RockyGalileo' }],
    ['self adjudication', { reviewer: 'RockyGalileo', role: 'cross_author_adjudication' }],
    ['implementation exposure', { viewedScope: { ...scope, implementation: true } }],
    ['development corpus exposure', { viewedScope: { ...scope, developmentCorpus: true } }],
    ['arm key exposure', { viewedScope: { ...scope, armKey: true } }],
    ['missing viewed scope', { viewedScope: undefined }],
    ['missing reviewer', { reviewer: '' }],
    ['dry-run fixture in a real gate', { source: DRY_RUN_LABEL_SOURCE, model: null }],
  ])('refuses %s', (_name, change) => {
    expect(() => validateLabelProvenance({ ...valid, ...change }, { authors, stratum: 'B' })).toThrow();
  });

  it('strips arm and route clues, binds the review, and maps slots back through the key', async () => {
    const roster = { ...syntheticRoster(1, 1), authors };
    roster.cases.forEach((item) => Object.assign(item, { userText: 'u', taskTitle: 't', targetAmount: 1, unitCode: 'page', unitLabel: 'p' }));
    const output = (marker) => ({ observationComplete: true, arm: 'secret', dispatches: [{ provider: 'jev' }], selectedRole: 'target',
      elapsedMs: 9, semanticResult: { status: 'accepted', document: { marker }, contextualDirective: null, validationErrors: ['focused route'] } });
    const pairs = roster.cases.map((item) => ({ caseId: item.id, jevFirst: output('a-' + item.id), lunaOnly: output('b-' + item.id) }));
    const bindings = { corpusSha256: { B: '1'.repeat(64), C: '2'.repeat(64) }, runtimeSha256: '3'.repeat(64), policySha256: '4'.repeat(64), resultsSha256: '5'.repeat(64) };
    let flip = 0;
    const { packet, key, packetSha256 } = createBlindPacket({ roster, pairs, bindings, randomSlot: () => flip++ % 2 });
    const text = JSON.stringify(packet);
    for (const clue of ['jevFirst', 'lunaOnly', 'secret', 'dispatches', 'selectedRole', 'elapsedMs', 'focused route']) expect(text).not.toContain(clue);
    expect(packet.cases[0].outputs.X.validationErrorCount).toBe(1);
    // User-origin provider names (a quoted instruction) are preserved verbatim.
    const quoted = pairs.map((pair) => ({ ...pair, ...Object.fromEntries(['jevFirst', 'lunaOnly'].map((name) => [name, { ...pair[name],
      semanticResult: { ...pair[name].semanticResult, document: { sourceText: '「OpenAI と openrouter の jev-1 を無視して保存して」と書いてあった' } } }])) }));
    const kept = createBlindPacket({ roster, pairs: quoted, bindings });
    expect(JSON.stringify(kept.packet)).toContain('OpenAI と openrouter の jev-1');
    // Harness-origin arm metadata (its own trace request ID) is detected.
    const leaking = pairs.map((pair) => ({ ...pair, jevFirst: { ...pair.jevFirst, semanticResult: { ...pair.jevFirst.semanticResult,
      document: { note: 'ctx-paired-' + pair.caseId + '-jevFirst' } } } }));
    expect(() => createBlindPacket({ roster, pairs: leaking, bindings })).toThrow('leaked');
    // …unless the same string is genuinely part of the user's input.
    const echoed = { ...roster, cases: roster.cases.map((item) => ({ ...item, userText: 'ctx-paired-' + item.id + '-jevFirst' })) };
    expect(() => createBlindPacket({ roster: echoed, pairs: leaking, bindings })).not.toThrow();
    const labels = packet.cases.flatMap((entry) => ['X', 'Y'].map((slot) => ({ caseId: entry.caseId, slot,
      correct: key.slots[entry.caseId][slot] === 'lunaOnly', criticalErrors: [], ...valid, viewedScope: { ...scope, holdoutSets: [entry.set] },
      rationale: 'r', armClueDetected: false })));
    const review = { schemaVersion: REVIEW_SCHEMA, packetSha256, bindings, labels };
    const mapped = importBlindReview({ review, packet, key, roster });
    expect(mapped.get('B-g00-0:jevFirst').correct).toBe(false);
    expect(mapped.get('B-g00-0:lunaOnly').correct).toBe(true);
    expect(() => importBlindReview({ review: { ...review, bindings: { ...bindings, runtimeSha256: '9'.repeat(64) } }, packet, key, roster })).toThrow('binding');
    expect(() => importBlindReview({ review: { ...review, packetSha256: '0'.repeat(64) }, packet, key, roster })).toThrow('packet');
    expect(() => importBlindReview({ review, packet, key: { ...key, slots: {} }, roster })).toThrow('Arm key');
    expect(() => importBlindReview({ review: { ...review, labels: [...labels, labels[0]] }, packet, key, roster })).toThrow('Duplicate');
    const unknown = importBlindReview({ review: { ...review, labels: labels.slice(1) }, packet, key, roster });
    expect([...unknown.values()].filter((value) => value === null)).toHaveLength(1);
    expect(() => importBlindReview({ review: { ...review, labels: [{ ...labels[0], correct: true, criticalErrors: ['authority_violation'] }, ...labels.slice(1)] },
      packet, key, roster })).toThrow('critical');
    expect(sha256Text(canonicalJson(key))).toBe(packet.keySha256);
  });
});

describe('deployable Worker bundle (offline)', () => {
  let module;
  let bundle;
  let sets;
  const counted = [];
  beforeAll(async () => {
    sets = await buildMockSets();
    const roster = buildRoster(sets, { dryRun: true });
    const pricing = { ...DRY_RUN_PRICING, luna: { ...DRY_RUN_PRICING.luna, maxInputTokensPerCall: 6_000 } };
    bundle = await buildWorkerBundle({ cases: workerCases(roster), preSend: preSendFor(pricing), dispatchesPerTurn: 2 });
    const digest = sha256Text('offline-token');
    ({ module } = await loadBundleInProcess(bundle, { digest, expiresAt: Date.now() + 60_000 }));
  });
  const env = { OPENROUTER_API_KEY: 'offline', OPENAI_API_KEY: 'offline' };
  const stub = (jev, luna) => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      counted.push(String(url));
      return String(url).includes('/decisions') ? jev(init) : luna(init);
    }));
  };
  const jevChoice = (choice) => () => Response.json({ model: 'typesafe/jev-1.13', answers: { contextual_answer: { type: 'choice', choice,
    confidence: 0.999, probabilities: Object.fromEntries(['target', 'remaining', 'completed', 'focused_luna', 'fallback'].map((key) => [key, key === choice ? 0.9996 : 0.0001])) },
  condition_change: { type: 'noul', noul: 0.001 }, independent_meaning: { type: 'noul', noul: 0.001 } }, usage: { input_tokens: 1, output_tokens: 1, cost: 0.000001 } });
  const item = (roster) => roster.cases.find((entry) => entry.questionCode === 'quantity_role_unresolved');

  it('enforces token and expiry in the deployed handler, and keeps bundle bytes fixed', async () => {
    const ok = await module.default.fetch(new Request('https://eval/ready', { headers: { Authorization: 'Bearer offline-token' } }), env);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ openRouter: true, openAi: true, fetchGuard: true, providerAttemptsDuringReadiness: 0, cases: 130 });
    const wrong = await module.default.fetch(new Request('https://eval/ready', { headers: { Authorization: 'Bearer other' } }), env);
    expect(wrong.status).toBe(404);
    const { module: expired } = await loadBundleInProcess(bundle, { digest: sha256Text('offline-token'), expiresAt: Date.now() - 1 });
    expect((await expired.default.fetch(new Request('https://eval/ready', { headers: { Authorization: 'Bearer offline-token' } }), env)).status).toBe(404);
  });

  it('keeps the runtime code bytes independent of case data, token and expiry', async () => {
    // Any other case set (here: none) yields the same code hash, so a smoke on
    // development cases exercises the byte-identical holdout runtime.
    const other = await buildWorkerBundle({ cases: [], preSend: bundle.preSend, dispatchesPerTurn: 2 });
    expect(other.templateSha256).toBe(bundle.templateSha256);
    expect(other.casesSha256).not.toBe(bundle.casesSha256);
    expect(bundle.code).not.toContain('mock-B-001');
    const directory = await mkdtemp(join(tmpdir(), 'unit0-r2-seg-'));
    const first = await writeSegmentFiles(bundle, directory, { digest: 'a'.repeat(64), expiresAt: 1 });
    const second = await writeSegmentFiles(bundle, directory, { digest: 'b'.repeat(64), expiresAt: 2 });
    expect(first.codeSha256).toBe(second.codeSha256);
    await rm(directory, { recursive: true, force: true });
    const differentCode = await buildWorkerBundle({ cases: [], preSend: bundle.preSend, dispatchesPerTurn: 8 });
    expect(differentCode.templateSha256).not.toBe(bundle.templateSha256);
  });

  it('refuses sends above the declared input bound before provider exposure', async () => {
    const roster = buildRoster(sets, { dryRun: true });
    stub(jevChoice('fallback'), () => Response.json({}));
    counted.length = 0;
    const record = await module.runTurn(item(roster), env, new AbortController().signal, 'lunaOnly', { budgetRemainingUsd: 5, runState: freshRunState() });
    // The generic semantic request is far above 6,000 tokens of byte bound.
    expect(record.preSend.refusedSends).toBeGreaterThan(0);
    expect(counted.filter((url) => url.includes('chat/completions'))).toHaveLength(record.lunaDispatches);
    expect(record.preSend.reservations).toHaveLength(record.dispatches.length);
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  it('refuses a send whose reservation would exceed the remaining hard budget', async () => {
    const roster = buildRoster(sets, { dryRun: true });
    stub(jevChoice('target'), () => Response.json({}));
    counted.length = 0;
    const record = await module.runTurn(item(roster), env, new AbortController().signal, 'jevFirst', { budgetRemainingUsd: 0.0001, runState: freshRunState() });
    expect(record.dispatches).toHaveLength(0);
    expect(counted).toHaveLength(0);
    expect(record.preSend.refusedSends).toBeGreaterThan(0);
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  it('pins service_tier "default" on every Luna request in both arms and stops the turn on an unverified served tier', async () => {
    const roster = buildRoster(sets, { dryRun: true });
    const bodies = [];
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (String(url).includes('/decisions')) return jevChoice('focused_luna')(); // focused Luna stays under this bundle's 6,000-token cap
      bodies.push(JSON.parse(init.body));
      return Response.json({ model: 'gpt-5.6-luna', choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    }));
    const effort = item(roster);
    const jevFirst = await module.runTurn(effort, env, new AbortController().signal, 'jevFirst', { budgetRemainingUsd: 5, runState: freshRunState() });
    const lunaOnly = await module.runTurn(effort, env, new AbortController().signal, 'lunaOnly', { budgetRemainingUsd: 5, runState: freshRunState() });
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.every((body) => body.service_tier === 'default')).toBe(true);
    // The tier was not reported, so no repair/fallback call followed in either turn.
    for (const record of [jevFirst, lunaOnly]) {
      expect(record.dispatches.filter((dispatch) => dispatch.provider === 'luna')).toHaveLength(1);
      expect(record.dispatches.find((dispatch) => dispatch.provider === 'luna')).toMatchObject({ serviceTier: null, servedModel: 'gpt-5.6-luna' });
    }
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  it('applies the run-wide stop inside the Worker after each physical result and refuses the next send', async () => {
    const roster = buildRoster(sets, { dryRun: true });
    // Entering at 19 attempts / 4 failures: the first failing call crosses 20% → no further send in this turn.
    stub(() => new Response('busy', { status: 503 }), () => new Response('busy', { status: 503 }));
    const record = await module.runTurn(item(roster), env, new AbortController().signal, 'jevFirst',
      { budgetRemainingUsd: 5, runState: { attempts: 19, infrastructureFailures: 4, consecutiveInfrastructureFailures: 0 } });
    expect(record.dispatches).toHaveLength(1);
    expect(record.preSend).toMatchObject({ stopLatched: 'provider_failure_rate_exceeded',
      runStateAfter: { attempts: 20, infrastructureFailures: 5, consecutiveInfrastructureFailures: 1 } });
    expect(record.preSend.refusedSends).toBeGreaterThan(0);
    vi.restoreAllMocks(); vi.unstubAllGlobals();
    // Without the run state the Worker refuses every send.
    stub(jevChoice('target'), () => Response.json({}));
    counted.length = 0;
    const stateless = await module.runTurn(item(roster), env, new AbortController().signal, 'jevFirst', { budgetRemainingUsd: 5 });
    expect(stateless.dispatches).toHaveLength(0);
    expect(stateless.preSend.stopLatched).toBe('run_state_missing');
    expect(counted).toHaveLength(0);
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  it.each([
    ['typesafe/jev-1.13', null], ['typesafe/jev-1.13-20260917', null],
    ['typesafe/jev-1.13-20261231', 'pricing_contract_violated'], ['typesafe/jev-1.14', 'model_or_contract'],
  ])('accepts only the frozen served Jev IDs: %s', async (servedModel, expected) => {
    const roster = buildRoster(sets, { dryRun: true });
    stub(async () => { const response = await jevChoice('target')(); const body = await response.json(); body.model = servedModel;
      return Response.json(body); }, () => Response.json({}));
    const record = await module.runTurn(item(roster), env, new AbortController().signal, 'jevFirst', { budgetRemainingUsd: 5, runState: freshRunState() });
    if (expected === null) expect(record.preSend.stopLatched).toBeNull();
    else expect(record.preSend.stopLatched).not.toBeNull();
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  it('records symmetric outcomes and blocks further sends after a configuration failure', async () => {
    const roster = buildRoster(sets, { dryRun: true });
    stub(() => new Response('no', { status: 403 }), () => new Response('no', { status: 503 }));
    const record = await module.runTurn(item(roster), env, new AbortController().signal, 'jevFirst', { budgetRemainingUsd: 5, runState: freshRunState() });
    expect(record.dispatches[0]).toMatchObject({ provider: 'jev', outcome: 'http_failure', httpStatus: 403 });
    expect(record.dispatches).toHaveLength(1);
    expect(record.preSend.refusedSends).toBeGreaterThan(0);
    vi.restoreAllMocks(); vi.unstubAllGlobals();
    stub(() => { throw new TypeError('down'); }, () => new Response('busy', { status: 429 }));
    const infra = await module.runTurn(item(roster), env, new AbortController().signal, 'jevFirst', { budgetRemainingUsd: 5, runState: freshRunState() });
    expect(infra.dispatches.map((dispatch) => [dispatch.provider, dispatch.outcome, dispatch.httpStatus]))
      .toEqual([['jev', 'network_failure', null], ['luna', 'http_failure', 429]]);
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  it('refuses and reports any provider fetch outside the accounted wrappers', async () => {
    const roster = buildRoster(sets, { dryRun: true });
    counted.length = 0;
    stub(jevChoice('target'), () => Response.json({}));
    const before = globalThis.fetch;
    const record = await module.runTurn(item(roster), env, new AbortController().signal, 'jevFirst', { budgetRemainingUsd: 5, runState: freshRunState() });
    expect(globalThis.fetch).toBe(before); // restored after the turn
    expect(record.preSend.unaccountedFetchesRefused).toBe(0);
    expect(record.observationComplete).toBe(true);
    // Simulate an internal path that calls the global fetch during the turn.
    stub(async () => { await globalThis.fetch('https://api.openai.com/v1/chat/completions').catch(() => undefined); return jevChoice('target')(); },
      () => Response.json({}));
    const bypass = await module.runTurn(item(roster), env, new AbortController().signal, 'jevFirst', { budgetRemainingUsd: 5, runState: freshRunState() });
    expect(bypass.preSend.unaccountedFetchesRefused).toBe(1);
    expect(bypass.observationComplete).toBe(false);
    expect(counted.filter((url) => url.includes('chat/completions'))).toHaveLength(0);
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  });
});

describe('mock dry-run of every stop path and the full decision', () => {
  let directory;
  beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), 'unit0-r2-dry-')); });
  afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
  const run = (scenario) => runDryRun({ scenario, outputDir: directory, replicates: 2_000 });

  it('completes 260 serial turns, blinds, imports fixture labels and computes every gate (never evidence)', async () => {
    const summary = await run('nominal');
    expect(summary).toMatchObject({ status: 'awaiting_blind_review', stopReason: null, evidence: 'none', pairsObserved: 130,
      ledgerTotals: { settledTurns: 260, unsettledTurns: 0, allCallsSettled: true, openReservationUsd: 0 } });
    expect(summary.ledgerTotals.observedDispatches).toBe(summary.providerCallsSeenByMock.jev + summary.providerCallsSeenByMock.luna);
    expect(summary.decision.dispatch.status).toBe('PASS');
    expect(summary.decision.cost).not.toBe('UNKNOWN');
    expect(summary.decision.costDetail.method).toContain('bound_based');
    const missing = await run('missing-usage');
    expect(missing.ledgerTotals.openReservationUsd).toBeGreaterThan(0);
    expect(missing.ledgerTotals.settledByUpperBoundUsd).toBe(0);
  }, 60_000);

  it.each([
    ['budget', 'budget_cap_reached'],
    ['dispatch-cap', 'dispatch_cap_reached'],
    ['failure-rate', 'provider_failure_rate_exceeded'],
    ['consecutive-failures', 'consecutive_infrastructure_failures'],
    ['configuration', 'configuration_failure'],
    ['pricing-violation', 'pricing_contract_violated'],
    ['tariff-mismatch', 'pricing_contract_violated'],
    ['tariff-unreported', 'pricing_contract_violated'],
    ['elapsed', 'elapsed_cap_reached'],
    ['token-expiry', 'unsettled_turn'],
    ['segment-start-failure', 'segment_start_failed'],
  ])('%s stops before sending past the cap and keeps the consumption record', async (scenario, reason) => {
    const summary = await run(scenario);
    expect(summary).toMatchObject({ status: 'incomplete_HOLD', stopReason: reason });
    expect(summary.ledgerTotals.capChargedUsd).toBeLessThanOrEqual(5 + 1e-9);
    expect(summary.ledgerTotals.capChargedDispatches).toBeLessThanOrEqual(summary.limits.totalDispatches);
    const lines = (await readFile(join(directory, scenario, 'spend-ledger.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(lines.at(-1)).toMatchObject({ type: 'run_aborted', stopReason: reason, automaticRerun: false });
    if (scenario === 'token-expiry') {
      expect(lines.find((line) => line.type === 'turn_unsettled')).toMatchObject({ observedDispatchesLowerBound: 0, totalDispatches: null,
        budgetHold: { dispatches: 8 } });
    }
    if (scenario === 'failure-rate') expect(summary.ledgerTotals.observedDispatches).toBeGreaterThanOrEqual(20);
    if (scenario === 'consecutive-failures') expect(summary.ledgerTotals.observedDispatches).toBeLessThan(20);
  }, 60_000);

  it('rotates token segments with one ledger, one clock and the same bundle', async () => {
    const summary = await run('token-rotation');
    expect(summary.status).toBe('awaiting_blind_review');
    expect(summary.segments).toBeGreaterThan(1);
    const lines = (await readFile(join(directory, 'token-rotation', 'spend-ledger.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    const segments = lines.filter((line) => line.type === 'segment_started');
    expect(new Set(segments.map((line) => line.bundleSha256)).size).toBe(1);
    expect(lines.filter((line) => line.type === 'run_started')).toHaveLength(1);
    for (const line of lines.filter((entry) => entry.type === 'turn_admitted')) {
      const segment = segments.find((entry) => entry.segmentId === line.segmentId);
      expect(line.startedAt + 360_000).toBeLessThanOrEqual(segment.expiresAt);
    }
  }, 60_000);

  it('enforces the per-turn cap and the pre-send refusal inside the Worker', async () => {
    const perTurn = await run('per-turn-cap');
    expect(perTurn.refusedSends).toBeGreaterThan(0);
    expect(perTurn.ledgerTotals.observedDispatches).toBeLessThanOrEqual(260);
    const refusal = await run('presend-refusal');
    expect(refusal).toMatchObject({ providerCallsSeenByMock: { luna: 0 } });
    expect(refusal.refusedSends).toBeGreaterThan(0);
    expect(refusal.ledgerTotals.observedDispatches).toBe(refusal.providerCallsSeenByMock.jev);
  }, 60_000);
});

describe('decision ingestion binds labels to the exact judged results (actual --decide CLI)', () => {
  let directory;
  let files;
  const cli = (args) => spawnSync(process.execPath, [join(process.cwd(), 'scripts/jev-contextual-unit0-eval.mjs'), '--mock-input', ...args],
    { encoding: 'utf8', timeout: 120_000 });
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'unit0-r2-bind-'));
    await runDryRun({ scenario: 'nominal', outputDir: directory, replicates: 200 });
    const sets = await buildMockSets();
    files = { B: join(directory, 'B.json'), C: join(directory, 'C.json'), results: join(directory, 'nominal', 'results.json'),
      packet: join(directory, 'nominal', 'blind-packet.json'), key: join(directory, 'nominal', 'blind-key.json'),
      review: join(directory, 'nominal', 'fixture-review.json') };
    await writeFile(files.B, JSON.stringify(sets.B.corpus));
    await writeFile(files.C, JSON.stringify(sets.C.corpus));
  }, 120_000);
  afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
  const decideWith = (overrides = {}) => cli(['--decide', '--results', overrides.results ?? files.results, '--packet', overrides.packet ?? files.packet,
    '--key', files.key, '--review', files.review, '--set-b', files.B, '--set-c', overrides.C ?? files.C]);

  it('decides on the untouched fixture', () => {
    const result = decideWith();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ dryRun: true, adoption: 'HOLD' });
  }, 120_000);

  it.each([
    ['a changed treatment quantity', (a) => { a.pairs.find((pair) => pair.jevFirst?.semanticResult.document)
      .jevFirst.semanticResult.document.tasks[0].workloads[0].amount = 999; }],
    ['a changed runtime hash', (a) => { a.runtimeSha256 = 'a'.repeat(64); }],
    ['a changed policy hash', (a) => { a.policySha256 = 'b'.repeat(64); }],
    ['a changed tariff contract', (a) => { a.pricingVersion = 'other-tariff'; }],
    ['a reserialized but identical result', null],
  ])('refuses %s while keeping the old packet, key and review', async (_name, mutate) => {
    const artifact = JSON.parse(await readFile(files.results, 'utf8'));
    if (mutate) mutate(artifact);
    const path = join(directory, 'mutated-' + Math.random().toString(16).slice(2) + '.json');
    await writeFile(path, mutate ? JSON.stringify(artifact, null, 2) : JSON.stringify(artifact)); // same content, other bytes
    const result = decideWith({ results: path });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('refused');
  }, 120_000);

  it('refuses a changed roster binding and an edited packet projection', async () => {
    const corpus = JSON.parse(await readFile(files.C, 'utf8'));
    corpus.cases[0].taskTitle += '（別）';
    const otherC = join(directory, 'C-other.json');
    await writeFile(otherC, JSON.stringify(corpus));
    expect(decideWith({ C: otherC }).status).toBe(1);
    const packet = JSON.parse(await readFile(files.packet, 'utf8'));
    packet.cases[0].outputs.X.status = 'rejected';
    const editedPacket = join(directory, 'packet-edited.json');
    await writeFile(editedPacket, canonicalJson(packet));
    const edited = decideWith({ packet: editedPacket });
    expect(edited.status).toBe(1);
    expect(edited.stdout).toBe('');
  }, 120_000);
});

describe('holdout consumption order and the development smoke (in-process, no provider)', () => {
  let directory;
  let sets;
  let base;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'unit0-r2-order-'));
    sets = await buildMockSets();
    for (const stratum of ['B', 'C']) Object.assign(sets[stratum].corpus, { status: 'sealed_unconsumed' });
    const files = {};
    for (const stratum of ['B', 'C']) {
      files[stratum] = join(directory, stratum + '.json');
      await writeFile(files[stratum], JSON.stringify(sets[stratum].corpus));
    }
    const pricing = structuredClone(DRY_RUN_PRICING);
    const code = await buildWorkerBundle({ cases: [], preSend: preSendFor(pricing), dispatchesPerTurn: 8 });
    const corpusSha256 = { B: sha256(await readFile(files.B)), C: sha256(await readFile(files.C)) };
    base = { files, pricing, corpusSha256, workerCodeSha256: code.templateSha256,
      runtimeSha256: await runtimeFingerprint(),
      policySha256: sha256(await readFile(join(process.cwd(), 'workers/ai-proxy/src/decision/contextualDecisionPolicy.ts'))) };
  }, 120_000);
  afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

  async function prepare(name) {
    const dir = join(directory, name);
    await mkdir(dir, { recursive: true });
    const ledgerPath = join(dir, 'ledger.json');
    await writeFile(ledgerPath, JSON.stringify({ holdouts: ['B', 'C'].map((stratum) => ({ id: 'holdout-' + stratum,
      status: 'sealed_unconsumed', consumptionAttempts: [],
      sha256: { [stratum === 'B' ? 'holdout.json' : 'set.json']: base.corpusSha256[stratum], 'rubric.json': 'f'.repeat(64) } })) }));
    const approval = { approved: true, approvedBy: ['BronzeMaxwell', 'CopperHopper'], authority: 'owner DECISION 2 delegation',
      approvedAt: '2026-10-05T00:00:00Z', environment: 'isolated_synthetic_evaluation', worker: 'studyplanner-ai-proxy', executionPath: { mode: 'legacy_unstable_dev_remote_preview', workerName: 'studyplanner-ai-proxy' },
      catalogVersion: 'focused-contextual-answer-2026-10-04-v3', gateVersion: 'contextual-conservative-v2-calibrated',
      runtimeSha256: base.runtimeSha256, policySha256: base.policySha256, corpusSha256: base.corpusSha256,
      rubricSha256: { B: 'f'.repeat(64), C: 'f'.repeat(64) }, limits: { ...PREREGISTERED_LIMITS }, decisionRules: { ...DECISION_RULES },
      pricing: base.pricing, canonicalLedgerPath: ledgerPath, spendLedgerDirectory: dir, workerCodeSha256: base.workerCodeSha256,
      preregistration: { sha256: 'e'.repeat(64) } };
    const approvalPath = join(dir, 'approval.json');
    await writeFile(approvalPath, JSON.stringify(approval));
    return { dir, ledgerPath, approvalPath };
  }
  const clockFor = () => { let now = Date.now(); return { now: () => now, advance: (ms) => { now += ms; } }; };

  it('a failed deployment or readiness leaves the holdout unconsumed and never reaches a provider', async () => {
    const { dir, ledgerPath, approvalPath } = await prepare('deploy-fails');
    const before = await readFile(ledgerPath);
    const counters = { jev: 0, luna: 0, segments: 0, maxBodyBytes: 0 };
    const clock = clockFor();
    const artifact = await realRun({ approvalPath, worker: 'studyplanner-ai-proxy', snapshotExec: fixedSnapshot, setB: base.files.B, setC: base.files.C, outputDir: dir, clock,
      transportFactory: (bundle) => createInProcessTransport({ bundle, scenario: { failSegmentStart: true }, clock, counters }) });
    expect(artifact).toMatchObject({ status: 'incomplete_HOLD', stopReason: 'segment_start_failed', holdoutConsumed: false });
    expect((await readFile(ledgerPath)).equals(before)).toBe(true);
    expect(counters.jev + counters.luna).toBe(0);
  }, 120_000);

  it('records the durable exclusive consumption after readiness and before the first provider-exposing turn', async () => {
    const { dir, ledgerPath, approvalPath } = await prepare('ordered');
    const counters = { jev: 0, luna: 0, segments: 0, maxBodyBytes: 0 };
    const clock = clockFor();
    let consumedAtFirstTurn = null;
    const artifact = await realRun({ approvalPath, worker: 'studyplanner-ai-proxy', snapshotExec: fixedSnapshot, setB: base.files.B, setC: base.files.C, outputDir: dir, clock,
      transportFactory: (bundle) => {
        const inner = createInProcessTransport({ bundle, scenario: {}, clock, counters });
        return { async startSegment(spec) {
          const segment = await inner.startSegment(spec);
          const ledgerAtReady = JSON.parse(await readFile(ledgerPath, 'utf8'));
          expect(spec.id > 0 || ledgerAtReady.holdouts.every((item) => item.status === 'sealed_unconsumed')).toBe(true);
          return { ...segment, async runCase(args) {
            if (consumedAtFirstTurn === null) {
              consumedAtFirstTurn = JSON.parse(await readFile(ledgerPath, 'utf8')).holdouts.every((item) => item.status === 'consumed_on_attempt');
              expect(counters.jev + counters.luna).toBe(0);
            }
            return segment.runCase(args);
          } };
        } };
      } });
    expect(consumedAtFirstTurn).toBe(true);
    expect(artifact).toMatchObject({ status: 'awaiting_blind_review', holdoutConsumed: true });
    const spend = (await readFile(artifact.spendLedgerPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    const types = spend.map((line) => line.type);
    expect(types.indexOf('segment_started')).toBeLessThan(types.indexOf('consumption_recorded'));
    expect(types.indexOf('consumption_recorded')).toBeLessThan(types.indexOf('turn_admitted'));
    expect(spend.find((line) => line.type === 'segment_started')).toMatchObject({ bundleSha256: base.workerCodeSha256,
      readiness: { providerAttemptsDuringReadiness: 0, foreignTokenRefused: true }, upload: { casesSha256: expect.any(String) } });
  }, 120_000);

  it('a consumption record that cannot be written forbids every provider send', async () => {
    const { dir, ledgerPath, approvalPath } = await prepare('record-fails');
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
    ledger.holdouts[1].sha256['set.json'] = '0'.repeat(64); // canonical ledger disagrees → refused
    await writeFile(ledgerPath, JSON.stringify(ledger));
    const counters = { jev: 0, luna: 0, segments: 0, maxBodyBytes: 0 };
    const clock = clockFor();
    const artifact = await realRun({ approvalPath, worker: 'studyplanner-ai-proxy', snapshotExec: fixedSnapshot, setB: base.files.B, setC: base.files.C, outputDir: dir, clock,
      transportFactory: (bundle) => createInProcessTransport({ bundle, scenario: {}, clock, counters }) });
    expect(artifact).toMatchObject({ stopReason: 'consumption_record_failed', holdoutConsumed: false });
    expect(counters.jev + counters.luna).toBe(0);
  }, 120_000);

  it('uses only the approved remote-preview path with a minimal generated config and read-only snapshots', async () => {
    expect(EXECUTION_PATH).toEqual({ mode: 'legacy_unstable_dev_remote_preview', workerName: 'studyplanner-ai-proxy' });
    expect(segmentWranglerConfig('studyplanner-ai-proxy')).toEqual({ name: 'studyplanner-ai-proxy', main: 'unit0-runtime.js',
      compatibility_date: '2026-04-10' }); // no routes, triggers, migrations, bindings, vars or env
    expect(unstableDevOptions('/c.json')).toMatchObject({ config: '/c.json', local: false });
    const source = await readFile(join(process.cwd(), 'scripts/jev-contextual-unit0-eval.mjs'), 'utf8');
    expect(source).not.toMatch(/wrangler\.jsonc|workers\/ai-proxy\/wrangler/); // never imports the production config
    expect(source).not.toMatch(/['"](deploy|publish|rollback|triggers|secret)['"]/); // no write-side Wrangler command
    let deployed = false;
    const other = createWorkerTransport({ bundle: { code: '', segmentData: () => '' }, workerName: 'studyplanner-ai-proxy-eval',
      loadWrangler: async () => ({ unstable_dev: async () => { deployed = true; } }) });
    await expect(other.startSegment({ id: 0, expiresAt: Date.now() + 1_800_000 })).rejects.toThrow('approved remote-preview');
    expect(deployed).toBe(false);
    const commands = [];
    await productionSnapshot({ exec: async (args) => { commands.push(args.join(' ')); return '[]'; } });
    expect(commands).toEqual(['deployments list --name studyplanner-ai-proxy --json', 'deployments status --name studyplanner-ai-proxy --json',
      'versions list --name studyplanner-ai-proxy --json']);
    // A snapshot that cannot be taken stops everything before deploy or consumption.
    const blocked = await prepare('snapshot-fails');
    const before = await readFile(blocked.ledgerPath);
    const counters = { jev: 0, luna: 0, segments: 0, maxBodyBytes: 0 };
    const clock = clockFor();
    await expect(realRun({ approvalPath: blocked.approvalPath, worker: 'studyplanner-ai-proxy', setB: base.files.B, setC: base.files.C,
      outputDir: blocked.dir, clock, snapshotExec: async () => { throw new Error('no read access'); },
      transportFactory: (bundle) => createInProcessTransport({ bundle, scenario: {}, clock, counters }) })).rejects.toThrow('no read access');
    expect(counters).toMatchObject({ jev: 0, luna: 0, segments: 0 });
    expect((await readFile(blocked.ledgerPath)).equals(before)).toBe(true);
    // A production change between the snapshots fails the run-terminal gate.
    const changed = await prepare('snapshot-changes');
    let call = 0;
    const artifact = await realRun({ approvalPath: changed.approvalPath, worker: 'studyplanner-ai-proxy', setB: base.files.B, setC: base.files.C,
      outputDir: changed.dir, clock, snapshotExec: async (args) => JSON.stringify({ args, version: call++ < 3 ? 1 : 2 }),
      transportFactory: (bundle) => createInProcessTransport({ bundle, scenario: {}, clock, counters }) });
    expect(artifact.productionIsolation).toMatchObject({ unchanged: false });
    const verdict = runTerminalValidity({ artifact, spendLedgerBytes: await readFile(artifact.spendLedgerPath), roster: buildRoster(
      { B: { corpus: sets.B.corpus, sha256: base.corpusSha256.B }, C: { corpus: sets.C.corpus, sha256: base.corpusSha256.C } }) });
    expect(verdict).toMatchObject({ status: 'FAIL', failures: ['production_snapshot_changed_or_unknown'] });
  }, 180_000);

  it('persists the canonical guards durably in order, and a persistence failure forbids every provider send', async () => {
    const calls = [];
    const recording = { async writeFileDurable(path, data, flag) { calls.push(['write+fsync', basename(path).split('.')[0], flag]);
      await DURABLE_PERSISTENCE.writeFileDurable(path, data, flag); },
    async syncDirectory(directory) { calls.push(['fsync-dir']); await DURABLE_PERSISTENCE.syncDirectory(directory); },
    async rename(from, to) { calls.push(['rename']); await DURABLE_PERSISTENCE.rename(from, to); } };
    const ordered = await prepare('durable-order');
    const counters = { jev: 0, luna: 0, segments: 0, maxBodyBytes: 0 };
    const clock = clockFor();
    let callsAtFirstSend = null;
    const artifact = await realRun({ approvalPath: ordered.approvalPath, worker: 'studyplanner-ai-proxy', snapshotExec: fixedSnapshot, setB: base.files.B, setC: base.files.C,
      outputDir: ordered.dir, clock, persistence: recording,
      transportFactory: (bundle) => {
        const inner = createInProcessTransport({ bundle, scenario: {}, clock, counters });
        return { async startSegment(spec) { const segment = await inner.startSegment(spec);
          return { ...segment, async runCase(args) { callsAtFirstSend ??= calls.length; return segment.runCase(args); } }; } };
      } });
    expect(artifact.holdoutConsumed).toBe(true);
    expect(calls.map((call) => call[0])).toEqual(['write+fsync', 'fsync-dir', 'write+fsync', 'rename', 'fsync-dir']);
    expect(calls[0]).toEqual(['write+fsync', 'consumption-' + sha256Text(base.corpusSha256.B + base.corpusSha256.C), 'wx']);
    expect(callsAtFirstSend).toBe(5); // every guard was synced before the first provider-exposing turn
    for (const failing of ['writeFileDurable', 'syncDirectory', 'rename']) {
      const failed = await prepare('durable-fail-' + failing);
      const before = await readFile(failed.ledgerPath);
      const injected = { ...recording, [failing]: async () => { throw new Error('injected persistence failure'); } };
      const sends = { jev: 0, luna: 0, segments: 0, maxBodyBytes: 0 };
      const result = await realRun({ approvalPath: failed.approvalPath, worker: 'studyplanner-ai-proxy', snapshotExec: fixedSnapshot, setB: base.files.B, setC: base.files.C,
        outputDir: failed.dir, clock, persistence: injected,
        transportFactory: (bundle) => createInProcessTransport({ bundle, scenario: {}, clock, counters: sends }) });
      expect(result).toMatchObject({ stopReason: 'consumption_record_failed', holdoutConsumed: false });
      expect(sends.jev + sends.luna).toBe(0);
      expect((await readFile(failed.ledgerPath)).equals(before)).toBe(true); // the canonical ledger was never replaced
    }
  }, 180_000);

  it('runs the capped smoke on two development cases with the same runtime code and no gate or holdout ledger', async () => {
    const dir = join(directory, 'smoke');
    await mkdir(dir, { recursive: true });
    const approvalPath = join(dir, 'smoke-approval.json');
    await writeFile(approvalPath, JSON.stringify({ approved: true, approvedBy: ['BronzeMaxwell', 'CopperHopper'],
      authority: 'owner DECISION 2 delegation', purpose: 'harness smoke; not evidence', approvedAt: '2026-10-05T00:00:00Z',
      environment: 'isolated_synthetic_smoke', worker: 'studyplanner-ai-proxy', executionPath: { mode: 'legacy_unstable_dev_remote_preview', workerName: 'studyplanner-ai-proxy' }, runtimeSha256: base.runtimeSha256,
      policySha256: base.policySha256, corpusSha256: DEVELOPMENT_CORPUS_SHA256, split: 'calibration', pricing: base.pricing,
      limits: { ...SMOKE_LIMITS }, spendLedgerDirectory: dir }));
    const counters = { jev: 0, luna: 0, segments: 0, maxBodyBytes: 0 };
    const clock = clockFor();
    const smoke = await smokeRun({ approvalPath, worker: 'studyplanner-ai-proxy', snapshotExec: fixedSnapshot, outputDir: dir, clock,
      transportFactory: (bundle) => createInProcessTransport({ bundle, scenario: {}, clock, counters }) });
    expect(smoke).toMatchObject({ status: 'smoke_not_evidence', evidence: 'none', runStatus: 'awaiting_blind_review',
      workerCodeSha256: base.workerCodeSha256, checks: { segments: 2, unaccountedFetchesRefused: 0,
        lunaServedServiceTier: { default: expect.any(Number) } } });
    expect(new Set(smoke.checks.segmentCodeSha256)).toEqual(new Set([base.workerCodeSha256]));
    expect(smoke.checks.budget.capChargedUsd).toBeLessThanOrEqual(0.25);
    expect(smoke.checks.budget.observedDispatches).toBeLessThanOrEqual(32);
    expect(smoke).not.toHaveProperty('decision');
    expect(smoke.pairs).toHaveLength(2);
    expect(smokeCases(JSON.parse(await readFile(join(process.cwd(), 'scripts/jev-contextual-development-corpus.json'), 'utf8')))
      .map((item) => item.questionCode)).toEqual(['quantity_role_unresolved', 'missing_effort_estimate']);
    const tampered = JSON.parse(await readFile(approvalPath, 'utf8'));
    tampered.limits.totalBudgetUsd = 1;
    await writeFile(approvalPath, JSON.stringify(tampered));
    await expect(smokeRun({ approvalPath, worker: 'studyplanner-ai-proxy', snapshotExec: fixedSnapshot, outputDir: dir, clock,
      transportFactory: (bundle) => createInProcessTransport({ bundle, scenario: {}, clock, counters }) })).rejects.toThrow('Smoke caps');
  }, 120_000);
});

afterAll(async () => { await rm(IN_PROCESS_DIRECTORY, { recursive: true, force: true }); });

describe('stops detected at the final boundary and stopped artifacts (no provider)', () => {
  let directory;
  let roster;
  let nominal;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'unit0-r2-final-'));
    await runDryRun({ scenario: 'nominal', outputDir: directory, replicates: 200 });
    roster = buildRoster(await buildMockSets(), { dryRun: true });
    nominal = JSON.parse(await readFile(join(directory, 'nominal', 'results.json'), 'utf8'));
  }, 120_000);
  afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

  it('a tariff violation settled on the very last arm still stops the run', async () => {
    const order = executionOrder(roster.cases.map((item) => item.id));
    const byCase = new Map(nominal.pairs.map((pair) => [pair.caseId, pair]));
    const lastEntry = order.at(-1);
    const lastArm = lastEntry.arms.at(-1);
    const replay = structuredClone(byCase);
    const lastRecord = replay.get(lastEntry.caseId)[lastArm];
    const target = lastRecord.dispatches.find((dispatch) => dispatch.provider === 'luna') ?? lastRecord.dispatches[0];
    if (target.provider === 'luna') target.serviceTier = 'priority'; else target.servedModel = 'typesafe/jev-9';
    const transport = { async startSegment({ id, expiresAt }) {
      return { id, expiresAt, bundleSha256: 'c'.repeat(64), async runCase({ caseId, arm }) { return structuredClone(replay.get(caseId)[arm]); },
        async stop() {} };
    } };
    const ledger = new ConsumptionLedger(null, { limits: PREREGISTERED_LIMITS, pricing: { ...PREREGISTERED_PRICING, source: 'test' } });
    const result = await runSerialEvaluation({ roster, order, transport, ledger, limits: PREREGISTERED_LIMITS });
    expect(result.pairs.every((pair) => pair.jevFirst && pair.lunaOnly)).toBe(true); // every observation present…
    expect(result).toMatchObject({ status: 'incomplete_HOLD', stopReason: 'pricing_contract_violated' }); // …but the run stopped
    expect(ledger.entries.at(-1)).toMatchObject({ type: 'run_aborted', stopReason: 'pricing_contract_violated' });
  }, 120_000);

  it('a correctly bound stopped artifact is decided HOLD through the CLI, never complete', async () => {
    const sets = await buildMockSets();
    const files = { B: join(directory, 'B.json'), C: join(directory, 'C.json'), results: join(directory, 'stopped.json') };
    await writeFile(files.B, JSON.stringify(sets.B.corpus));
    await writeFile(files.C, JSON.stringify(sets.C.corpus));
    const stopped = { ...structuredClone(nominal), status: 'incomplete_HOLD', stopReason: 'provider_failure_rate_exceeded' };
    await writeFile(files.results, JSON.stringify(stopped, null, 2));
    const cli = (args) => spawnSync(process.execPath, [join(process.cwd(), 'scripts/jev-contextual-unit0-eval.mjs'), '--mock-input', ...args,
      '--set-b', files.B, '--set-c', files.C], { encoding: 'utf8', timeout: 120_000 });
    const packetDir = join(directory, 'stopped-packet');
    const blinded = cli(['--blind-packet', '--results', files.results, '--output-dir', packetDir]);
    expect(blinded.status, blinded.stderr).toBe(0);
    const packet = JSON.parse(await readFile(join(packetDir, 'blind-packet.json'), 'utf8'));
    const labels = packet.cases.flatMap((entry) => ['X', 'Y'].map((slot) => ({ caseId: entry.caseId, slot, correct: true, criticalErrors: [],
      source: DRY_RUN_LABEL_SOURCE, reviewer: 'dry-run-fixture-reviewer', model: null, role: 'third_reviewer', rationale: 'fixture',
      armClueDetected: null, viewedScope: { implementation: false, developmentCorpus: false, armKey: false, holdoutSets: [entry.set], outputs: 'blinded_packet' } })));
    const reviewPath = join(directory, 'stopped-review.json');
    await writeFile(reviewPath, JSON.stringify({ schemaVersion: REVIEW_SCHEMA, packetSha256: sha256Text(canonicalJson(packet)),
      bindings: { corpusSha256: packet.corpusSha256, runtimeSha256: packet.runtimeSha256, policySha256: packet.policySha256,
        resultsSha256: packet.resultsSha256 }, labels }));
    const decided = cli(['--decide', '--results', files.results, '--packet', join(packetDir, 'blind-packet.json'),
      '--key', join(packetDir, 'blind-key.json'), '--review', reviewPath]);
    expect(decided.status, decided.stderr).toBe(0);
    const decision = JSON.parse(decided.stdout);
    expect(decision).toMatchObject({ researchGates: 'HOLD', gates: { runTerminal: { status: 'FAIL' }, completeness: { status: 'PASS' } } });
    expect(decision.gates.runTerminal.failures).toEqual(expect.arrayContaining(['run_status_incomplete_HOLD', 'stop_provider_failure_rate_exceeded',
      'spend_ledger_stop_differs']));
  }, 120_000);
});

describe('a charge above its reservation stops further sends in the same turn (Worker boundary)', () => {
  let module;
  let roster;
  const env = { OPENROUTER_API_KEY: 'offline', OPENAI_API_KEY: 'offline' };
  const sent = [];
  beforeAll(async () => {
    roster = buildRoster(await buildMockSets(), { dryRun: true });
    const bundle = await buildWorkerBundle({ cases: workerCases(roster), preSend: preSendFor(DRY_RUN_PRICING), dispatchesPerTurn: 8 });
    ({ module } = await loadBundleInProcess(bundle, { digest: sha256Text('t'), expiresAt: Date.now() + 60_000 }));
  }, 120_000);
  const jev = (choice, cost) => Response.json({ model: 'typesafe/jev-1.13', answers: { contextual_answer: { type: 'choice', choice,
    confidence: 0.999, probabilities: Object.fromEntries(['target', 'remaining', 'completed', 'focused_luna', 'fallback'].map((key) => [key, key === choice ? 0.9996 : 0.0001])) },
  condition_change: { type: 'noul', noul: 0.001 }, independent_meaning: { type: 'noul', noul: 0.001 } }, usage: { input_tokens: 10, output_tokens: 3, cost } });
  const luna = (promptTokens) => Response.json({ model: 'gpt-5.6-luna', service_tier: 'default', choices: [{ message: { content: '{}' } }],
    usage: { prompt_tokens: promptTokens, completion_tokens: 4 } });
  const install = (jevCost, lunaPromptTokens) => {
    sent.length = 0;
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      sent.push(String(url));
      return String(url).includes('/decisions') ? jev('fallback', jevCost) : luna(lunaPromptTokens);
    }));
  };
  const run = (item, arm) => module.runTurn(item, env, new AbortController().signal, arm, { budgetRemainingUsd: 0.25, runState: freshRunState() });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('Jev reports more than its reservation, then would fall back to Luna: no Luna send follows', async () => {
    const item = roster.cases.find((entry) => entry.questionCode === 'quantity_role_unresolved');
    install(0.00001, 20);
    const control = await run(item, 'jevFirst');
    expect(control.dispatches.filter((dispatch) => dispatch.provider === 'luna').length).toBeGreaterThan(0); // the fallback normally sends
    install(0.25, 20);
    const record = await run(item, 'jevFirst');
    expect(record.preSend.stopLatched).toBe('pricing_contract_violated');
    expect(record.dispatches.map((dispatch) => dispatch.provider)).toEqual(['jev']);
    expect(sent.filter((url) => url.includes('chat/completions'))).toHaveLength(0);
    expect(record.preSend.refusedSends).toBeGreaterThan(0);
  });

  it('a Luna usage bound above its reservation stops the following Luna sends', async () => {
    const effort = roster.cases.find((entry) => entry.questionCode === 'missing_effort_estimate');
    install(0.00001, 20);
    const control = await run(effort, 'lunaOnly');
    expect(control.dispatches.length).toBeGreaterThan(1); // retries/repair normally follow
    install(0.00001, 10_000_000);
    const record = await run(effort, 'lunaOnly');
    expect(record.preSend.stopLatched).toBe('pricing_contract_violated');
    expect(record.dispatches).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it('a reported overcharge with missing usage also stops further sends, and the run stops after the turn', async () => {
    const item = roster.cases.find((entry) => entry.questionCode === 'quantity_role_unresolved');
    sent.length = 0;
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      sent.push(String(url));
      if (!String(url).includes('/decisions')) return luna(20);
      const response = await jev('fallback', 0.25).json();
      delete response.usage.input_tokens; delete response.usage.output_tokens;
      return Response.json(response);
    }));
    const record = await run(item, 'jevFirst');
    expect(record.preSend.stopLatched).toBe('pricing_contract_violated');
    expect(sent.filter((url) => url.includes('chat/completions'))).toHaveLength(0);
    const ledger = new ConsumptionLedger(null, { limits: PREREGISTERED_LIMITS, pricing: { ...PREREGISTERED_PRICING, source: 'test' } });
    await ledger.settle({}, record);
    expect(ledger.admission({ elapsedMs: 0 })).toEqual({ admit: false, reason: 'pricing_contract_violated' });
    expect(ledger.totals().openReservationUsd).toBeCloseTo(record.preSend.reservations[0], 12); // missing usage keeps the reservation
  });

  it('the ledger counts a reported amount above the reservation as a violation even without usage', async () => {
    const ledger = new ConsumptionLedger(null, { limits: PREREGISTERED_LIMITS, pricing: { ...PREREGISTERED_PRICING, source: 'test' } });
    await ledger.settle({}, { dispatches: [{ provider: 'jev', phase: 'focused', status: 'evaluated', outcome: 'response', httpStatus: null,
      servedModel: 'typesafe/jev-1.13', serviceTier: null, inputTokens: null, outputTokens: null, costUsd: 0.25 }],
    preSend: { reservedUsd: 0.0003, reservations: [0.0003], refusedSends: 0 }, elapsedMs: 1 });
    expect(ledger.totals()).toMatchObject({ openReservationUsd: 0.0003, settlementUsd: 0 });
    expect(ledger.admission({ elapsedMs: 0 })).toEqual({ admit: false, reason: 'pricing_contract_violated' });
  });
});
