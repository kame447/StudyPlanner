import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWrangler } from './jev-contextual-cloud-eval.mjs';
import { createPairedWorkerSource } from './jev-contextual-paired-runtime.mjs';
import { summarizePairs } from './jev-contextual-eval-metrics.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REQUIRED_OWNER_THRESHOLDS = [
  'minimumEligibleFrequency', 'minimumDispatchReductionPerTurn',
  'maximumJointFalseAcceptance', 'jointNonInferiorityMargin',
  'maximumLatencyP50RegressionMs', 'maximumLatencyP95RegressionMs',
  'maximumCostRegressionUsdPerTurn', 'minimumIndependentGroups',
];
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function validateCorpus(corpus, split) {
  assert.ok(['tuning', 'calibration', 'holdout'].includes(split));
  assert.equal(corpus.population, 'synthetic_weekly_planning');
  assert.equal(corpus.provenance.gold, false);
  const ids = new Set();
  const groups = new Map();
  for (const item of corpus.cases) {
    assert.ok(typeof item.id === 'string' && item.id && !ids.has(item.id));
    assert.ok(typeof item.group === 'string' && item.group);
    assert.ok(['tuning', 'calibration', 'holdout'].includes(item.split));
    assert.ok(!groups.has(item.group) || groups.get(item.group) === item.split, 'Group crosses splits.');
    assert.ok(['quantity_role_unresolved', 'missing_effort_estimate'].includes(item.questionCode));
    assert.ok(typeof item.userText === 'string' && item.userText.trim()
      && Buffer.byteLength(item.userText) <= 8000);
    assert.ok(typeof item.taskTitle === 'string' && item.taskTitle.trim());
    assert.ok(typeof item.targetAmount === 'number' && Number.isFinite(item.targetAmount) && item.targetAmount > 0);
    assert.ok(['minute', 'hour', 'page', 'problem', 'word', 'lesson', 'chapter', 'section',
      'exam_year', 'mock_exam', 'session', 'custom'].includes(item.unitCode));
    assert.ok(typeof item.unitLabel === 'string' && item.unitLabel.trim());
    assert.ok(['synthetic_unreviewed', 'opus-5.5-limited-judge', 'human_review'].includes(item.labelSource));
    ids.add(item.id); groups.set(item.group, item.split);
  }
  if (split === 'holdout') {
    assert.equal(corpus.status, 'sealed_unconsumed');
    assert.equal(corpus.provenance.tuningExposure, false);
    assert.equal(corpus.provenance.derivedFromConsumedHoldout, false);
    assert.notEqual(corpus.provenance.generator.agent, 'PolarWatt');
    assert.ok(corpus.cases.every((item) => item.split === 'holdout'), 'Holdout must be a separate artifact.');
  }
  const selected = corpus.cases.filter((item) => item.split === split);
  assert.ok(selected.length > 0);
  return selected;
}

export function validateApproval(approval, { corpusHash, split, worker }) {
  assert.equal(approval.approved, true);
  assert.ok(typeof approval.owner === 'string' && approval.owner.trim());
  assert.ok(typeof approval.approvedAt === 'string' && Number.isFinite(Date.parse(approval.approvedAt)));
  assert.equal(approval.environment, 'isolated_synthetic_evaluation');
  assert.equal(approval.corpusSha256, corpusHash);
  assert.equal(approval.split, split);
  assert.equal(approval.worker, worker);
  assert.match(worker, /^[a-zA-Z0-9-]+-eval$/);
  for (const key of REQUIRED_OWNER_THRESHOLDS) {
    assert.ok(typeof approval.thresholds?.[key] === 'number'
      && Number.isFinite(approval.thresholds[key]) && approval.thresholds[key] >= 0,
    'Owner must preregister threshold: ' + key);
  }
  assert.equal(approval.catalogVersion, 'focused-contextual-answer-2026-10-04-v3');
  assert.equal(approval.gateVersion, 'contextual-conservative-v2-calibrated');
  assert.match(approval.runtimeSha256, /^[a-f0-9]{64}$/);
  assert.match(approval.policySha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(approval.executionLimits?.providerDispatchesPerTurn)
    && approval.executionLimits.providerDispatchesPerTurn > 0);
  assert.ok(Number.isSafeInteger(approval.executionLimits?.totalElapsedMs)
    && approval.executionLimits.totalElapsedMs > 0);
  assert.ok(typeof approval.inferenceProcedure === 'string' && approval.inferenceProcedure.trim());
}

