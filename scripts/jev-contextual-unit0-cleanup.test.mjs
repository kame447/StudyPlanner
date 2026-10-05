import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ConsumptionLedger, PREREGISTERED_LIMITS, PREREGISTERED_PRICING, reservePerCallUsd } from './jev-contextual-unit0-budget.mjs';
import { DECISION_RULES } from './jev-contextual-unit0-decision.mjs';
import { buildMockSets, DRY_RUN_PRICING } from './jev-contextual-unit0-dry-run.mjs';
import { DEVELOPMENT_CORPUS_SHA256, EXECUTION_PATH, SMOKE_LIMITS, buildRoster, buildWorkerBundle, createWorkerTransport,
  preSendFor, realRun, runSerialEvaluation, runTerminalValidity, smokeRun, validateR2Artifact } from './jev-contextual-unit0-eval.mjs';
import { runtimeFingerprint, sha256 } from './jev-contextual-paired-eval.mjs';
import { executionOrder } from './jev-contextual-unit0-random.mjs';

const sensitive = 'PRIVATE_CLEANUP_ERROR_ユーザー本文';
const item = { id: 'synthetic-cleanup-1', group: 'synthetic-group', stratum: 'B', questionCode: 'quantity_role_unresolved', labelSource: 'synthetic_unreviewed' };
// Zero observed sends is intentional: these synthetic transport lifecycle
// tests exercise no provider, renderer, scheduler or semantic correctness.
const recordFor = (item, arm) => ({ caseId: item.id, group: item.group, arm, questionCode: item.questionCode,
  catalogVersion: 'focused-contextual-answer-2026-10-04-v3', gateVersion: 'contextual-conservative-v2-calibrated',
  observationComplete: true, dispatches: [], lunaDispatches: 0, elapsedMs: 0, inputTokens: 0, outputTokens: 0, actualCostUsd: 0,
  directRoleAccepted: false, selectedRole: null, jointCorrect: null, labelSource: item.labelSource, providerStatus: null,
  semanticResult: { status: 'provider_failure', document: null, contextualDirective: null, validationErrors: [] },
  preSend: { reserveUsdPerCall: reservePerCallUsd(DRY_RUN_PRICING), budgetRemainingUsd: 5, reservedUsd: 0, reservations: [],
    refusedSends: 0, maxInputTokenBound: null, maxRequestedOutputTokens: null, unaccountedFetchesRefused: 0,
    stopLatched: null, runStateAfter: { attempts: 0, infrastructureFailures: 0, consecutiveInfrastructureFailures: 0 } } });
