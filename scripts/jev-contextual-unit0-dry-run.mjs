import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConsumptionLedger, PREREGISTERED_LIMITS, PREREGISTERED_PRICING, SEGMENT_TOKEN_LIFETIME_MS, reservePerCallUsd,
  validateLimits } from './jev-contextual-unit0-budget.mjs';
import { DRY_RUN_STATUS, R2_ARTIFACT_SCHEMA, buildRoster, buildWorkerBundle, decideFromArtifacts, loadBundleInProcess, preSendFor,
  runSerialEvaluation, workerCases } from './jev-contextual-unit0-eval.mjs';
import { executionOrder } from './jev-contextual-unit0-random.mjs';
import { DRY_RUN_LABEL_SOURCE, REVIEW_SCHEMA, canonicalJson, createBlindPacket, sha256Text } from './jev-contextual-unit0-review.mjs';

// Mock-only demonstration of every stop path and of the complete decision
// computation. No network: the mock fetch refuses every URL other than the
// two provider endpoints and never forwards. Inputs are generated mocks built
// from the development corpus wording, never the sealed holdouts. Nothing
// produced here is evidence, and fixture labels carry a fixture-only source.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The preregistration §19a values, used here only to exercise the arithmetic.
export const DRY_RUN_PRICING = Object.freeze({ ...PREREGISTERED_PRICING, source: 'dry-run copy of preregistration §19a values' });

export async function buildMockSets() {
  const development = JSON.parse(await readFile(join(ROOT, 'scripts/jev-contextual-development-corpus.json'), 'utf8'));
  const make = (stratum, groups) => {
    const cases = [];
    for (let group = 0; group < groups; group += 1) {
      for (let variant = 0; variant < 2; variant += 1) {
        const source = development.cases[(group * 2 + variant) % development.cases.length];
        const n = String(group * 2 + variant + 1).padStart(3, '0');
        cases.push({ id: `mock-${stratum}-${n}`, group: `mock-${stratum}-g${String(group + 1).padStart(2, '0')}`, split: 'holdout',
          questionCode: source.questionCode, userText: source.userText, taskTitle: source.taskTitle,
          targetAmount: source.targetAmount, unitCode: source.unitCode, unitLabel: source.unitLabel,
          ...(source.progressBasis ? { progressBasis: true } : {}), labelSource: 'synthetic_unreviewed' });
      }
    }
    const corpus = { version: `dry-run-mock-${stratum}`, population: 'synthetic_weekly_planning', status: DRY_RUN_STATUS,
      provenance: { generator: { model: 'none', agent: `dry-run-mock-author-${stratum}` }, gold: false,
        tuningExposure: false, derivedFromConsumedHoldout: false, note: 'Mock built from development wording; not a holdout.' },
      cases };
    const bytes = Buffer.from(JSON.stringify(corpus));
    return { corpus, sha256: sha256Text(bytes) };
  };
  return { B: make('B', 30), C: make('C', 35) };
}

const jevResponse = (choice, cost = 0.00001) => Response.json({ model: 'typesafe/jev-1.13',
  answers: { contextual_answer: { type: 'choice', choice, confidence: 0.999,
    probabilities: Object.fromEntries(['target', 'remaining', 'completed', 'focused_luna', 'fallback']
      .map((key) => [key, key === choice ? 0.9996 : 0.0001])) },
  condition_change: { type: 'noul', noul: 0.001 }, independent_meaning: { type: 'noul', noul: 0.001 } },
  usage: { input_tokens: 10, output_tokens: 3, cost } });
const lunaResponse = ({ noUsage, serviceTier = 'default' }) => Response.json({ model: 'gpt-5.6-luna',
  ...(serviceTier === null ? {} : { service_tier: serviceTier }),
  choices: [{ message: { content: JSON.stringify({ decision: 'quantity_role_answer', effortTarget: null,
    effortMeasurement: null, minutes: null, precision: null, quantityRole: 'target' }) } }],
  ...(noUsage ? {} : { usage: { prompt_tokens: 20, completion_tokens: 4 } }) });