export function applyJointLabels(pairs, labels) {
  if (!labels) return pairs;
  const seen = new Set();
  const index = new Map(pairs.flatMap((pair) => ['jevFirst', 'lunaOnly']
    .filter((arm) => pair[arm]).map((arm) => [pair.caseId + ':' + arm, pair[arm]])));
  for (const label of labels) {
    const key = label.caseId + ':' + label.arm;
    assert.ok(index.has(key) && !seen.has(key), 'Unknown or duplicate joint label.');
    assert.equal(typeof label.correct, 'boolean');
    assert.ok(['synthetic_unreviewed', 'opus-5.5-limited-judge', 'human_review'].includes(label.source));
    assert.equal(typeof label.independent, 'boolean');
    assert.ok(typeof label.reviewer === 'string' && label.reviewer.trim());
    assert.ok(typeof label.rationale === 'string' && label.rationale.trim(), 'Whole-turn tuple/scope review needs a rationale.');
    Object.assign(index.get(key), { jointCorrect: label.correct,
      jointLabel: { source: label.source, independent: label.independent, reviewer: label.reviewer, rationale: label.rationale } });
    seen.add(key);
  }
  return pairs;
}

export async function runtimeFingerprint() {
  // Semantic runner, validators, adapters, catalog, provider and dispatch inputs.
  // This covers the full local source tree, not just the harness entry template.
  const { readdir } = await import('node:fs/promises');
  const files = [];
  const walk = async (path) => {
    for (const entry of await readdir(join(ROOT, path), { withFileTypes: true })) {
      const relative = path + '/' + entry.name;
      if (entry.isDirectory()) await walk(relative);
      else if (entry.isFile() && !relative.includes('.test.') && /\.(ts|tsx|mjs)$/.test(relative)) files.push(relative);
    }
  };
  for (const path of ['shared', 'src', 'workers/ai-proxy/src']) await walk(path);
  files.push('scripts/jev-contextual-paired-runtime.mjs', 'scripts/jev-contextual-paired-eval.mjs', 'scripts/jev-contextual-eval-metrics.mjs',
    'scripts/jev-contextual-cloud-eval.mjs', 'scripts/jev-contextual-corpus.mjs', 'package.json', 'package-lock.json');
  const hash = createHash('sha256');
  for (const file of files.sort()) { hash.update(file + '\0'); hash.update(await readFile(join(ROOT, file))); }
  return hash.digest('hex');
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const corpusPath = resolve(option('--corpus', join(ROOT, 'scripts/jev-contextual-development-corpus.json')));
  const split = option('--split', 'tuning');
  const bytes = await readFile(corpusPath);
  const corpus = JSON.parse(bytes.toString());
  const cases = validateCorpus(corpus, split);
  const corpusHash = sha256(bytes);
  const fingerprint = await runtimeFingerprint();
  const policyHash = sha256(await readFile(join(ROOT, 'workers/ai-proxy/src/decision/contextualDecisionPolicy.ts')));
  if (args.includes('--summarize')) {
    assert.ok(args.includes('--results'));
    const artifact = JSON.parse(await readFile(resolve(option('--results')), 'utf8'));
    assert.equal(artifact.corpusHash, corpusHash);
    assert.equal(artifact.split, split);
    const ids = new Set();
    for (const pair of artifact.pairs) {
      const item = cases.find((item) => item.id === pair.caseId);
      assert.ok(item && !ids.has(pair.caseId) && item.group === pair.group, 'Unregistered or duplicate pair.');
      ids.add(pair.caseId);
      for (const arm of ['jevFirst', 'lunaOnly']) {
        if (!pair[arm]) continue;
        assert.equal(pair[arm].caseId, item.id);
        assert.equal(pair[arm].arm, arm);
        assert.equal(pair[arm].questionCode, item.questionCode);
        assert.equal(pair[arm].catalogVersion, 'focused-contextual-answer-2026-10-04-v3');
        assert.equal(pair[arm].gateVersion, 'contextual-conservative-v2-calibrated');
        assert.equal(pair[arm].lunaDispatches, pair[arm].dispatches.filter((dispatch) => dispatch.provider === 'luna').length);
      }
    }
    let labels;
    if (args.includes('--labels')) {
      const review = JSON.parse(await readFile(resolve(option('--labels')), 'utf8'));
      assert.equal(review.corpusHash, corpusHash);
      assert.equal(review.runtimeSha256, artifact.runtimeSha256);
      labels = review.labels;
    }
    console.info(JSON.stringify(summarizePairs(applyJointLabels(artifact.pairs, labels), { cases }), null, 2));
    return;
  }
  if (!args.includes('--run-approved')) {
    console.info(JSON.stringify({ status: 'HOLD', action: 'offline_validation_only', corpusVersion: corpus.version,
      corpusSha256: corpusHash, split, cases: cases.length, groups: new Set(cases.map((item) => item.group)).size,
      runtimeSha256: fingerprint, policySha256: policyHash,
      missing: ['owner thresholds and execution approval', 'independent sealed holdout', 'joint outcome review'],
      providerCalls: 0 }, null, 2));
    return;
  }
  const approval = JSON.parse(await readFile(resolve(option('--approval', '')), 'utf8'));
  const workerName = option('--worker');
  validateApproval(approval, { corpusHash, split, worker: workerName });
  assert.equal(approval.runtimeSha256, fingerprint, 'Runtime changed after preregistration.');
  assert.equal(approval.policySha256, policyHash, 'Catalog/gate changed after preregistration.');
  const output = resolve(option('--output', ''));
  assert.ok(args.includes('--output'), 'Provide an explicit evaluation artifact output path.');
  if (split === 'holdout') {
    // Hash-keyed canonical ledger is fixed by the approved document. A failed
    // attempted run is consumed too; reopening requires an owner decision.
    assert.ok(typeof approval.holdoutLedgerDirectory === 'string' && approval.holdoutLedgerDirectory);
    await writeFile(join(resolve(approval.holdoutLedgerDirectory), corpusHash + '.json'),
      JSON.stringify({ corpusHash, owner: approval.owner, attemptedAt: new Date().toISOString(), state: 'consumed_on_attempt' }), { flag: 'wx' });
  }
  const { unstable_dev } = await loadWrangler();
  const directory = await mkdtemp(join(tmpdir(), 'jev-contextual-paired-'));
  const token = randomBytes(32).toString('hex');
  let worker;
  const pairs = [];
  const runStarted = Date.now();
  try {
    const entry = join(directory, 'paired.ts');
    const config = join(directory, 'wrangler.json');
    await writeFile(entry, createPairedWorkerSource({ root: ROOT, cases, digest: sha256(token), expiresAt: Date.now() + 30 * 60_000,
      providerDispatchesPerTurn: approval.executionLimits.providerDispatchesPerTurn }));
    await writeFile(config, JSON.stringify({ name: workerName, main: 'paired.ts', compatibility_date: '2026-04-10' }));
    worker = await unstable_dev(entry, { config, local: false, ip: '127.0.0.1', port: 0,
      inspect: false, logLevel: 'none', experimental: { disableExperimentalWarning: true,
        disableDevRegistry: true, watch: false, showInteractiveDevSession: false, enableIpc: false } });
    const headers = { Authorization: 'Bearer ' + token };
    const ready = await worker.fetch('/ready', { headers, signal: AbortSignal.timeout(45_000) });
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { openRouter: true, openAi: true });
    for (const [index, item] of cases.entries()) {
      const pair = { caseId: item.id, group: item.group, labelSource: item.labelSource,
        order: index % 2 === 0 ? ['jevFirst', 'lunaOnly'] : ['lunaOnly', 'jevFirst'] };
      pairs.push(pair);
      for (const arm of pair.order) {
        const remainingMs = approval.executionLimits.totalElapsedMs - (Date.now() - runStarted);
        assert.ok(remainingMs > 0, 'Preregistered elapsed budget exhausted.');
        const response = await worker.fetch('/case', { method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ caseId: item.id, arm }), signal: AbortSignal.timeout(Math.min(300_000, remainingMs)) });
        assert.equal(response.status, 200);
        pair[arm] = await response.json();
        assert.equal(pair[arm].caseId, item.id);
        assert.equal(pair[arm].arm, arm);
      }
    }
  } finally {
    try {
      await writeFile(output, JSON.stringify({ corpusVersion: corpus.version, corpusHash,
        runtimeSha256: fingerprint, policySha256: policyHash, split, attemptedAt: new Date().toISOString(),
        status: pairs.length === cases.length && pairs.every((pair) => pair.jevFirst && pair.lunaOnly)
          ? 'awaiting_joint_review' : 'incomplete_HOLD',
        expectedTurns: cases.length, summary: summarizePairs(pairs, { cases }), pairs }, null, 2));
    } finally {
      try { await worker?.stop(); }
      finally { await rm(directory, { recursive: true, force: true }); }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {
  console.error('Paired evaluation refused or incomplete. Check preregistration and the isolated evaluation prerequisites.');
  process.exitCode = 1;
});
