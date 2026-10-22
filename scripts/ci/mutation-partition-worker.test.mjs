import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import base from '../../stryker.config.mjs';
import { detectionPolicy, mutantIdentity, partitionRanges, scoreMutants, sha256, targets } from './mutation-partition.mjs';
import { executeShardApi, prepareInventory } from './mutation-partition-worker.mjs';
import { createReporterState, strictReporter } from './mutation-partition-reporter.mjs';

const root = path.resolve(new URL('../../', import.meta.url).pathname);
const sources = Object.fromEntries(targets.map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
const ranges = partitionRanges(sources, ts);
function evidence(status = 'Killed') {
  const mutant = { id: '0', mutatorName: 'ConditionalExpression', replacement: 'false', status, location: { start: { line: 19, column: 1 }, end: { line: 19, column: 2 } } };
  const key = mutantIdentity(targets[0], sources[targets[0]], mutant);
  const reporterPlugin = './scripts/ci/mutation-partition-plugin.mjs';
  const manifest = { sources, ranges, reporterPlugin, policy: detectionPolicy(base), shards: { a: [key] }, identity: { run: 'fixture' } };
  const report = { config: { ...base, plugins: [...base.plugins, reporterPlugin], reporters: ['strict-mutation-evidence'], mutate: ranges.a.map(range => `${range.file}:${range.start}-${range.end}`) }, thresholds: base.thresholds, files: { [targets[0]]: { source: sources[targets[0]], mutants: [mutant] } } };
  const apiResults = [{ ...mutant, fileName: path.join(root, targets[0]) }];
  const plans = { mutantPlans: [{ mutant: { ...apiResults[0], location: { start: { line: 18, column: 0 }, end: { line: 18, column: 1 } } } }] };
  const dry = { result: { status: 'complete', tests: Array.from({ length: 31 }, (_, i) => ({ id: 'wire-' + i, status: 0, fileName: '/fixture/focusedContextualBindingWire.test.ts' })) } };
  return { manifest, report, apiResults, plans, dry };
}
async function run(mode) {
  const e = evidence(['score', 'missing-threshold-exit', 'reject-low', 'wrapUp-error', 'async-error'].includes(mode) ? 'Survived' : mode === 'zero-local' ? 'CompileError' : 'Killed');
  let exitCode;
  const reporting = createReporterState();
  const reporter = strictReporter({ json: {
    onMutationTestReportReady() { if (mode === 'async-error') return Promise.reject(new Error('asynchronous reporter failure')); },
    wrapUp() { if (mode === 'wrapUp-error') throw new Error('complete output followed by reporter failure'); },
  } }, reporting, 50);
  const execute = async () => {
    if (['score', 'unexpected-one', 'reject-low', 'wrapUp-error', 'async-error'].includes(mode)) exitCode = 1;
    if (mode === 'operational') exitCode = 2;
    if (mode === 'reject' || mode === 'reject-low') throw new Error('actual Stryker failure');
    const observed = scoreMutants(e.apiResults);
    reporter.onMutationTestReportReady(e.report, { systemUnderTestMetrics: { metrics: { mutationScore: observed.score ?? NaN } } });
    // Reproduce upstream's catch-and-log path: resolution is not a validity proof.
    await reporter.wrapUp().catch(() => {});
    if (mode === 'disposal') throw new Error('injector disposal failed');
    if (mode === 'missing-result') return [];
    return e.apiResults;
  };
  if (mode === 'skip') e.dry.result.tests[0].status = 2;
  if (mode === 'wire') e.dry.result.tests.pop();
  if (mode === 'repeated-id') e.dry.result.tests.push(...Array.from({ length: 2 }, () => ({ id: 'shared-parameterized-id', status: 0, fileName: '/fixture/parameterized.test.ts' })));
  if (mode === 'plan') e.plans.mutantPlans = [];
  if (mode === 'status') e.apiResults[0].status = 'CompileError';
  if (mode === 'report') e.report.files[targets[0]].mutants = [];
  const completion = await executeShardApi({ run: execute, readEvidence: () => e, manifest: e.manifest, shard: 'a', root, reporting, getExitCode: () => exitCode, setExitCode: code => { exitCode = code; } });
  return { completion, exitCode };
}

describe('resolved public API score-only boundary', () => {
  it('accepts complete successful execution', async () => {
    const { completion } = await run('success');
    expect(completion).toMatchObject({ kind: 'complete', scoreDeferred: false, originalExitCode: 0, wireTests: 31 });
    expect(completion).not.toHaveProperty('guardsVerified');
  });
  it('defers only a completed below-threshold score, retaining the original exit', async () => {
    const { completion, exitCode } = await run('score');
    expect(completion).toMatchObject({ kind: 'complete', scoreDeferred: true, originalExitCode: 1, score: { score: 0 } });
    expect(exitCode).toBe(0);
  });
  it.each(['reject', 'reject-low', 'disposal', 'wrapUp-error', 'async-error', 'missing-threshold-exit', 'operational', 'unexpected-one', 'missing-result', 'skip', 'wire', 'plan', 'status', 'report'])('never defers %s failure', async mode => {
    await expect(run(mode)).rejects.toThrow();
  });
  it('accepts complete local(0,0) without inventing a local score or score deferral', async () => {
    const { completion } = await run('zero-local');
    expect(completion).toMatchObject({ score: { detected: 0, valid: 0, score: null }, scoreDeferred: false });
  });
  it('preserves repeated dry-run IDs as separate successful executions', async () => {
    const { completion } = await run('repeated-id');
    expect(completion).toMatchObject({ kind: 'complete', dryTests: 33, dryDistinctIds: 32, wireTests: 31 });
    expect(completion.dryTestIdsHash).toBe(sha256(JSON.stringify([...Array.from({ length: 31 }, (_, i) => 'wire-' + i), 'shared-parameterized-id', 'shared-parameterized-id'].sort())));
  });
});

describe('independent full-scope instrumenter inventory', () => {
  const points = [
    { file: targets[0], line: 18 }, { file: targets[0], line: 56 },
    { file: targets[1], line: 100 }, { file: targets[1], line: 200 }, { file: targets[1], line: 500 },
  ];
  function fakeInstrumenter(mode) {
    return { async instrument(files, options) {
      expect(options).toEqual({ plugins: null, excludedMutations: [], ignorers: [] });
      const candidates = [...points];
      if (mode === 'crossing') candidates.push({ file: targets[1], line: 182, end: 185 });
      const mutants = candidates.filter(point => {
        const file = files.find(f => f.name === path.join(root, point.file));
        return file.mutate === true || file.mutate.some(range => range.start.line <= point.line && (point.end ?? point.line) <= range.end.line);
      }).map((point, index) => ({ id: String(index), fileName: path.join(root, point.file), mutatorName: 'BlockStatement', replacement: '{}', location: { start: { line: point.line, column: 0 }, end: { line: point.end ?? point.line, column: 1 } } }));
      if (mode === 'overlap' && files[0].mutate !== true) mutants.push({ ...mutants[0] });
      return { mutants };
    } };
  }
  it('generates the full population separately from each selected range population', async () => {
    const manifest = await prepareInventory({ root, instrumenter: fakeInstrumenter(), ts, config: base, identity: {}, versions: {} });
    expect(manifest.full).toHaveLength(5);
    expect(manifest.shards.a).toHaveLength(2);
    expect(manifest.shards.b).toHaveLength(3);
    expect(manifest).not.toHaveProperty('guardsVerified');
  });
  it.each(['crossing', 'overlap'])('rejects %s rather than inventing a complete range proof', async mode => {
    await expect(prepareInventory({ root, instrumenter: fakeInstrumenter(mode), ts, config: base, identity: {}, versions: {} })).rejects.toThrow();
  });
});
