import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createPairedWorkerSource } from './jev-contextual-paired-runtime.mjs';
import { validateArm } from './jev-contextual-paired-artifact.mjs';
import { runtimeFingerprint, sha256, validateCorpus } from './jev-contextual-paired-eval.mjs';
import { ARM_TOKEN_RESERVE_MS, ConsumptionLedger, PREREGISTERED_LIMITS, PREREGISTERED_PRICING, SEGMENT_TOKEN_LIFETIME_MS,
  EARLY_CONSECUTIVE_INFRA_FAILURES, FAILURE_RATE_MINIMUM_ATTEMPTS, TURN_TIMEOUT_MS, reservePerCallUsd, segmentCanHost, validateLimits,
  validatePricing, workerRates } from './jev-contextual-unit0-budget.mjs';
import { DECISION_RULES, evaluateUnit0 } from './jev-contextual-unit0-decision.mjs';
import { codePointCompare, executionOrder } from './jev-contextual-unit0-random.mjs';
import { DEVELOPMENT_VIEWERS, canonicalJson, createBlindPacket, importBlindReview, sha256Text } from './jev-contextual-unit0-review.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const R2_ARTIFACT_SCHEMA = 'jev-unit0-paired-r2';
export const DRY_RUN_STATUS = 'dry_run_mock_not_evidence';
// Preregistration r2 §0: both holdouts, every case, fixed sizes; nothing may
// be excluded. Weights follow case counts (60:70) through the case mean.
export const ROSTER_SPEC = Object.freeze({
  B: Object.freeze({ cases: 60, groups: 30 }),
  C: Object.freeze({ cases: 70, groups: 35 }),
});
const STRATA = ['B', 'C'];
const ARMS = ['jevFirst', 'lunaOnly'];

// One holdout artifact per stratum. A dry-run mock is structurally validated
// by the same holdout validator but must declare itself as a mock.
export function validateHoldoutSet(corpus, stratum, { dryRun = false } = {}) {
  assert.ok(STRATA.includes(stratum));
  let cases;
  if (dryRun) {
    assert.equal(corpus.status, DRY_RUN_STATUS, 'Dry-run inputs must be explicit mocks.');
    cases = validateCorpus({ ...corpus, status: 'sealed_unconsumed' }, 'holdout');
  } else {
    cases = validateCorpus(corpus, 'holdout');
    assert.ok(!DEVELOPMENT_VIEWERS.includes(corpus.provenance.generator.agent), 'Development viewers cannot author r2 holdouts.');
  }
  assert.ok(typeof corpus.provenance.generator?.agent === 'string' && corpus.provenance.generator.agent.trim());
  const groups = new Map();
  for (const item of cases) groups.set(item.group, [...(groups.get(item.group) ?? []), item.id]);
  assert.equal(cases.length, corpus.cases.length);
  assert.equal(cases.length, ROSTER_SPEC[stratum].cases, `Holdout ${stratum} must roster exactly ${ROSTER_SPEC[stratum].cases} cases.`);
  assert.equal(groups.size, ROSTER_SPEC[stratum].groups, `Holdout ${stratum} must roster exactly ${ROSTER_SPEC[stratum].groups} groups.`);
  assert.ok([...groups.values()].every((ids) => ids.length === 2), 'Each preregistered group has exactly two cases.');
  return { cases, groups };
}

export function buildRoster({ B, C }, { dryRun = false } = {}) {
  const sets = { B, C };
  const cases = [];
  const strata = [];
  const authors = {};
  for (const stratum of STRATA) {
    const { corpus, sha256: hash } = sets[stratum];
    assert.match(hash, /^[a-f0-9]{64}$/);
    const { cases: items, groups } = validateHoldoutSet(corpus, stratum, { dryRun });
    authors[stratum] = corpus.provenance.generator.agent;
    strata.push({ id: stratum, sha256: hash, version: corpus.version,
      groups: [...groups.keys()].sort(codePointCompare).map((id) => ({ id, caseIds: [...groups.get(id)].sort(codePointCompare) })) });
    for (const item of items) cases.push({ ...item, stratum });
  }
  assert.equal(new Set(cases.map((item) => item.id)).size, cases.length, 'Case IDs collide across holdouts.');
  const groupOwners = new Map();
  for (const item of cases) {
    assert.ok(!groupOwners.has(item.group) || groupOwners.get(item.group) === item.stratum, 'Group IDs collide across holdouts.');
    groupOwners.set(item.group, item.stratum);
  }
  assert.notEqual(authors.B, authors.C, 'The two holdouts need distinct authors for cross adjudication.');
  return { strata, cases, authors, corpusSha256: { B: sets.B.sha256, C: sets.C.sha256 }, dryRun };
}

// Approval is the B/C agreement under owner DECISION 2 delegation. It restates
// every frozen value; the harness compares and never takes numbers from it.
export function validateApprovalR2(approval, { roster, runtimeSha256, policySha256, worker }) {
  assert.equal(approval.approved, true);
  assert.deepEqual([...approval.approvedBy].sort(), ['BronzeMaxwell', 'CopperHopper']);
  assert.equal(approval.authority, 'owner DECISION 2 delegation');
  assert.ok(Number.isFinite(Date.parse(approval.approvedAt)));
  assert.equal(approval.environment, 'isolated_synthetic_evaluation');
  validateExecutionPath(approval, worker); // §19e replaces the former "*-eval" name rule
  assert.equal(approval.catalogVersion, 'focused-contextual-answer-2026-10-04-v3');
  assert.equal(approval.gateVersion, 'contextual-conservative-v2-calibrated');
  assert.equal(approval.runtimeSha256, runtimeSha256, 'Runtime changed after preregistration.');
  assert.equal(approval.policySha256, policySha256, 'Catalog/gate changed after preregistration.');
  assert.deepEqual(approval.corpusSha256, roster.corpusSha256, 'Holdout bytes differ from the approval.');
  for (const stratum of STRATA) assert.match(approval.rubricSha256?.[stratum] ?? '', /^[a-f0-9]{64}$/);
  assert.deepEqual(approval.limits, { ...PREREGISTERED_LIMITS }, 'Execution limits differ from preregistration.');
  assert.deepEqual(approval.decisionRules, { ...DECISION_RULES }, 'Decision rules differ from preregistration.');

  validatePricing(approval.pricing);
  const { source: _source, ...contract } = approval.pricing;
  assert.deepEqual(contract, structuredClone(PREREGISTERED_PRICING), 'Tariff contract differs from preregistration.');
  assert.ok(typeof approval.canonicalLedgerPath === 'string' && approval.canonicalLedgerPath);
  assert.ok(typeof approval.spendLedgerDirectory === 'string' && approval.spendLedgerDirectory);
  assert.match(approval.preregistration?.sha256 ?? '', /^[a-f0-9]{64}$/);
  assert.match(approval.workerCodeSha256 ?? '', /^[a-f0-9]{64}$/, 'The approval must pin the smoke-tested Worker code.');
  return approval;
}