// Provider behavior per scenario. lunaStatus(n) returns an HTTP status for
// the n-th Luna call (1-based), or 200.
const SCENARIOS = {
  nominal: { describe: 'all calls succeed with usage; the bound-based cost gate is computed' },
  'tariff-mismatch': { describe: 'Luna serves a non-standard service tier: tariff bounds are void and the run stops', lunaServiceTier: 'priority' },
  'tariff-unreported': { describe: 'Luna omits the served tier: it is not assumed standard; the run stops', lunaServiceTier: null },
  budget: { describe: 'hard cap tightened to USD 0.5 (dry-run only) and Luna usage missing: open reservations reach the cap before any send past it',
    limits: { totalBudgetUsd: 0.5 }, lunaNoUsage: true },
  'pricing-violation': { describe: 'Jev reports a cost above its reservation: the rate contract is broken, the run stops', jevCost: 0.25 },
  'missing-usage': { describe: 'Luna returns no usage: every Luna reservation stays open and settled cost stays incomplete', lunaNoUsage: true },
  'presend-refusal': { describe: 'dry-run Luna max input lowered to 3,000 tokens; every Luna request is refused before exposure',
    luna: { maxInputTokensPerCall: 3_000 } },
  'dispatch-cap': { describe: 'tightened total-attempt cap (dry-run only) stops before exceeding it', limits: { totalDispatches: 40 } },
  'per-turn-cap': { describe: 'tightened per-turn cap (dry-run only): Jev fallback, Luna send refused in the Worker',
    limits: { dispatchesPerTurn: 1 }, jevChoice: 'fallback' },
  'failure-rate': { describe: 'two of three Luna calls 503 (never five in a row); cumulative rate > 20% after 20 attempts',
    lunaStatus: (n) => (n % 3 === 0 ? 200 : 503) },
  'consecutive-failures': { describe: 'every Luna call 503 and Jev network failure: five consecutive infrastructure failures before 20 attempts',
    lunaStatus: () => 503, jevNetworkFailure: true },
  configuration: { describe: 'Luna HTTP 401 stops immediately', lunaStatus: () => 401 },
  'token-rotation': { describe: '15 s per turn: the run spans several 30-minute token segments with one ledger', turnMs: 15_000 },
  elapsed: { describe: '30 s per turn exceeds the 5,400 s cap', turnMs: 30_000 },
  'segment-start-failure': { describe: 'the first segment deployment fails before any provider exposure', failSegmentStart: true },
  'token-expiry': { describe: 'segment token is refused mid-run (clock skew); the turn is unsettled, nothing is invented', expireAfterTurns: 7 },
};
export const DRY_RUN_SCENARIOS = Object.keys(SCENARIOS);

function mockFetchFor(scenario, counters) {
  return async (url, init) => {
    const target = String(url);
    assert.ok(typeof init?.body === 'string', 'Mock provider requires a serialized body.');
    counters.maxBodyBytes = Math.max(counters.maxBodyBytes, Buffer.byteLength(init.body));
    if (target === 'https://openrouter.ai/api/alpha/decisions') {
      counters.jev += 1;
      if (scenario.jevNetworkFailure) throw new TypeError('mock network failure');
      return jevResponse(scenario.jevChoice ?? 'target', scenario.jevCost);
    }
    if (target === 'https://api.openai.com/v1/chat/completions') {
      counters.luna += 1;
      const status = scenario.lunaStatus?.(counters.luna) ?? 200;
      if (status !== 200) return new Response('mock failure', { status });
      return lunaResponse({ noUsage: scenario.lunaNoUsage, serviceTier: scenario.lunaServiceTier });
    }
    throw new Error('Dry-run refuses unexpected network target.');
  };
}

