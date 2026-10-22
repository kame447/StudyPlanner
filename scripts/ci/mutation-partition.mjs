import crypto from 'node:crypto';
import path from 'node:path';

export const targets = [
  'src/features/weeklyPlanning/semantic/weeklyPlanningPendingQuestionV5.ts',
  'src/features/weeklyPlanning/semantic/weeklyPlanningStableV5ContextualAnswer.ts',
];
export const shardIds = ['a', 'b'];
export const thresholds = { high: 80, low: 60, break: 50 };
export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function detectionPolicy(config) {
  return [config.testRunner, config.checkers, config.plugins, config.tsconfigFile,
    config.vitest?.configFile, config.vitest?.related, config.coverageAnalysis ?? 'perTest',
    config.concurrency, config.thresholds, config.timeoutMS ?? 5000, config.timeoutFactor ?? 1.5,
    config.mutator?.plugins ?? null, config.mutator?.excludedMutations ?? [],
    config.testFiles ?? [], config.ignoreMutations ?? [], config.disableTypeChecks ?? true];
}

export function assertPolicy(config) {
  assert(equal(config.mutate, targets), 'Canonical mutation scope changed');
  assert(equal(config.thresholds, thresholds), 'Global mutation thresholds changed');
  assert(config.testRunner === 'vitest' && equal(config.checkers, ['typescript']), 'Mutation runner/checker changed');
  assert(equal(config.vitest, { configFile: 'vite.config.mjs', related: true }), 'Related selection changed');
  assert((config.coverageAnalysis ?? 'perTest') === 'perTest', 'Per-test selection changed');
  assert(config.concurrency === 4 && config.tsconfigFile === 'tsconfig.json', 'Mutation capacity/compiler changed');
  assert(equal(config.plugins, ['@stryker-mutator/vitest-runner', '@stryker-mutator/typescript-checker']), 'Unexpected mutation plugin');
  assert(equal(config.reporters, ['clear-text', 'progress', 'json', 'event-recorder']), 'Unexpected reporter delegation contract');
  assert(!config.mutator && !config.ignoreMutations && !config.testFiles && !config.disableTypeChecks, 'Unexpected mutation restriction');
}

export function partitionRanges(sources, ts) {
  const endOfFunction = (file, name) => {
    const source = ts.createSourceFile(file, sources[file], ts.ScriptTarget.Latest, true);
    assert(source.parseDiagnostics.length === 0, `Invalid TypeScript source: ${file}`);
    const matches = source.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name && node.body);
    assert(matches.length === 1, `Missing/ambiguous partition anchor: ${name}`);
    return source.getLineAndCharacterOfPosition(matches[0].end - 1).line + 1;
  };
  const [p, c] = targets;
  const lines = source => source.split('\n').length - Number(source.endsWith('\n'));
  const pe = lines(sources[p]);
  const ce = lines(sources[c]);
  const pb = endOfFunction(p, 'readWeeklyPlanningPendingQuestionV5');
  const c1 = endOfFunction(c, 'isSemanticUncertaintyReplyEnvelope');
  const c2 = endOfFunction(c, 'applyQuantityRoleAnswer');
  assert(pb < pe && c1 < c2 && c2 < ce, 'Partition anchors out of order');
  return {
    a: [{ file: p, start: 1, end: pb }, { file: c, start: c1 + 1, end: c2 }],
    b: [{ file: p, start: pb + 1, end: pe }, { file: c, start: 1, end: c1 }, { file: c, start: c2 + 1, end: ce }],
  };
}

export function mutantIdentity(file, source, mutant, apiLocation = false) {
  assert(targets.includes(file), `Unexpected mutation source: ${file}`);
  const offset = apiLocation ? 1 : 0;
  const position = value => {
    assert(Number.isInteger(value?.line) && Number.isInteger(value?.column), 'Invalid mutant location');
    return [value.line + offset, value.column + offset];
  };
  return JSON.stringify([file, sha256(source), position(mutant.location?.start), position(mutant.location?.end), mutant.mutatorName, mutant.replacement]);
}

export function relativeSource(root, file) {
  return path.relative(root, path.resolve(root, file)).split(path.sep).join('/');
}

export function assertExactKeys(actual, expected, label) {
  assert(actual.length === new Set(actual).size, `${label}: duplicate mutant`);
  assert(expected.length === new Set(expected).size, `${label}: duplicate expected mutant`);
  const wanted = new Set(expected);
  assert(actual.length === wanted.size && actual.every(key => wanted.has(key)), `${label}: omitted/unexpected mutant`);
}

export function provePartition(full, shards) {
  assert(full.length > 0, 'Empty full mutation inventory');
  for (const shard of shardIds) assert(shards[shard]?.length > 0, `Empty shard: ${shard}`);
  assertExactKeys(shardIds.flatMap(shard => shards[shard]), full, 'Partition union');
}

export function scoreMutants(mutants) {
  const counts = { Killed: 0, Timeout: 0, Survived: 0, NoCoverage: 0, CompileError: 0 };
  for (const mutant of mutants) {
    assert(Object.hasOwn(counts, mutant.status), `Incomplete/error mutant status: ${mutant.status}`);
    counts[mutant.status]++;
  }
  const detected = counts.Killed + counts.Timeout;
  const valid = detected + counts.Survived + counts.NoCoverage;
  // Match pinned mutation-testing-metrics' operation order; the gate below
  // compares integer populations, independently of display rounding.
  return { counts, detected, valid, score: valid ? (detected / valid) * 100 : null };
}