// The parent's canonical single-consumption ledger. The attempt is recorded
// exclusively before any provider exposure; hash or state mismatch refuses.
// Durable persistence for the canonical consumption guards: each file is
// written and fsynced before close, and the containing directory is fsynced
// after the create and after the rename, so the marker and the replaced
// ledger survive an interruption once this resolves. Any failure rejects,
// which forbids the first provider exposure. (Mock tests inject failures to
// check the order; they do not simulate power loss.)
export const DURABLE_PERSISTENCE = Object.freeze({
  async writeFileDurable(path, data, flag) {
    const handle = await open(path, flag);
    try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
  },
  async syncDirectory(directory) {
    const handle = await open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  },
  rename,
});

export async function recordConsumptionAttempt({ ledgerPath, roster, rubricSha256, runId, spendLedgerPath,
  persistence = DURABLE_PERSISTENCE }) {
  const before = await readFile(ledgerPath);
  const ledger = JSON.parse(before.toString('utf8'));
  for (const stratum of STRATA) {
    const entry = ledger.holdouts?.find((item) => item.id === 'holdout-' + stratum);
    assert.ok(entry, `Canonical ledger lacks holdout-${stratum}.`);
    // B froze its set as holdout.json, C as set.json; exactly one is present.
    const setHashes = ['holdout.json', 'set.json'].filter((name) => Object.hasOwn(entry.sha256 ?? {}, name));
    assert.equal(setHashes.length, 1, `holdout-${stratum} must register exactly one set file hash.`);
    assert.equal(entry.sha256[setHashes[0]], roster.corpusSha256[stratum], `holdout-${stratum} hash differs from the canonical ledger.`);
    assert.equal(entry.sha256?.['rubric.json'], rubricSha256[stratum], `holdout-${stratum} rubric hash differs from the canonical ledger.`);
    assert.equal(entry.status, 'sealed_unconsumed', `holdout-${stratum} is not unconsumed.`);
    assert.ok(Array.isArray(entry.consumptionAttempts) && entry.consumptionAttempts.length === 0);
  }
  const marker = join(dirname(ledgerPath), `consumption-${sha256Text(roster.corpusSha256.B + roster.corpusSha256.C)}.json`);
  const startedAt = new Date().toISOString();
  const directory = dirname(ledgerPath);
  // The exclusive marker is the restart guard: a second attempt fails here.
  await persistence.writeFileDurable(marker, JSON.stringify({ runId, startedAt, corpusSha256: roster.corpusSha256, spendLedgerPath }), 'wx');
  await persistence.syncDirectory(directory);
  for (const stratum of STRATA) {
    const entry = ledger.holdouts.find((item) => item.id === 'holdout-' + stratum);
    entry.status = 'consumed_on_attempt';
    entry.consumptionAttempts.push({ runId, startedAt, harness: 'scripts/jev-contextual-unit0-eval.mjs', marker, spendLedgerPath,
      note: 'Recorded before provider exposure; failure or interruption does not restore the holdout.' });
  }
  const current = await readFile(ledgerPath);
  assert.ok(current.equals(before), 'Canonical ledger changed concurrently; refusing.');
  const temporary = ledgerPath + '.' + runId + '.tmp';
  await persistence.writeFileDurable(temporary, JSON.stringify(ledger, null, 2) + '\n', 'wx');
  await persistence.rename(temporary, ledgerPath);
  await persistence.syncDirectory(directory);
  return { marker, startedAt, durable: true };
}