// In-process transport over the very same runtime code: each segment writes
// the identical code file plus its own data module (token digest, expiry),
// passes the same readiness and foreign-token checks over the HTTP handler,
// and runs cases through that handler with the mock provider installed.
export function createInProcessTransport({ bundle, scenario, clock, counters }) {
  let turns = 0;
  const env = { OPENROUTER_API_KEY: 'dry-run', OPENAI_API_KEY: 'dry-run' };
  return {
    async startSegment({ id, expiresAt }) {
      clock.advance(20_000); // modeled deployment time, counted in elapsed
      if (scenario.failSegmentStart) throw new Error('mock deployment failure');
      const token = randomBytes(32).toString('hex');
      // The handler's own expiry uses the real clock; the virtual expiry is
      // enforced below, so the baked value is the later of the two.
      const { module, codeSha256, directory } = await loadBundleInProcess(bundle,
        { digest: sha256Text(token), expiresAt: Math.max(expiresAt, Date.now() + SEGMENT_TOKEN_LIFETIME_MS) });
      const call = (path, init = {}, bearer = token) => module.default.fetch(new Request('https://eval' + path,
        { ...init, headers: { ...(init.headers ?? {}), Authorization: 'Bearer ' + bearer } }), env);
      const ready = await call('/ready');
      assert.equal(ready.status, 200);
      assert.deepEqual(await ready.json(), { openRouter: true, openAi: true, fetchGuard: true,
        providerAttemptsDuringReadiness: 0, cases: bundle.caseCount });
      assert.equal((await call('/ready', {}, randomBytes(32).toString('hex'))).status, 404);
      counters.segments += 1;
      return { id, expiresAt, bundleSha256: codeSha256,
        readiness: { fetchGuard: true, foreignTokenRefused: true, providerAttemptsDuringReadiness: 0 },
        upload: { deployedAt: new Date(clock.now()).toISOString(), location: 'in-process mock', casesSha256: bundle.casesSha256 },
        async runCase({ caseId, arm, budgetRemainingUsd, runState }) {
          turns += 1;
          if (scenario.expireAfterTurns && turns > scenario.expireAfterTurns) {
            throw Object.assign(new Error('Segment token refused.'), { reason: 'token_refused_or_expired' });
          }
          if (clock.now() > expiresAt) throw Object.assign(new Error('Segment token expired.'), { reason: 'token_refused_or_expired' });
          const original = globalThis.fetch;
          const info = console.info;
          console.info = () => undefined; // runtime decision logs are not dry-run output
          globalThis.fetch = mockFetchFor(scenario, counters);
          try {
            const response = await call('/case', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ caseId, arm, budgetRemainingUsd, runState }) });
            assert.equal(response.status, 200);
            return await response.json();
          } finally {
            globalThis.fetch = original;
            console.info = info;
            clock.advance(scenario.turnMs ?? 2_000);
          }
        },
        async stop() { await rm(directory, { recursive: true, force: true }); } };
    },
  };
}