const ledgerFor = () => new ConsumptionLedger(null, { limits: PREREGISTERED_LIMITS, pricing: DRY_RUN_PRICING });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('serial cleanup failures retain the terminal ledger and first error', () => {
  it('preserves the existing unfiltered startup ledger message with a 200-character cap only there', async () => {
    const message = ('case-like user text: 日本語\n{"text":"PRIVATE_STARTUP_ECHO"} ').repeat(20);
    const ledger = ledgerFor();
    const startSegment = vi.fn(async () => { throw new Error(message); });
    const result = await runSerialEvaluation({ roster: { cases: [item] }, order: executionOrder([item.id]), ledger,
      limits: PREREGISTERED_LIMITS, transport: { startSegment } });
    const startup = ledger.entries.find(entry => entry.type === 'segment_start_failed');
    expect(startup.error).toBe(message.slice(0, 200));
    expect(startup.error).toHaveLength(200);
    expect(startup.error).toContain('PRIVATE_STARTUP_ECHO'); // truncation is not a privacy filter
    expect(result).toMatchObject({ status: 'incomplete_HOLD', stopReason: 'segment_start_failed', cleanupFailure: null });
    expect(ledger.entries.at(-1)).toMatchObject({ type: 'run_aborted', stopReason: 'segment_start_failed' });
    expect(startSegment).toHaveBeenCalledTimes(1);
    expect(JSON.stringify({ result, entries: ledger.entries.filter(entry => entry !== startup) })).not.toContain('PRIVATE_STARTUP_ECHO');
  });
  it('records a final stop failure instead of claiming a successful segment stop', async () => {
    const ledger = ledgerFor(); const stop = vi.fn(async () => { throw new Error(sensitive); });
    const runCase = vi.fn(async ({ arm }) => recordFor(item, arm));
    const result = await runSerialEvaluation({ roster: { cases: [item] }, order: executionOrder([item.id]), ledger,
      limits: PREREGISTERED_LIMITS, transport: { startSegment: async ({ id, expiresAt }) => ({ id, expiresAt, runCase, stop }) } });
    expect(result).toMatchObject({ status: 'incomplete_HOLD', stopReason: 'segment_stop_failed',
      cleanupFailure: { phase: 'run_finalization', segmentId: 0, workerStop: 'failed', temporaryFiles: 'unknown' } });
    expect(runCase).toHaveBeenCalledTimes(2); expect(stop).toHaveBeenCalledTimes(1);
    expect(ledger.entries.at(-1)).toMatchObject({ type: 'run_aborted', stopReason: 'segment_stop_failed', cleanupFailure: result.cleanupFailure });
    expect(ledger.entries.some(entry => entry.type === 'segment_stopped')).toBe(false);
    expect(ledger.entries.filter(entry => entry.type === 'segment_stop_failed')).toHaveLength(1);
    expect(JSON.stringify({ result, entries: ledger.entries })).not.toContain(sensitive);
  });
  it('stops rotation before starting the next segment or admitting another turn', async () => {
    const second = { ...item, id: 'synthetic-cleanup-2' };
    const items = [item, second]; const index = new Map(items.map(item => [item.id, item]));
    const ledger = ledgerFor();
    const runCase = vi.fn(async ({ caseId, arm }) => recordFor(index.get(caseId), arm));
    const stop = vi.fn(async () => { throw new Error(sensitive); });
    const startSegment = vi.fn(async ({ id, expiresAt }) => ({ id, expiresAt, runCase, stop }));
    const result = await runSerialEvaluation({ roster: { cases: items }, order: executionOrder(items.map(item => item.id)), ledger,
      limits: PREREGISTERED_LIMITS, rotateSegmentAfterPairs: 1, transport: { startSegment } });
    expect(result).toMatchObject({ status: 'incomplete_HOLD', stopReason: 'segment_stop_failed',
      cleanupFailure: { phase: 'segment_rotation', segmentId: 0, workerStop: 'failed', temporaryFiles: 'unknown' } });
    expect(startSegment).toHaveBeenCalledTimes(1); expect(runCase).toHaveBeenCalledTimes(2); expect(stop).toHaveBeenCalledTimes(1);
    expect(ledger.entries.filter(entry => entry.type === 'turn_admitted')).toHaveLength(2);
    expect(ledger.entries.at(-1)).toMatchObject({ type: 'run_aborted', cleanupFailure: result.cleanupFailure });
  });
  it('keeps an unsettled-turn failure and reservation before a subsequent stop failure', async () => {
    const ledger = ledgerFor();
    const result = await runSerialEvaluation({ roster: { cases: [item] }, order: executionOrder([item.id]), ledger,
      limits: PREREGISTERED_LIMITS, transport: { startSegment: async ({ id, expiresAt }) => ({ id, expiresAt,
        runCase: async () => { throw new Error(sensitive); }, stop: async () => { throw new Error(sensitive); } }) } });
    expect(result).toMatchObject({ stopReason: 'unsettled_turn', cleanupFailure: { phase: 'run_finalization' },
      ledgerTotals: { unsettledTurns: 1, allCallsSettled: false } });
    expect(result.ledgerTotals.budgetHoldDispatches).toBe(8);
    expect(result.ledgerTotals.openReservationUsd).toBe(reservePerCallUsd(DRY_RUN_PRICING) * 8);
    expect(ledger.entries.find(entry => entry.type === 'turn_unsettled')).toMatchObject({ totalDispatches: null, usage: null });
    expect(ledger.entries.at(-1)).toMatchObject({ type: 'run_aborted', stopReason: 'unsettled_turn' });
    expect(JSON.stringify(ledger.entries)).not.toContain(sensitive);
  });
});

// Shape of the existing read-only snapshot commands; synthetic identity only.
const deployment = { id: 'dep-synthetic', created_on: '2026-10-01T00:00:00.000Z', source: 'synthetic',
  strategy: 'percentage', versions: [{ version_id: 'version-synthetic', percentage: 100 }] };
const snapshotOutput = args => JSON.stringify({ 'deployments list': [deployment], 'deployments status': deployment,
  'versions list': [{ id: 'version-synthetic', number: 1, metadata: { created_on: deployment.created_on, source: 'synthetic' } }],
}[args.slice(0, 2).join(' ')]);