// Serial AB/BA execution over the preregistered order. All caps are checked
// before each turn; the token segment is rotated only between pairs where
// possible, and every segment shares one ledger, one clock and one budget.
// beforeFirstProviderTurn runs once, after the first segment is deployed and
// ready and immediately before the first turn that can reach a provider; the
// holdout run records its single consumption there. A failure in it stops
// the run with no provider exposure.
export async function runSerialEvaluation({ roster, order, transport, ledger, limits, clock = Date,
  verifyFrozenInputs = async () => ({}), beforeFirstProviderTurn = null, rotateSegmentAfterPairs = null }) {
  const index = new Map(roster.cases.map((item) => [item.id, item]));
  const pairs = new Map();
  const segments = [];
  const runStart = clock.now();
  const at = () => clock.now() - runStart;
  let segment = null;
  let stopReason = null;
  let consumed = beforeFirstProviderTurn === null ? null : false;
  let pairsInSegment = 0;
  const stopSegment = async () => {
    if (!segment) return;
    const stopped = segment;
    segment = null;
    try { await stopped.stop(); } finally { await ledger.append({ type: 'segment_stopped', segmentId: stopped.id, at: at() }); }
  };
  // Returns a stop reason, or null once a ready segment can host `arms` turns.
  const ensureSegment = async (arms, force) => {
    if (!force && segmentCanHost(segment, clock.now(), arms)) return null;
    pairsInSegment = 0;
    await stopSegment();
    // Runtime, policy, bundle and inputs are re-verified before every
    // segment; a mismatch stops the run rather than deploying other code.
    let frozen;
    try { frozen = await verifyFrozenInputs(); } catch { return 'frozen_input_changed'; }
    const id = segments.length;
    const expiresAt = clock.now() + SEGMENT_TOKEN_LIFETIME_MS; // fixed before the deployment starts
    // A failed deployment or readiness check exposes no provider; it still
    // ends the run, recorded, without an automatic retry.
    try { segment = await transport.startSegment({ id, expiresAt }); } catch (error) {
      await ledger.append({ type: 'segment_start_failed', segmentId: id, at: at(),
        error: String(error?.message ?? 'unknown').slice(0, 200) }); // harness message only; no case text
      return 'segment_start_failed';
    }
    segments.push({ id, expiresAt: expiresAt - runStart, startedAt: at() });
    // Upload/exposure provenance is recorded separately from consumption.
    await ledger.append({ type: 'segment_started', segmentId: id, at: at(), expiresAt: expiresAt - runStart,
      bundleSha256: segment.bundleSha256 ?? null, readiness: segment.readiness ?? null, upload: segment.upload ?? null, verified: frozen });
    return segmentCanHost(segment, clock.now(), arms) ? null : 'segment_lifetime_insufficient';
  };
  try {
    outer: for (const entry of order) {
      const item = index.get(entry.caseId);
      const pair = { caseId: item.id, stratum: item.stratum, group: item.group, position: entry.position,
        order: entry.arms, segmentIds: [] };
      pairs.set(item.id, pair);
      // Smoke only: force a token rotation to exercise segments.
      const forceRotation = rotateSegmentAfterPairs !== null && segment !== null && pairsInSegment >= rotateSegmentAfterPairs;
      for (const [armIndex, arm] of entry.arms.entries()) {
        let admission = ledger.admission({ elapsedMs: at() });
        if (!admission.admit) { stopReason = admission.reason; break outer; }
        const armsNeeded = entry.arms.length - armIndex;
        stopReason = await ensureSegment(armsNeeded, forceRotation && armIndex === 0);
        if (stopReason) break outer;
        if (consumed === false) {
          // Deploy and readiness are done; nothing has reached a provider.
          // Re-verify token lifetime, frozen inputs and budget, then make the
          // durable, exclusive consumption record. If it fails, no turn runs.
          let detail;
          try {
            await verifyFrozenInputs();
            admission = ledger.admission({ elapsedMs: at() });
            if (!admission.admit) { stopReason = admission.reason; break outer; }
            detail = await beforeFirstProviderTurn();
          } catch {
            await ledger.append({ type: 'consumption_record_failed', at: at() });
            stopReason = 'consumption_record_failed';
            break outer;
          }
          consumed = true;
          await ledger.append({ type: 'consumption_recorded', at: at(), ...detail });
          // The record may have taken time; the token must still cover the pair.
          stopReason = await ensureSegment(armsNeeded, false);
          if (stopReason) break outer;
          admission = ledger.admission({ elapsedMs: at() });
          if (!admission.admit) { stopReason = admission.reason; break outer; }
        }
        const remaining = limits.totalElapsedMs - at();
        if (remaining <= 0) { stopReason = 'elapsed_cap_reached'; break outer; }
        if (pair.segmentIds.length && !pair.segmentIds.includes(segment.id)) {
          await ledger.append({ type: 'pair_crossed_segments', caseId: item.id, segments: [...pair.segmentIds, segment.id], at: at() });
        }
        pair.segmentIds.push(segment.id);
        const turn = { position: entry.position, caseId: item.id, arm, segmentId: segment.id, startedAt: at() };
        await ledger.admit({ ...turn, allowance: admission.allowance });
        let record;
        try {
          record = await segment.runCase({ caseId: item.id, arm, timeoutMs: Math.min(TURN_TIMEOUT_MS, remaining),
            budgetRemainingUsd: admission.allowance.budgetRemainingUsd, runState: admission.allowance.runState });
          validateArm(record, item, arm, { preSend: true });
          if (!record.observationComplete) throw Object.assign(new Error('Incomplete observation.'), { observedDispatches: record.dispatches });
        } catch (error) {
          await ledger.unsettled(turn, admission.allowance, error?.reason ?? 'turn_failed_or_unverifiable', error?.observedDispatches ?? []);
          stopReason = 'unsettled_turn';
          break outer;
        }
        await ledger.settle(turn, record, admission.allowance);
        pair[arm] = record;
        // A stop found while settling this turn ends the run here, even on the last arm.
        stopReason = ledger.stopReason();
        if (stopReason) break outer;
      }
      pairsInSegment += 1;
    }
  } finally {
    await stopSegment();
  }
  // Final boundary: a latched or contractual stop always survives to the result.
  stopReason = stopReason ?? ledger.stopReason();
  const complete = stopReason === null && roster.cases.every((item) => ARMS.every((arm) => pairs.get(item.id)?.[arm]));
  await ledger.close(complete ? 'run_completed' : 'run_aborted', { stopReason, elapsedMs: at(),
    automaticRerun: false, holdoutConsumed: consumed });
  return { status: complete ? 'awaiting_blind_review' : 'incomplete_HOLD', stopReason, holdoutConsumed: consumed,
    elapsedMs: at(), segments, pairs: [...pairs.values()], ledgerTotals: ledger.totals() };
}

export function validateR2Artifact(artifact, roster) {
  assert.equal(artifact.schemaVersion, R2_ARTIFACT_SCHEMA);
  assert.deepEqual(artifact.corpusSha256, roster.corpusSha256);
  assert.equal(artifact.dryRun, roster.dryRun);
  for (const hash of [artifact.runtimeSha256, artifact.policySha256]) assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(artifact.expectedTurns, roster.cases.length * 2);
  const order = executionOrder(roster.cases.map((item) => item.id));
  const pairs = new Map();
  const index = new Map(roster.cases.map((item) => [item.id, item]));
  for (const pair of artifact.pairs) {
    const item = index.get(pair.caseId);
    assert.ok(item && !pairs.has(pair.caseId), 'Unregistered or duplicate pair.');
    assert.equal(pair.stratum, item.stratum);
    assert.equal(pair.group, item.group);
    assert.deepEqual(pair.order, order[pair.position].arms);
    assert.equal(order[pair.position].caseId, pair.caseId, 'Pair is out of preregistered order.');
    for (const arm of ARMS) if (pair[arm]) validateArm(pair[arm], item, arm, { preSend: true });
    pairs.set(pair.caseId, pair);
  }
  const complete = roster.cases.every((item) => ARMS.every((arm) => pairs.get(item.id)?.[arm]?.observationComplete === true));
  assert.equal(artifact.status, complete && artifact.stopReason === null ? 'awaiting_blind_review' : 'incomplete_HOLD');
  return pairs;
}

