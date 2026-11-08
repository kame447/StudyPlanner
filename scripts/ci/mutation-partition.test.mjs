import fs from 'node:fs';
import ts from 'typescript';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import base from '../../stryker.config.mjs';
import { aggregateReports, assertExactKeys, detectionPolicy, mutantIdentity, partitionRanges, provePartition, scoreMutants, sha256, targets } from './mutation-partition.mjs';
import { publishGuardedCandidate, runIdentity } from './run-mutation-partition.mjs';

const sources = Object.fromEntries(targets.map(file => [file, fs.readFileSync(new URL('../../' + file, import.meta.url), 'utf8')]));
const identity = { checkout: 'same-commit', run: '42', attempt: '1' };
function fixture(statusA = ['Killed'], statusB = ['Survived']) {
  const file = targets[0];
  let index = 0;
  const report = statuses => ({ thresholds: { high: 80, low: 60, break: 50 }, files: { [file]: { source: sources[file], mutants: statuses.map(status => ({ id: 'local-' + index, status, location: { start: { line: ++index, column: 1 }, end: { line: index, column: 2 } }, mutatorName: 'ConditionalExpression', replacement: 'false', killedBy: ['0'], coveredBy: ['0'] })) } }, testFiles: { 'same.test.ts': { tests: [{ id: '0', name: 'same test' }] } } });
  const reports = { a: report(statusA), b: report(statusB) };
  const shards = Object.fromEntries(Object.entries(reports).map(([shard, r]) => [shard, r.files[file].mutants.map(m => mutantIdentity(file, sources[file], m))]));
  const ranges = partitionRanges(sources, ts);
  const reporterPlugin = './scripts/ci/mutation-partition-plugin.mjs';
  for (const [shard, r] of Object.entries(reports)) r.config = { ...base, plugins: [...base.plugins, reporterPlugin], reporters: ['strict-mutation-evidence'], mutate: ranges[shard].map(range => `${range.file}:${range.start}-${range.end}`) };
  const manifest = { schemaVersion: 1, guardsVerified: true, sources, ranges, reporterPlugin, policy: detectionPolicy(base), shards, full: [...shards.a, ...shards.b], identity };
  const workers = Object.fromEntries(Object.entries(reports).map(([shard, r]) => [shard, { report: r, completion: { kind: 'complete', shard, guardsVerified: true, identity, manifestHash: sha256(JSON.stringify(manifest)), dryTests: 31, dryDistinctIds: 31, wireTests: 32, dryTestIdsHash: 'same-population', score: scoreMutants(r.files[file].mutants) } }]));
  return { manifest, workers };
}