describe('mock preview failures still write snapshots, ledgers and artifacts', () => {
  let directory, files, base, roster, fixtureSequence = 0;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'unit0-cleanup-fixtures-'));
    const sets = await buildMockSets(); files = {};
    for (const stratum of ['B', 'C']) {
      sets[stratum].corpus.status = 'sealed_unconsumed';
      files[stratum] = join(directory, 'synthetic-' + stratum + '.json');
      await writeFile(files[stratum], JSON.stringify(sets[stratum].corpus));
      sets[stratum].sha256 = sha256(await readFile(files[stratum]));
    }
    roster = buildRoster(sets);
    const bundle = await buildWorkerBundle({ cases: [], preSend: preSendFor(DRY_RUN_PRICING) });
    base = { runtimeSha256: await runtimeFingerprint(), policySha256: sha256(await readFile(resolve('workers/ai-proxy/src/decision/contextualDecisionPolicy.ts'))),
      corpusSha256: roster.corpusSha256, workerCodeSha256: bundle.templateSha256, pricing: structuredClone(DRY_RUN_PRICING) };
  });
  afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
  async function prepare() {
    const dir = join(directory, 'run-' + fixtureSequence++); await mkdir(dir);
    const ledgerPath = join(dir, 'canonical.json');
    await writeFile(ledgerPath, JSON.stringify({ holdouts: ['B', 'C'].map(stratum => ({ id: 'holdout-' + stratum,
      status: 'sealed_unconsumed', consumptionAttempts: [],
      sha256: { [stratum === 'B' ? 'holdout.json' : 'set.json']: base.corpusSha256[stratum], 'rubric.json': 'f'.repeat(64) } })) }));
    const approvalPath = join(dir, 'approval.json');
    await writeFile(approvalPath, JSON.stringify({ ...base, approved: true, approvedBy: ['BronzeMaxwell', 'CopperHopper'],
      authority: 'owner DECISION 2 delegation', approvedAt: '2026-10-05T00:00:00Z', environment: 'isolated_synthetic_evaluation',
      worker: EXECUTION_PATH.workerName, executionPath: { ...EXECUTION_PATH }, catalogVersion: 'focused-contextual-answer-2026-10-04-v3',
      gateVersion: 'contextual-conservative-v2-calibrated', rubricSha256: { B: 'f'.repeat(64), C: 'f'.repeat(64) },
      limits: { ...PREREGISTERED_LIMITS }, decisionRules: { ...DECISION_RULES },
      canonicalLedgerPath: ledgerPath, spendLedgerDirectory: dir, preregistration: { sha256: 'e'.repeat(64) } }));
    return { dir, ledgerPath, approvalPath };
  }
  function mockPreview({ bundle, readinessFailure = false, stopFailure = false, runCaseFailure = false }) {
    const primary = Object.freeze(new Error(sensitive));
    const temporaryDirectories = [];
    const caseIndex = new Map(roster.cases.map(item => [item.id, item]));
    let readyCalls = 0;
    const stop = vi.fn(async () => { if (stopFailure) throw new Error(sensitive); });
    const worker = { stop, fetch: vi.fn(async (path, init) => {
      if (path === '/ready') {
        if (readinessFailure) throw primary;
        readyCalls += 1;
        return readyCalls % 2 === 1 ? Response.json({ openRouter: true, openAi: true, fetchGuard: true,
          providerAttemptsDuringReadiness: 0, cases: bundle.caseCount }) : new Response(null, { status: 404 });
      }
      if (runCaseFailure) throw new Error(sensitive);
      const { caseId, arm } = JSON.parse(init.body);
      return Response.json(recordFor(caseIndex.get(caseId), arm));
    }) };
    const unstable_dev = vi.fn(async entry => { temporaryDirectories.push(dirname(entry)); return worker; });
    return { primary, stop, worker, temporaryDirectories, unstable_dev,
      transport: createWorkerTransport({ bundle, workerName: EXECUTION_PATH.workerName, loadWrangler: async () => ({ unstable_dev }) }) };
  }
  async function assertWritten(artifact, dir, snapshot, cleanupPhase) {
    const saved = JSON.parse(await readFile(join(dir, artifact.runId + '.results.json'), 'utf8'));
    expect(saved).toEqual(artifact);
    const spend = (await readFile(artifact.spendLedgerPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(spend.at(-1)).toMatchObject({ type: 'run_aborted', stopReason: artifact.stopReason, cleanupFailure: artifact.cleanupFailure });
    expect(snapshot.mock.calls.length).toBeGreaterThan(3); // after snapshot really attempted
    expect(artifact.status).toBe('incomplete_HOLD');
    if (cleanupPhase) expect(artifact.cleanupFailure).toMatchObject({ phase: cleanupPhase, workerStop: 'failed', temporaryFiles: 'removed' });
    expect(JSON.stringify(saved)).not.toContain(sensitive);
    // Parent review retains the pre-existing bounded startup ledger message.
    // Raw stop/cleanup exceptions and all artifact fields must still exclude it.
    for (const entry of spend.filter(entry => entry.type === 'segment_start_failed')) {
      expect(entry.error).toBe(sensitive.slice(0, 200));
      expect(JSON.stringify(entry.cleanupFailure)).not.toContain(sensitive);
    }
    expect(JSON.stringify(spend.filter(entry => entry.type !== 'segment_start_failed'))).not.toContain(sensitive);
    expect(() => validateR2Artifact(artifact, roster)).not.toThrow();
    expect(runTerminalValidity({ artifact, spendLedgerBytes: Buffer.from(spend.map(line => JSON.stringify(line)).join('\n')), roster }).status).toBe('FAIL');
    return spend;
  }
  it.each([false, true])('cleans readiness failure after start and retains it when stop also fails (%s)', async (stopFailure) => {
    const fixture = await prepare(); let preview;
    const before = await readFile(fixture.ledgerPath);
    const snapshot = vi.fn(async args => snapshotOutput(args));
    const artifact = await realRun({ approvalPath: fixture.approvalPath, worker: EXECUTION_PATH.workerName,
      setB: files.B, setC: files.C, outputDir: fixture.dir, snapshotExec: snapshot,
      transportFactory: bundle => { preview = mockPreview({ bundle, readinessFailure: true, stopFailure }); return preview.transport; } });
    expect(artifact).toMatchObject({ stopReason: 'segment_start_failed', holdoutConsumed: false, ledgerTotals: { observedDispatches: 0 } });
    expect(preview.unstable_dev).toHaveBeenCalledTimes(1); expect(preview.stop).toHaveBeenCalledTimes(1);
    expect(preview.worker.fetch).toHaveBeenCalledTimes(1); // readiness only, no case
    for (const path of preview.temporaryDirectories) await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readFile(fixture.ledgerPath)).equals(before)).toBe(true);
    await assertWritten(artifact, fixture.dir, snapshot, stopFailure ? 'segment_start' : null);
    if (!stopFailure) expect(artifact.cleanupFailure).toBeNull();
  });
  it('preserves the original frozen readiness exception even when cleanup stop fails', async () => {
    const bundle = await buildWorkerBundle({ cases: [], preSend: preSendFor(DRY_RUN_PRICING) });
    const preview = mockPreview({ bundle, readinessFailure: true, stopFailure: true });
    await expect(preview.transport.startSegment({ id: 0, expiresAt: Date.now() + 1_800_000 })).rejects.toBe(preview.primary);
    expect(preview.stop).toHaveBeenCalledTimes(1);
    for (const path of preview.temporaryDirectories) await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  // The fixed 130-case roster requires 260 durable settlements and frozen
  // input checks; allow full-suite disk contention without changing run caps.
  it.each([false, true])('writes the artifact after a final stop failure and attempts an unavailable after snapshot (%s)', async (unavailableAfter) => {
    const fixture = await prepare(); let preview, snapshotCalls = 0;
    const snapshot = vi.fn(async args => { snapshotCalls += 1; if (unavailableAfter && snapshotCalls > 3) throw new Error(sensitive); return snapshotOutput(args); });
    const artifact = await realRun({ approvalPath: fixture.approvalPath, worker: EXECUTION_PATH.workerName,
      setB: files.B, setC: files.C, outputDir: fixture.dir, snapshotExec: snapshot,
      transportFactory: bundle => { preview = mockPreview({ bundle, stopFailure: true }); return preview.transport; } });
    expect(artifact).toMatchObject({ stopReason: 'segment_stop_failed', holdoutConsumed: true, cleanupFailure: { phase: 'run_finalization' } });
    expect(artifact.pairs.every(pair => pair.jevFirst && pair.lunaOnly)).toBe(true);
    expect(artifact.ledgerTotals.settledTurns).toBe(260);
    expect(preview.stop).toHaveBeenCalledTimes(1);
    for (const path of preview.temporaryDirectories) await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
    if (unavailableAfter) expect(artifact.productionIsolation).toMatchObject({ unchanged: false, after: null });
    const spend = await assertWritten(artifact, fixture.dir, snapshot, 'run_finalization');
    expect(spend.filter(entry => entry.type === 'segment_stop_failed')).toHaveLength(1);
    // Cleanup notes admit only fixed enums/framing; imports cannot smuggle text.
    for (const changed of [{ ...artifact.cleanupFailure, message: sensitive }, { ...artifact.cleanupFailure, phase: sensitive },
      { ...artifact.cleanupFailure, workerStop: sensitive }, { ...artifact.cleanupFailure, segmentId: -1 }]) {
      expect(() => validateR2Artifact({ ...artifact, cleanupFailure: changed }, roster)).toThrow();
    }
  }, 60_000);
  it('retains an unsettled-turn reason over final cleanup failure in the written artifact', async () => {
    const fixture = await prepare(); let preview;
    const snapshot = vi.fn(async args => snapshotOutput(args));
    const artifact = await realRun({ approvalPath: fixture.approvalPath, worker: EXECUTION_PATH.workerName,
      setB: files.B, setC: files.C, outputDir: fixture.dir, snapshotExec: snapshot,
      transportFactory: bundle => { preview = mockPreview({ bundle, stopFailure: true, runCaseFailure: true }); return preview.transport; } });
    expect(artifact).toMatchObject({ stopReason: 'unsettled_turn', cleanupFailure: { phase: 'run_finalization' } });
    await assertWritten(artifact, fixture.dir, snapshot, 'run_finalization');
    expect(preview.worker.fetch).toHaveBeenCalledTimes(3); // two readiness checks, one unsettled case
  });
  it('writes smoke partial evidence after a rotation stop failure without starting the next preview', async () => {
    const fixture = await prepare(); let preview;
    const approvalPath = join(fixture.dir, 'smoke-approval.json');
    const corpus = JSON.parse(await readFile(resolve('scripts/jev-contextual-development-corpus.json'), 'utf8'));
    const caseIndex = new Map(corpus.cases.map(item => [item.id, item]));
    await writeFile(approvalPath, JSON.stringify({ ...base, approved: true, approvedBy: ['BronzeMaxwell', 'CopperHopper'],
      authority: 'owner DECISION 2 delegation', purpose: 'harness smoke; not evidence', approvedAt: '2026-10-05T00:00:00Z',
      environment: 'isolated_synthetic_smoke', worker: EXECUTION_PATH.workerName, executionPath: { ...EXECUTION_PATH },
      corpusSha256: DEVELOPMENT_CORPUS_SHA256, split: 'calibration', limits: { ...SMOKE_LIMITS }, spendLedgerDirectory: fixture.dir }));
    const snapshot = vi.fn(async args => snapshotOutput(args));
    const artifact = await smokeRun({ approvalPath, worker: EXECUTION_PATH.workerName, outputDir: fixture.dir, snapshotExec: snapshot,
      transportFactory: bundle => {
        preview = mockPreview({ bundle, stopFailure: true });
        const initial = preview.worker.fetch.getMockImplementation();
        preview.worker.fetch.mockImplementation(async (path, init) => {
          if (path === '/ready') return initial(path, init);
          const { caseId, arm } = JSON.parse(init.body); return Response.json(recordFor(caseIndex.get(caseId), arm));
        });
        return preview.transport;
      } });
    expect(artifact).toMatchObject({ status: 'smoke_not_evidence', runStatus: 'incomplete_HOLD', stopReason: 'segment_stop_failed',
      cleanupFailure: { phase: 'segment_rotation', workerStop: 'failed', temporaryFiles: 'removed' } });
    expect(preview.unstable_dev).toHaveBeenCalledTimes(1); expect(preview.stop).toHaveBeenCalledTimes(1);
    expect(preview.worker.fetch).toHaveBeenCalledTimes(4); // two readiness + one pair
    expect(snapshot).toHaveBeenCalledTimes(6);
    const saved = JSON.parse(await readFile(join(fixture.dir, artifact.runId + '.smoke.json'), 'utf8'));
    expect(saved).toEqual(artifact);
    const spendPath = join(fixture.dir, artifact.runId + '.spend.jsonl');
    const spend = (await readFile(spendPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(spend.at(-1)).toMatchObject({ type: 'run_aborted', stopReason: 'segment_stop_failed', cleanupFailure: artifact.cleanupFailure });
    expect(JSON.stringify({ saved, spend })).not.toContain(sensitive);
    for (const path of preview.temporaryDirectories) await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