// The decision binds four inputs to one another and to the approved run:
// the result bytes (hashed here, never taken from a caller's assertion), the
// packet, the key and the review. The packet is rebuilt from the result and
// the key and must match byte for byte under canonical serialization, so a
// label can only ever apply to the exact output it was given for.
// Run-level terminal validity, a required gate: the run completed with no
// stop, every turn settled, the spend ledger reconciles with the result, and
// (for a holdout run) the single consumption was recorded. A stopped or
// incomplete run keeps its measurements for diagnosis but can never pass.
export function runTerminalValidity({ artifact, spendLedgerBytes, roster }) {
  const failures = [];
  if (artifact.status !== 'awaiting_blind_review') failures.push('run_status_' + artifact.status);
  if (artifact.stopReason !== null) failures.push('stop_' + artifact.stopReason);
  if (!roster.dryRun && artifact.holdoutConsumed !== true) failures.push('consumption_not_recorded');
  if (!roster.dryRun && artifact.productionIsolation?.unchanged !== true) failures.push('production_snapshot_changed_or_unknown');
  if (!roster.dryRun && JSON.stringify(artifact.executionPath) !== JSON.stringify(EXECUTION_PATH)) failures.push('execution_path_not_approved');
  if (!Buffer.isBuffer(spendLedgerBytes)) failures.push('spend_ledger_missing');
  else {
    let lines = [];
    try { lines = spendLedgerBytes.toString('utf8').trim().split('\n').map((line) => JSON.parse(line)); } catch { failures.push('spend_ledger_unreadable'); }
    const header = lines[0], last = lines.at(-1);
    if (!header || header.type !== 'run_started' || header.runId !== artifact.runId) failures.push('spend_ledger_run_mismatch');
    if (!lines.every((line, index) => line.sequence === index)) failures.push('spend_ledger_sequence_gap');
    if (!last || last.type !== 'run_completed' || last.stopReason !== null) failures.push('spend_ledger_not_completed');
    if ((last?.stopReason ?? null) !== artifact.stopReason) failures.push('spend_ledger_stop_differs');
    const totals = last?.totals ?? {};
    if (totals.settledTurns !== roster.cases.length * 2 || totals.unsettledTurns !== 0) failures.push('spend_ledger_turns');
    if (totals.latchedStop !== null || totals.pricingContractViolations !== 0 || totals.configurationFailures !== 0) failures.push('spend_ledger_stop_state');
    if (JSON.stringify(totals) !== JSON.stringify(artifact.ledgerTotals)) failures.push('spend_ledger_totals_differ');
    if (!roster.dryRun && !lines.some((line) => line.type === 'consumption_recorded')) failures.push('spend_ledger_no_consumption');
  }
  return { status: failures.length ? 'FAIL' : 'PASS', failures };
}

export function decideFromArtifacts({ roster, artifactBytes, spendLedgerBytes, packet, key, review, approval = null, replicates }) {
  assert.ok(Buffer.isBuffer(artifactBytes), 'The decision needs the actual result bytes.');
  const artifact = JSON.parse(artifactBytes.toString('utf8'));
  const pairs = validateR2Artifact(artifact, roster);
  assert.equal(artifact.pricingVersion, PREREGISTERED_PRICING.version, 'Results were produced under another tariff contract.');
  if (!roster.dryRun) {
    assert.ok(approval, 'A real decision needs the approval the run was executed under.');
    for (const field of ['runtimeSha256', 'policySha256', 'corpusSha256', 'rubricSha256']) {
      assert.deepEqual(artifact[field], approval[field], 'Results differ from the approved run: ' + field);
    }
  }
  const bindings = { corpusSha256: roster.corpusSha256, runtimeSha256: artifact.runtimeSha256,
    policySha256: artifact.policySha256, resultsSha256: sha256(artifactBytes) };
  for (const [field, value] of Object.entries(bindings)) {
    assert.deepEqual(packet[field], value, 'Packet is not bound to these results: ' + field);
  }
  const rebuilt = createBlindPacket({ roster, pairs: [...pairs.values()], bindings, slots: key.slots });
  assert.equal(canonicalJson(rebuilt.packet), canonicalJson(packet), 'Packet does not project these results.');
  assert.equal(rebuilt.keySha256, packet.keySha256, 'Arm key does not match the packet.');
  const labels = importBlindReview({ review, packet, key, roster, dryRun: roster.dryRun });
  return evaluateUnit0({ roster, pairs, labels, dryRun: roster.dryRun, runTerminal: runTerminalValidity({ artifact, spendLedgerBytes, roster }),
    ...(replicates ? { replicates } : {}) });
}

// The evaluation Worker is bundled once per run as RUNTIME CODE ONLY. Case
// data, the token digest and the unchanged 30-minute expiry live in a separate
// generated data module, so the code bytes (codeSha256) are identical for the
// development smoke, every holdout segment and the in-process dry-run. The
// smoke never contains B/C data, and the holdout approval pins the smoke-tested
// code hash.
export const SEGMENT_DATA_MODULE = './unit0-segment-data.js';
export const IN_PROCESS_DIRECTORY = join(ROOT, 'node_modules', '.cache', 'unit0-r2-inprocess');
export const SEGMENT_CODE_FILE = 'unit0-runtime.js';
export async function buildWorkerBundle({ cases, preSend, dispatchesPerTurn = PREREGISTERED_LIMITS.dispatchesPerTurn }) {
  const { build } = await import('esbuild');
  assert.ok(Array.isArray(cases));
  const source = createPairedWorkerSource({ root: ROOT, cases: null, digest: null, expiresAt: null,
    providerDispatchesPerTurn: dispatchesPerTurn, preSend, dataModule: SEGMENT_DATA_MODULE });
  const output = await build({ stdin: { contents: source, resolveDir: ROOT, loader: 'ts' }, bundle: true, format: 'esm',
    platform: 'browser', conditions: ['workerd', 'worker', 'browser'], external: ['cloudflare:*', 'node:*', SEGMENT_DATA_MODULE],
    write: false, logLevel: 'silent', minify: false, legalComments: 'none' });
  const code = output.outputFiles[0].text;
  assert.equal(code.split(JSON.stringify(SEGMENT_DATA_MODULE)).length, 2, 'Runtime code must import its data module exactly once.');
  const casesJson = JSON.stringify(cases);
  return { templateSha256: sha256Text(code), casesSha256: sha256Text(casesJson), caseCount: cases.length, preSend, dispatchesPerTurn,
    code,
    segmentData: ({ digest, expiresAt }) => {
      assert.match(digest, /^[a-f0-9]{64}$/);
      assert.ok(Number.isSafeInteger(expiresAt));
      return `export const CASES = ${casesJson};\nexport const EXPECTED_DIGEST = ${JSON.stringify(digest)};\nexport const EXPIRES_AT = ${expiresAt};\n`;
    } };
}