describe('complete mutation partition', () => {
  // The end line of a top-level function, read independently of the code under test.
  const endLine = (source, name) => {
    const file = ts.createSourceFile('target.ts', source, ts.ScriptTarget.Latest, true);
    const node = file.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
    return file.getLineAndCharacterOfPosition(node.end - 1).line + 1;
  };
  it('derives inclusive boundaries from the end of two top-level functions and covers every line exactly once', () => {
    const [file] = targets;
    const ranges = partitionRanges(sources, ts);
    const before = endLine(sources[file], 'computeVNextWorkUnits');
    const last = endLine(sources[file], 'computeUnits');
    const lineCount = sources[file].split('\n').length - Number(sources[file].endsWith('\n'));
    expect(ranges.a).toEqual([{ file, start: before + 1, end: last }]);
    expect(ranges.b).toEqual([{ file, start: 1, end: before }, { file, start: last + 1, end: lineCount }]);
    const covered = [...ranges.a, ...ranges.b].sort((x, y) => x.start - y.start);
    expect(covered[0].start).toBe(1);
    covered.slice(1).forEach((range, index) => expect(range.start).toBe(covered[index].end + 1));
    expect(covered.at(-1).end).toBe(lineCount);
    const moved = { ...sources, [file]: '\n' + sources[file] };
    expect(partitionRanges(moved, ts).a[0]).toMatchObject({ start: before + 2, end: last + 1 });
  });
  it('keeps the large function in its own shard so that each shard holds a similar share of the mutants', () => {
    const [file] = targets;
    const [range] = partitionRanges(sources, ts).a;
    // `computeUnits` is the dominant function of the target (about 280 of 506 generated mutants, measured with the pinned
    // instrumenter), so shard a spans little else.
    expect(range.end - range.start + 1).toBeGreaterThan(120);
    expect(sources[file].split('\n').slice(range.start - 1, range.end).join('\n')).toContain('function computeUnits(');
  });
  it('rejects missing anchors rather than losing a source tail', () => {
    expect(() => partitionRanges({ ...sources, [targets[0]]: 'export const missing = 1;' }, ts)).toThrow('anchor');
  });
  it('proves disjoint union, not merely equal total count', () => {
    provePartition(['one', 'two'], { a: ['one'], b: ['two'] });
    expect(() => provePartition(['one', 'two'], { a: ['one'], b: ['one'] })).toThrow('duplicate');
    expect(() => provePartition(['one', 'two'], { a: ['one'], b: ['other'] })).toThrow('omitted');
    expect(() => assertExactKeys(['one'], ['one', 'tail'], 'containment')).toThrow('omitted');
  });
  it('matches API and report coordinates while ignoring local numeric IDs', () => {
    const file = targets[0];
    const api = { id: '1', location: { start: { line: 0, column: 0 }, end: { line: 0, column: 1 } }, mutatorName: 'X', replacement: '{}' };
    const report = { ...api, id: 'another', location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } } };
    expect(mutantIdentity(file, sources[file], api, true)).toBe(mutantIdentity(file, sources[file], report));
    expect(mutantIdentity(file, sources[file] + '\n', report)).not.toBe(mutantIdentity(file, sources[file], report));
  });
});