export async function runDryRun({ scenario: name, outputDir, replicates = 20_000 }) {
  const scenario = SCENARIOS[name];
  assert.ok(scenario, 'Unknown dry-run scenario.');
  const directory = join(outputDir, name);
  await mkdir(directory, { recursive: true });
  const sets = await buildMockSets();
  const roster = buildRoster(sets, { dryRun: true });
  const pricing = { ...DRY_RUN_PRICING, luna: { ...DRY_RUN_PRICING.luna, ...(scenario.luna ?? {}) } };
  const reserve = reservePerCallUsd(pricing);
  const limits = validateLimits({ ...PREREGISTERED_LIMITS, ...(scenario.limits ?? {}) }, { dryRun: true });
  const cases = workerCases(roster);
  const bundle = await buildWorkerBundle({ cases, preSend: preSendFor(pricing), dispatchesPerTurn: limits.dispatchesPerTurn });
  let now = Date.now();
  const clock = { now: () => now, advance: (ms) => { now += ms; } };
  const counters = { jev: 0, luna: 0, segments: 0, maxBodyBytes: 0 };
  const ledgerPath = join(directory, 'spend-ledger.jsonl');
  const ledger = await ConsumptionLedger.create(ledgerPath, { runId: 'dry-run-' + name, dryRun: true, limits,
    pricing, corpusSha256: roster.corpusSha256, workerBundleSha256: bundle.templateSha256, pricingSource: pricing.source });
  const order = executionOrder(roster.cases.map((item) => item.id));
  const result = await runSerialEvaluation({ roster, order, ledger, limits, clock,
    transport: createInProcessTransport({ bundle, scenario, clock, counters }),
    verifyFrozenInputs: async () => ({ workerBundleSha256: bundle.templateSha256, dryRun: true }) });
  const artifact = { schemaVersion: R2_ARTIFACT_SCHEMA, dryRun: true, runId: 'dry-run-' + name, corpusSha256: roster.corpusSha256,
    pricingVersion: PREREGISTERED_PRICING.version,
    runtimeSha256: 'd'.repeat(64), policySha256: 'e'.repeat(64), workerBundleSha256: bundle.templateSha256,
    attemptedAt: new Date(now).toISOString(), expectedTurns: roster.cases.length * 2, spendLedgerPath: ledgerPath, ...result };
  const artifactBytes = Buffer.from(JSON.stringify(artifact, null, 2));
  await writeFile(join(directory, 'results.json'), artifactBytes);
  const summary = { scenario: name, describe: scenario.describe, dryRun: true, evidence: 'none',
    status: result.status, stopReason: result.stopReason, ledgerTotals: result.ledgerTotals,
    providerCallsSeenByMock: { jev: counters.jev, luna: counters.luna }, segments: result.segments.length,
    maxRequestBodyBytes: counters.maxBodyBytes, reservePerCallUsd: reserve, limits,
    pairsObserved: result.pairs.filter((pair) => pair.jevFirst && pair.lunaOnly).length,
    refusedSends: result.pairs.reduce((sum, pair) => sum + ['jevFirst', 'lunaOnly']
      .reduce((total, arm) => total + (pair[arm]?.preSend.refusedSends ?? 0), 0), 0) };
  // Ledger totals must equal the mock's own count of physical sends.
  assert.equal(result.ledgerTotals.observedDispatches, counters.jev + counters.luna, 'Ledger disagrees with physical sends.');
  if (result.status === 'awaiting_blind_review') {
    const resultsSha256 = sha256Text(artifactBytes);
    const bindings = { corpusSha256: roster.corpusSha256, runtimeSha256: artifact.runtimeSha256,
      policySha256: artifact.policySha256, resultsSha256 };
    const { packet, key, packetSha256 } = createBlindPacket({ roster, pairs: result.pairs, bindings });
    const scope = (set) => ({ implementation: false, developmentCorpus: false, armKey: false, holdoutSets: [set], outputs: 'blinded_packet' });
    const review = { schemaVersion: REVIEW_SCHEMA, packetSha256, bindings,
      labels: packet.cases.flatMap((entry) => ['X', 'Y'].map((slot) => ({ caseId: entry.caseId, slot, correct: true,
        criticalErrors: [], source: DRY_RUN_LABEL_SOURCE, reviewer: 'dry-run-fixture-reviewer', model: null,
        viewedScope: scope(entry.set), role: 'third_reviewer', rationale: 'Fixture label for computation only; not a judgment.',
        armClueDetected: null }))) };
    await writeFile(join(directory, 'blind-packet.json'), canonicalJson(packet));
    await writeFile(join(directory, 'blind-key.json'), canonicalJson(key));
    await writeFile(join(directory, 'fixture-review.json'), canonicalJson(review));
    const decision = decideFromArtifacts({ roster, artifactBytes, spendLedgerBytes: await readFile(ledgerPath), packet, key, review, replicates });
    await writeFile(join(directory, 'decision.json'), JSON.stringify(decision, null, 2));
    summary.decision = { researchGates: decision.researchGates, failing: decision.failing,
      dispatch: decision.gates.dispatchReduction, cost: decision.gates.cost.status, costDetail: decision.gates.cost,
      latency: decision.gates.latency.status };
  }
  await writeFile(join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
  return summary;
}