// Writes one segment (identical code file + its data module) to a directory.
export async function writeSegmentFiles(bundle, directory, { digest, expiresAt }) {
  await writeFile(join(directory, SEGMENT_CODE_FILE), bundle.code);
  await writeFile(join(directory, SEGMENT_DATA_MODULE.slice(2)), bundle.segmentData({ digest, expiresAt }));
  const written = sha256(await readFile(join(directory, SEGMENT_CODE_FILE)));
  assert.equal(written, bundle.templateSha256, 'Segment code bytes differ from the run bundle.');
  return { entry: join(directory, SEGMENT_CODE_FILE), codeSha256: written };
}

// In-process loading of the same code (dry-run and tests): a fresh directory
// per segment so each data module is a distinct module instance.
export async function loadBundleInProcess(bundle, { digest, expiresAt }) {
  // Inside the ignored dependency cache, so module loaders that only serve
  // files under the project root (the test runner) load the same bytes.
  const parent = IN_PROCESS_DIRECTORY;
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'segment-'));
  const { entry, codeSha256 } = await writeSegmentFiles(bundle, directory, { digest, expiresAt });
  const module = await import(pathToFileURL(entry).href);
  return { module, codeSha256, directory };
}

// §19e execution path: only the reviewed legacy `unstable_dev` remote preview
// (local: false) under the exact credential-owner name. Temporary config is
// minimal (no production config import, routes, triggers, migrations or
// bindings); nothing is deployed, promoted or routed, and no Secret value is
// read. `wrangler preview` branch deployments and version URLs are not used.
export const EXECUTION_PATH = Object.freeze({ mode: 'legacy_unstable_dev_remote_preview', workerName: 'studyplanner-ai-proxy' });
export function validateExecutionPath(approval, worker) {
  assert.deepEqual(approval.executionPath, { ...EXECUTION_PATH }, 'Execution mode and exact Worker name must be the approved path.');
  assert.equal(worker, EXECUTION_PATH.workerName, 'Only the approved remote-preview Worker name is allowed.');
  assert.equal(approval.worker, worker);
}
export const segmentWranglerConfig = (workerName) => ({ name: workerName, main: SEGMENT_CODE_FILE, compatibility_date: '2026-04-10' });
export const unstableDevOptions = (config) => ({ config, local: false, ip: '127.0.0.1', port: 0, inspect: false, logLevel: 'none',
  experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false, showInteractiveDevSession: false, enableIpc: false } });