describe('one global mutation gate', () => {
  it('weights valid populations and allows a below-50 partition when the global score passes', () => {
    const { manifest, workers } = fixture(['Killed', 'Killed', 'Killed', 'CompileError'], ['Survived']);
    const result = aggregateReports(manifest, workers, identity);
    expect(result.summary).toMatchObject({ detected: 3, valid: 4, score: 75, passed: true, mutants: 5, executionShards: ['a', 'b'], logicalDryTests: 31, dryTestExecutions: 62 });
    expect(result.report.files[targets[0]].mutants.map(m => m.id)).toEqual(['a:local-0', 'a:local-1', 'a:local-2', 'a:local-3', 'b:local-4']);
    expect(result.report.testFiles['same.test.ts'].tests.map(t => t.id)).toEqual(['a:0', 'b:0']);
    expect(result.report.files[targets[0]].mutants[0].killedBy).toEqual(['a:0']);
  });
  it('fails the global score even when one worker has100%, and includes NoCoverage', () => {
    const { manifest, workers } = fixture(['Killed'], ['Survived', 'NoCoverage', 'Survived']);
    expect(aggregateReports(manifest, workers, identity).summary).toMatchObject({ detected: 1, valid: 4, score: 25, passed: false });
  });
  it('passes exact threshold equality without rounding', () => {
    const { manifest, workers } = fixture();
    expect(aggregateReports(manifest, workers, identity).summary).toMatchObject({ score: 50, passed: true });
  });
  it.each(['same', 'lost', 'replaced'])('compares the dry execution multiset with repeated IDs: %s occurrence', mode => {
    const { manifest, workers } = fixture();
    const executions = [...Array.from({ length: 31 }, (_, i) => 'wire-' + i), 'parameterized', 'parameterized'];
    for (const shard of ['a', 'b']) {
      const observed = [...executions];
      if (shard === 'b' && mode === 'lost') observed.pop();
      if (shard === 'b' && mode === 'replaced') observed[observed.length - 1] = 'wire-0';
      Object.assign(workers[shard].completion, { dryTests: observed.length, dryDistinctIds: new Set(observed).size, dryTestIdsHash: sha256(JSON.stringify(observed.sort())) });
    }
    if (mode === 'same') expect(aggregateReports(manifest, workers, identity).summary).toMatchObject({ logicalDryTests: 33, logicalDistinctDryIds: 32, dryTestExecutions: 66 });
    else expect(() => aggregateReports(manifest, workers, identity)).toThrow('populations differ');
  });
  it.each(['missing', 'failed', 'guards', 'stale', 'sha', 'duplicate', 'source', 'threshold', 'status', 'reference', 'related'])('rejects %s evidence even if the remaining report scores100%', mode => {
    const { manifest, workers } = fixture(['Killed'], ['Killed']);
    if (mode === 'missing') delete workers.b.report;
    if (mode === 'failed') workers.b.completion.kind = 'failed';
    if (mode === 'guards') workers.b.completion.guardsVerified = false;
    if (mode === 'stale') workers.b.completion.identity = { ...identity, attempt: 'old' };
    if (mode === 'sha') workers.b.completion.identity = { ...identity, checkout: 'another-commit' };
    if (mode === 'duplicate') workers.b.report.files[targets[0]].mutants.push(workers.b.report.files[targets[0]].mutants[0]);
    if (mode === 'source') workers.b.report.files[targets[0]].source += '\n';
    if (mode === 'threshold') workers.b.report.thresholds.break = 0;
    if (mode === 'status') workers.b.report.files[targets[0]].mutants[0].status = 'RuntimeError';
    if (mode === 'reference') workers.b.report.files[targets[0]].mutants[0].killedBy = ['missing-test'];
    if (mode === 'related') workers.b.completion.dryTestIdsHash = 'different-population';
    expect(() => aggregateReports(manifest, workers, identity)).toThrow();
  });
  it('rejects a zero global denominator and unknown/incomplete statuses', () => {
    const { manifest, workers } = fixture(['CompileError'], ['CompileError']);
    expect(() => aggregateReports(manifest, workers, identity)).toThrow('denominator');
    expect(() => scoreMutants([{ status: 'Pending' }])).toThrow('Incomplete');
  });
  it('allows a complete zero-valid local population to contribute(0,0)', () => {
    const { manifest, workers } = fixture(['CompileError'], ['Killed']);
    expect(aggregateReports(manifest, workers, identity).summary).toMatchObject({ detected: 1, valid: 1, score: 100, passed: true, mutants: 2 });
  });
  it('does not pass a score that only rounds to50', () => {
    const { manifest, workers } = fixture(Array(9999).fill('Killed'), Array(10001).fill('Survived'));
    const result = aggregateReports(manifest, workers, identity);
    expect(result.summary.score.toFixed(0)).toBe('50');
    expect(result.summary.passed).toBe(false);
  });
  it('cannot publish completion when a post-run dependency/manifest guard fails', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-guarded-publication-'));
    const candidate = path.join(root, 'candidate.json');
    const completion = path.join(root, 'completion.json');
    try {
      fs.writeFileSync(completion, JSON.stringify({ stale: true }));
      await expect(publishGuardedCandidate(candidate, completion, async () => {
        fs.writeFileSync(candidate, JSON.stringify({ kind: 'complete' }));
        throw new Error('post-run installed dependency/manifest guard failure');
      })).rejects.toThrow('guard failure');
      expect(fs.existsSync(candidate)).toBe(true);
      expect(fs.existsSync(completion)).toBe(false);
      await publishGuardedCandidate(candidate, completion, async () => {});
      expect(JSON.parse(fs.readFileSync(completion, 'utf8'))).toEqual({ kind: 'complete', guardsVerified: true });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('rejects a CI checkout that differs from the workflow event SHA', () => {
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    vi.stubEnv('GITHUB_SHA', 'different-from-checkout');
    try { expect(() => runIdentity()).toThrow('workflow event SHA'); }
    finally { vi.unstubAllEnvs(); }
  });
});