export function reportKeys(report, sources) {
  assert(report?.files && typeof report.files === 'object', 'Missing complete mutation report');
  return Object.entries(report.files).flatMap(([file, data]) => {
    assert(sources[file] !== undefined && data.source === sources[file], `Report source drift: ${file}`);
    assert(Array.isArray(data.mutants), 'Missing report mutants');
    return data.mutants.map(mutant => mutantIdentity(file, sources[file], mutant));
  });
}

export function assertReportReferences(report) {
  const ids = Object.values(report.testFiles ?? {}).flatMap(file => file.tests.map(test => test.id));
  const known = new Set(ids);
  assert(known.size === ids.length, 'Duplicate report test ID');
  const mutants = Object.values(report.files).flatMap(file => file.mutants);
  assert(new Set(mutants.map(mutant => mutant.id)).size === mutants.length, 'Duplicate report mutant ID');
  for (const mutant of mutants) {
    for (const id of [...(mutant.coveredBy ?? []), ...(mutant.killedBy ?? [])]) assert(known.has(id), 'Dangling mutant/test reference');
  }
}

export function validateReport(manifest, shard, report) {
  assert(shardIds.includes(shard), 'Unknown shard');
  assert(equal(report.thresholds, thresholds), 'Report threshold drift');
  const observed = report.config ?? {};
  assert(observed.plugins?.filter(plugin => plugin === manifest.reporterPlugin).length === 1 && equal(observed.reporters, ['strict-mutation-evidence']), 'Missing strict mutation reporter');
  assert(equal(detectionPolicy({ ...observed, plugins: observed.plugins.filter(plugin => plugin !== manifest.reporterPlugin) }), manifest.policy), 'Report detection policy drift');
  const patterns = manifest.ranges[shard].map(range => `${range.file}:${range.start}-${range.end}`);
  assert(equal(report.config.mutate, patterns), 'Report mutation ranges drift');
  assertExactKeys(reportKeys(report, manifest.sources), manifest.shards[shard], `Shard ${shard}`);
  assertReportReferences(report);
  return scoreMutants(Object.values(report.files).flatMap(file => file.mutants));
}

export function aggregateReports(manifest, workers, identity) {
  assert(manifest.schemaVersion === 1 && manifest.guardsVerified === true, 'Incomplete/unguarded mutation inventory');
  assert(equal(manifest.identity, identity), 'Inventory identity/run mismatch');
  provePartition(manifest.full, manifest.shards);
  const all = [];
  const files = {};
  const testFiles = {};
  let sample;
  for (const shard of shardIds) {
    const worker = workers[shard];
    assert(worker?.report && worker?.completion, `Missing shard report/completion: ${shard}`);
    const completion = worker.completion;
    assert(completion.kind === 'complete' && completion.guardsVerified === true, `Failed shard: ${shard}`);
    assert(completion.shard === shard && completion.manifestHash === sha256(JSON.stringify(manifest)), 'Shard inventory mismatch');
    assert(equal(completion.identity, identity), 'Shard identity/run mismatch');
    assert(completion.wireTests === 31 && completion.dryTests > 0 && typeof completion.dryTestIdsHash === 'string', 'Incomplete shard dry-run evidence');
    assert(Number.isInteger(completion.dryDistinctIds) && completion.dryDistinctIds > 0 && completion.dryDistinctIds <= completion.dryTests, 'Incomplete shard dry-run ID counts');
    assert(completion.dryTests === workers.a.completion.dryTests && completion.dryDistinctIds === workers.a.completion.dryDistinctIds && completion.dryTestIdsHash === workers.a.completion.dryTestIdsHash, 'Shard related test populations differ');
    const score = validateReport(manifest, shard, worker.report);
    assert(equal(completion.score, score), 'Shard completion score mismatch');
    sample ??= worker.report;
    const remap = ids => ids?.map(id => `${shard}:${id}`);
    for (const [file, data] of Object.entries(worker.report.files)) {
      const result = files[file] ??= { ...data, mutants: [] };
      result.mutants.push(...data.mutants.map(mutant => ({ ...mutant, id: `${shard}:${mutant.id}`, coveredBy: remap(mutant.coveredBy), killedBy: remap(mutant.killedBy) })));
    }
    for (const [file, data] of Object.entries(worker.report.testFiles ?? {})) {
      const result = testFiles[file] ??= { ...data, tests: [] };
      result.tests.push(...data.tests.map(test => ({ ...test, id: `${shard}:${test.id}` })));
    }
    all.push(...Object.values(worker.report.files).flatMap(file => file.mutants));
  }
  assertExactKeys(reportKeys({ files }, manifest.sources), manifest.full, 'Global complete union');
  const score = scoreMutants(all);
  assert(score.valid > 0, 'Global mutation denominator is zero');
  const report = { ...sample, files, testFiles, config: { ...sample.config, ...manifest.canonicalConfig, mutate: targets }, thresholds };
  assertReportReferences(report);
  return {
    report,
    summary: { ...score, passed: 100 * score.detected >= thresholds.break * score.valid, mutants: all.length, executionShards: shardIds, logicalDryTests: workers.a.completion.dryTests, logicalDistinctDryIds: workers.a.completion.dryDistinctIds, dryTestExecutions: shardIds.length * workers.a.completion.dryTests, identity },
  };
}