// Read-only production snapshot (deployments, current deployment status and
// versions) taken before and after a run to show deployment and traffic did
// not change. Only digests are kept. Zone routes have no read-only Wrangler
// command and are recorded as not observable here.
export const SNAPSHOT_COMMANDS = Object.freeze([['deployments', 'list'], ['deployments', 'status'], ['versions', 'list']]);
export function wranglerReadOnlyExec(args) {
  const binary = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const result = spawnSync(process.execPath, [binary, ...args], { cwd: tmpdir(), encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  if (result.status !== 0) throw new Error('Read-only production snapshot command failed: wrangler ' + args.slice(0, 2).join(' '));
  return result.stdout;
}
export async function productionSnapshot({ exec = wranglerReadOnlyExec, workerName = EXECUTION_PATH.workerName } = {}) {
  const entries = [];
  for (const command of SNAPSHOT_COMMANDS) {
    const output = await exec([...command, '--name', workerName, '--json']);
    assert.equal(typeof output, 'string');
    entries.push({ command: 'wrangler ' + command.join(' ') + ' --name ' + workerName + ' --json', sha256: sha256Text(output) });
  }
  return { takenAt: new Date().toISOString(), entries, digest: sha256Text(entries.map((entry) => entry.sha256).join('')),
    routes: 'not observable with read-only Wrangler commands' };
}
async function snapshotAfter(before, exec) {
  try {
    const after = await productionSnapshot({ exec });
    return { before, after, unchanged: after.digest === before.digest };
  } catch { return { before, after: null, unchanged: false }; }
}

// Real transport: each segment is a fresh remote preview session with its own
// random token and the unchanged 30-minute expiry baked into the bundle.
export function createWorkerTransport({ bundle, workerName, loadWrangler }) {
  return {
    async startSegment({ id, expiresAt }) {
      assert.equal(workerName, EXECUTION_PATH.workerName, 'Only the approved remote-preview Worker name is allowed.');
      const { unstable_dev } = await loadWrangler();
      const directory = await mkdtemp(join(tmpdir(), 'jev-unit0-r2-'));
      const token = randomBytes(32).toString('hex');
      let worker;
      try {
        const deployedAt = new Date().toISOString();
        const { entry, codeSha256 } = await writeSegmentFiles(bundle, directory, { digest: sha256(token), expiresAt });
        const config = join(directory, 'wrangler.json');
        await writeFile(config, JSON.stringify(segmentWranglerConfig(workerName)));
        worker = await unstable_dev(entry, unstableDevOptions(config));
        const headers = { Authorization: 'Bearer ' + token };
        const ready = await worker.fetch('/ready', { headers, signal: AbortSignal.timeout(45_000) });
        assert.equal(ready.status, 200);
        assert.deepEqual(await ready.json(), { openRouter: true, openAi: true, fetchGuard: true,
          providerAttemptsDuringReadiness: 0, cases: bundle.caseCount });
        // The segment must refuse any other token before it is used.
        const wrong = await worker.fetch('/ready', { headers: { Authorization: 'Bearer ' + randomBytes(32).toString('hex') },
          signal: AbortSignal.timeout(45_000) });
        assert.equal(wrong.status, 404, 'Segment accepted a foreign token.');
        // Upload provenance is recorded apart from consumption: case data now
        // exists only in this remote preview session; no provider was reached.
        return { id, expiresAt, bundleSha256: codeSha256,
          readiness: { fetchGuard: true, foreignTokenRefused: true, providerAttemptsDuringReadiness: 0 },
          upload: { deployedAt, location: 'Cloudflare legacy remote preview session of ' + workerName, casesSha256: bundle.casesSha256 },
          async runCase({ caseId, arm, timeoutMs, budgetRemainingUsd, runState }) {
            const response = await worker.fetch('/case', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({ caseId, arm, budgetRemainingUsd, runState }), signal: AbortSignal.timeout(timeoutMs) });
            if (response.status === 404) throw Object.assign(new Error('Segment token refused.'), { reason: 'token_refused_or_expired' });
            assert.equal(response.status, 200);
            return response.json();
          },
          async stop() { try { await worker.stop(); } finally { await rm(directory, { recursive: true, force: true }); } } };
      } catch (error) {
        try { await worker?.stop(); } finally { await rm(directory, { recursive: true, force: true }); }
        throw error;
      }
    },
  };
}

export const workerCases = (roster) => roster.cases.map(({ stratum: _stratum, ...item }) => item);
export const preSendFor = (pricing, maxProviderFailureRate = PREREGISTERED_LIMITS.maxProviderFailureRate) => ({ ...workerRates(pricing),
  maxReservePerCallUsd: reservePerCallUsd(pricing),
  stopRule: { minimumAttempts: FAILURE_RATE_MINIMUM_ATTEMPTS, earlyConsecutiveInfrastructureFailures: EARLY_CONSECUTIVE_INFRA_FAILURES,
    maxProviderFailureRate } });

async function readSet(path) {
  const bytes = await readFile(resolve(path));
  return { corpus: JSON.parse(bytes.toString('utf8')), sha256: sha256(bytes) };
}

// The holdout run. Order: validate everything and bundle → create the spend
// ledger → deploy the first segment and pass readiness (no case is run and no
// provider is reached; case text exists only in the remote preview session)
// → record the single consumption in the canonical ledger → first turn. From
// then on any failure leaves the holdout consumed; nothing is re-run.
export async function realRun({ approvalPath, worker, setB, setC, outputDir, transportFactory = null, clock = Date,
  persistence = DURABLE_PERSISTENCE, snapshotExec = wranglerReadOnlyExec }) {
  const roster = buildRoster({ B: await readSet(setB), C: await readSet(setC) });
  const runtimeSha256 = await runtimeFingerprint();
  const policySha256 = sha256(await readFile(join(ROOT, 'workers/ai-proxy/src/decision/contextualDecisionPolicy.ts')));
  const approval = validateApprovalR2(JSON.parse(await readFile(resolve(approvalPath), 'utf8')),
    { roster, runtimeSha256, policySha256, worker });
  if (approval.preregistration.path) {
    assert.equal(sha256(await readFile(approval.preregistration.path)), approval.preregistration.sha256, 'Preregistration changed after approval.');
  }
  const limits = validateLimits({ ...approval.limits }, { dryRun: false });
  const bundle = await buildWorkerBundle({ cases: workerCases(roster), preSend: preSendFor(approval.pricing),
    dispatchesPerTurn: limits.dispatchesPerTurn });
  // The Worker code must be the one exercised by the approved development smoke.
  assert.equal(bundle.templateSha256, approval.workerCodeSha256, 'Worker code differs from the smoke-tested bundle.');
  // Read-only production snapshot first; if it cannot be taken, nothing starts.
  const productionBefore = await productionSnapshot({ exec: snapshotExec });
  const runId = 'unit0-r2-' + new Date().toISOString().replace(/[:.]/g, '-');
  await mkdir(resolve(outputDir), { recursive: true });
  const spendLedgerPath = join(resolve(approval.spendLedgerDirectory), runId + '.spend.jsonl');
  const ledger = await ConsumptionLedger.create(spendLedgerPath, { runId, limits, pricing: approval.pricing,
    corpusSha256: roster.corpusSha256, runtimeSha256, policySha256, workerBundleSha256: bundle.templateSha256,
    pricingSource: approval.pricing.source });
  const order = executionOrder(roster.cases.map((item) => item.id));
  const transport = transportFactory ? transportFactory(bundle)
    : createWorkerTransport({ bundle, workerName: worker, loadWrangler: (await import('./jev-contextual-cloud-eval.mjs')).loadWrangler });
  const verifyFrozenInputs = async () => {
    assert.equal(await runtimeFingerprint(), runtimeSha256);
    assert.equal(sha256(await readFile(join(ROOT, 'workers/ai-proxy/src/decision/contextualDecisionPolicy.ts'))), policySha256);
    assert.equal(sha256(await readFile(resolve(setB))), roster.corpusSha256.B);
    assert.equal(sha256(await readFile(resolve(setC))), roster.corpusSha256.C);
    return { runtimeSha256, policySha256, corpusSha256: roster.corpusSha256, workerBundleSha256: bundle.templateSha256 };
  };
  const beforeFirstProviderTurn = () => recordConsumptionAttempt({ ledgerPath: approval.canonicalLedgerPath, roster,
    rubricSha256: approval.rubricSha256, runId, spendLedgerPath, persistence });
  const result = await runSerialEvaluation({ roster, order, transport, ledger, limits, clock, verifyFrozenInputs, beforeFirstProviderTurn });
  const productionIsolation = await snapshotAfter(productionBefore, snapshotExec);
  const artifact = { schemaVersion: R2_ARTIFACT_SCHEMA, dryRun: false, runId, executionPath: { ...EXECUTION_PATH }, productionIsolation,
    corpusSha256: roster.corpusSha256,
    rubricSha256: approval.rubricSha256, pricingVersion: PREREGISTERED_PRICING.version, runtimeSha256, policySha256,
    workerBundleSha256: bundle.templateSha256, attemptedAt: new Date().toISOString(),
    expectedTurns: roster.cases.length * 2, spendLedgerPath, ...result };
  await writeFile(join(resolve(outputDir), runId + '.results.json'), JSON.stringify(artifact, null, 2), { flag: 'wx' });
  return artifact;
}

// Development smoke (never evidence): the 12 development calibration cases,
// both arms, through the very same Worker code on the approved remote preview
// Worker, to check that the bundle runs, the fetch guard works, Luna reports
// its service tier, reservations settle and segment tokens rotate and refuse
// foreign tokens. It never touches the canonical holdout ledger and computes
// no gate. A real smoke needs the parent's approval (it makes paid calls).
export const SMOKE_SCHEMA = 'jev-unit0-smoke-r2';
export const SMOKE_ORDER_SEED = 'unit0-r2-smoke-2026-10-05';
export const DEVELOPMENT_CORPUS_SHA256 = '75e2cbbfc962b7c93647bf0c1197860bc94e1e70de9e62f99412ad722cfa22ba';
// Proposed hard caps, fixed before any smoke (restated by the approval): two
// calibration cases (one per question code) × two arms = 4 turns; 8 physical
// calls per turn → 32; USD 0.25 hard (Luna's maximal reservation × 8 =
// USD 0.1976 must fit before each turn); 1,200 s; a forced token rotation
// after each pair so two segments are exercised.
export const SMOKE_LIMITS = Object.freeze({ normalizerTurns: 4, totalBudgetUsd: 0.25, totalDispatches: 32,
  dispatchesPerTurn: 8, totalElapsedMs: 1_200_000, maxProviderFailureRate: 0.2 });
export const SMOKE_ROTATE_AFTER_PAIRS = 1;
// Machine-field selection only: the first calibration case (by ID code point)
// of each question code.
export function smokeCases(corpus) {
  const cases = validateCorpus(corpus, 'calibration').sort((left, right) => codePointCompare(left.id, right.id));
  const picked = ['quantity_role_unresolved', 'missing_effort_estimate'].map((code) => cases.find((item) => item.questionCode === code));
  assert.ok(picked.every(Boolean), 'Calibration lacks one of the question codes.');
  return picked;
}
export function validateSmokeApproval(approval, { runtimeSha256, policySha256, worker, corpusSha256 }) {
  assert.equal(approval.approved, true);
  assert.deepEqual([...approval.approvedBy].sort(), ['BronzeMaxwell', 'CopperHopper']);
  assert.equal(approval.authority, 'owner DECISION 2 delegation');
  assert.equal(approval.purpose, 'harness smoke; not evidence');
  assert.ok(Number.isFinite(Date.parse(approval.approvedAt)));
  assert.equal(approval.environment, 'isolated_synthetic_smoke');
  validateExecutionPath(approval, worker); // §19e replaces the former "*-eval" name rule
  assert.equal(approval.runtimeSha256, runtimeSha256, 'Runtime changed after the smoke approval.');
  assert.equal(approval.policySha256, policySha256, 'Catalog/gate changed after the smoke approval.');
  assert.equal(corpusSha256, DEVELOPMENT_CORPUS_SHA256, 'Smoke runs only on the frozen development corpus.');
  assert.equal(approval.corpusSha256, corpusSha256);
  assert.equal(approval.split, 'calibration');
  const { source: _source, ...contract } = approval.pricing ?? {};
  validatePricing(approval.pricing);
  assert.deepEqual(contract, structuredClone(PREREGISTERED_PRICING), 'Tariff contract differs from preregistration.');
  validateLimits({ ...approval.limits }, { dryRun: true });
  assert.deepEqual(approval.limits, { ...SMOKE_LIMITS }, 'Smoke caps differ from the proposal fixed before the smoke.');
  assert.ok(typeof approval.spendLedgerDirectory === 'string' && approval.spendLedgerDirectory);
  return approval;
}

export async function smokeRun({ approvalPath, worker, outputDir, transportFactory = null, clock = Date, snapshotExec = wranglerReadOnlyExec }) {
  const corpusBytes = await readFile(join(ROOT, 'scripts/jev-contextual-development-corpus.json'));
  const corpus = JSON.parse(corpusBytes.toString('utf8'));
  const corpusSha256 = sha256(corpusBytes);
  const runtimeSha256 = await runtimeFingerprint();
  const policySha256 = sha256(await readFile(join(ROOT, 'workers/ai-proxy/src/decision/contextualDecisionPolicy.ts')));
  const approval = validateSmokeApproval(JSON.parse(await readFile(resolve(approvalPath), 'utf8')),
    { runtimeSha256, policySha256, worker, corpusSha256 });
  const cases = smokeCases(corpus);
  assert.equal(cases.length * 2, SMOKE_LIMITS.normalizerTurns);
  const roster = { cases: cases.map((item) => ({ ...item, stratum: 'development_calibration' })) };
  const limits = validateLimits({ ...approval.limits }, { dryRun: true });
  const bundle = await buildWorkerBundle({ cases, preSend: preSendFor(approval.pricing), dispatchesPerTurn: limits.dispatchesPerTurn });
  const productionBefore = await productionSnapshot({ exec: snapshotExec });
  const runId = 'unit0-r2-smoke-' + new Date().toISOString().replace(/[:.]/g, '-');
  await mkdir(resolve(outputDir), { recursive: true });
  const ledger = await ConsumptionLedger.create(join(resolve(approval.spendLedgerDirectory), runId + '.spend.jsonl'),
    { runId, smoke: true, limits, pricing: approval.pricing, corpusSha256, runtimeSha256, policySha256,
      workerBundleSha256: bundle.templateSha256, pricingSource: approval.pricing.source });
  const transport = transportFactory ? transportFactory(bundle)
    : createWorkerTransport({ bundle, workerName: worker, loadWrangler: (await import('./jev-contextual-cloud-eval.mjs')).loadWrangler });
  const result = await runSerialEvaluation({ roster, order: executionOrder(cases.map((item) => item.id), SMOKE_ORDER_SEED),
    transport, ledger, limits, clock, rotateSegmentAfterPairs: SMOKE_ROTATE_AFTER_PAIRS,
    verifyFrozenInputs: async () => {
      assert.equal(await runtimeFingerprint(), runtimeSha256);
      return { runtimeSha256, workerBundleSha256: bundle.templateSha256 };
    } });
  const productionIsolation = await snapshotAfter(productionBefore, snapshotExec);
  const dispatches = result.pairs.flatMap((pair) => ARMS.flatMap((arm) => pair[arm]?.dispatches ?? []));
  const count = (values) => Object.fromEntries([...new Set(values)].map((value) => [String(value), values.filter((item) => item === value).length]));
  const segmentLines = ledger.entries.filter((entry) => entry.type === 'segment_started');
  const artifact = { schemaVersion: SMOKE_SCHEMA, status: 'smoke_not_evidence', evidence: 'none', runId, corpusSha256,
    runtimeSha256, policySha256, pricingVersion: PREREGISTERED_PRICING.version, workerCodeSha256: bundle.templateSha256,
    casesSha256: bundle.casesSha256, runStatus: result.status, stopReason: result.stopReason,
    executionPath: { ...EXECUTION_PATH },
    checks: {
      productionIsolation,
      sameWorkerCode: 'workerCodeSha256 excludes case data, token and expiry; the holdout approval must pin this value',
      segments: segmentLines.length,
      segmentCodeSha256: segmentLines.map((entry) => entry.bundleSha256),
      fetchGuardAndForeignTokenRefusal: segmentLines.map((entry) => entry.readiness),
      lunaRequestedServiceTier: 'default (enforced at the Worker pre-send boundary)',
      refusedSends: result.pairs.reduce((sum, pair) => sum + ARMS.reduce((total, arm) => total + (pair[arm]?.preSend.refusedSends ?? 0), 0), 0),
      lunaServedServiceTier: count(dispatches.filter((item) => item.provider === 'luna').map((item) => item.serviceTier)),
      lunaServedModel: count(dispatches.filter((item) => item.provider === 'luna').map((item) => item.servedModel)),
      jevServedModel: count(dispatches.filter((item) => item.provider === 'jev').map((item) => item.servedModel)),
      unaccountedFetchesRefused: result.pairs.reduce((sum, pair) => sum + ARMS.reduce((total, arm) =>
        total + (pair[arm]?.preSend.unaccountedFetchesRefused ?? 0), 0), 0),
      budget: result.ledgerTotals,
    },
    note: 'Harness smoke on development calibration; no label, no gate, no canonical holdout ledger. Not evidence.',
    pairs: result.pairs };
  await writeFile(join(resolve(outputDir), runId + '.smoke.json'), JSON.stringify(artifact, null, 2), { flag: 'wx' });
  return artifact;
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  if (args.includes('--run-approved')) {
    const artifact = await realRun({ approvalPath: option('--approval'), worker: option('--worker'),
      setB: option('--set-b'), setC: option('--set-c'), outputDir: option('--output-dir') });
    console.info(JSON.stringify({ status: artifact.status, stopReason: artifact.stopReason, ledgerTotals: artifact.ledgerTotals }, null, 2));
    return;
  }
  if (args.includes('--smoke-approved')) {
    const artifact = await smokeRun({ approvalPath: option('--approval'), worker: option('--worker'), outputDir: option('--output-dir') });
    console.info(JSON.stringify({ status: artifact.status, runStatus: artifact.runStatus, stopReason: artifact.stopReason,
      workerCodeSha256: artifact.workerCodeSha256, checks: artifact.checks }, null, 2));
    return;
  }
  if (args.includes('--dry-run')) {
    const { runDryRun } = await import('./jev-contextual-unit0-dry-run.mjs');
    console.info(JSON.stringify(await runDryRun({ scenario: option('--scenario') ?? 'nominal',
      outputDir: resolve(option('--output-dir')) }), null, 2));
    return;
  }
  const dryRun = args.includes('--mock-input');
  const roster = buildRoster({ B: await readSet(option('--set-b')), C: await readSet(option('--set-c')) }, { dryRun });
  if (args.includes('--blind-packet')) {
    const artifact = JSON.parse(await readFile(resolve(option('--results')), 'utf8'));
    const pairs = validateR2Artifact(artifact, roster);
    const bindings = { corpusSha256: roster.corpusSha256, runtimeSha256: artifact.runtimeSha256,
      policySha256: artifact.policySha256, resultsSha256: sha256(await readFile(resolve(option('--results')))) };
    const { packet, key } = createBlindPacket({ roster, pairs: [...pairs.values()], bindings });
    const directory = resolve(option('--output-dir'));
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'blind-packet.json'), canonicalJson(packet), { flag: 'wx' });
    await writeFile(join(directory, 'blind-key.json'), canonicalJson(key), { flag: 'wx' });
    console.info(JSON.stringify({ packet: basename(join(directory, 'blind-packet.json')), cases: packet.cases.length,
      packetSha256: sha256Text(canonicalJson(packet)), keySha256: packet.keySha256 }, null, 2));
    return;
  }
  if (args.includes('--decide')) {
    const read = async (name) => JSON.parse(await readFile(resolve(option(name)), 'utf8'));
    const artifactBytes = await readFile(resolve(option('--results')));
    const spendLedger = option('--spend-ledger') ?? JSON.parse(artifactBytes.toString('utf8')).spendLedgerPath;
    console.info(JSON.stringify(decideFromArtifacts({ roster, artifactBytes,
      spendLedgerBytes: await readFile(resolve(spendLedger)).catch(() => null),
      packet: await read('--packet'), key: await read('--key'), review: await read('--review'),
      approval: args.includes('--approval') ? await read('--approval') : null }), null, 2));
    return;
  }
  console.info(JSON.stringify({ status: 'HOLD', action: 'offline_roster_validation_only', providerCalls: 0,
    corpusSha256: roster.corpusSha256, cases: roster.cases.length,
    groups: Object.fromEntries(roster.strata.map((stratum) => [stratum.id, stratum.groups.length])),
    executionOrderSha256: sha256Text(canonicalJson(executionOrder(roster.cases.map((item) => item.id)))),
    runtimeSha256: await runtimeFingerprint(), limits: PREREGISTERED_LIMITS, decisionRules: DECISION_RULES,
    armTokenReserveMs: ARM_TOKEN_RESERVE_MS }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error('Unit 0 r2 evaluation refused or incomplete: ' + (error?.message ?? 'unknown failure'));
  process.exitCode = 1;
});
