import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { assertExactKeys, assertPolicy, detectionPolicy, mutantIdentity, partitionRanges, provePartition, relativeSource, sha256, shardIds, targets, validateReport } from './mutation-partition.mjs';
import { assertReporterComplete, createReporterState, reporterState, strictReporter } from './mutation-partition-reporter.mjs';
import { snapshotLockedToolchain } from './locked-test-toolchain.mjs';

const check = (condition, message) => { if (!condition) throw new Error(message); };
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); };
export const coreHashes = {
  'dist/src/stryker.js': '40aad2f8b42dd95e4732d5d0aefb9c528f5e3ffae457f00399b146c429210252',
  'dist/src/reporters/mutation-test-report-helper.js': 'a40ce24393f33aeb88024aefeeab8a401e867ce3f51bb643ca423d1ee44bbe28',
};

export function attestTools(directory) {
  const requireTool = createRequire(path.join(directory, 'package.json'));
  const versions = { node: process.version };
  for (const name of ['core', 'instrumenter', 'vitest-runner', 'typescript-checker']) {
    const file = requireTool.resolve(`@stryker-mutator/${name}/package.json`);
    check(json(file).version === '9.6.1', `Unreviewed mutation tool: ${name}`);
    versions[name] = '9.6.1';
  }
  const coreRoot = path.dirname(requireTool.resolve('@stryker-mutator/core/package.json'));
  for (const [file, expected] of Object.entries(coreHashes)) {
    check(sha256(fs.readFileSync(path.join(coreRoot, file))) === expected, 'Unreviewed Stryker completion/score-exit implementation');
  }
  for (const name of ['vitest', 'typescript']) versions[name] = json(requireTool.resolve(name + '/package.json')).version;
  const fromVitest = createRequire(requireTool.resolve('vitest/package.json'));
  versions.tinypool = json(fromVitest.resolve('tinypool/package.json')).version;
  return { requireTool, versions };
}

// Only the public API's resolved-and-disposed path can defer its known score exit.
// A rejected API, report mismatch or any other exit is always a workload failure.
export async function executeShardApi({ run, readEvidence, manifest, shard, root, getExitCode, setExitCode, reporting = reporterState }) {
  check(getExitCode() === undefined || getExitCode() === 0, 'Pre-existing mutation worker failure');
  const apiResults = await run();
  check(Array.isArray(apiResults), 'Stryker API did not return completed results');
  assertReporterComplete(reporting, apiResults.length);
  const { report, dry, plans } = readEvidence();
  const score = validateReport(manifest, shard, report);
  check(reporting.decision.detected === score.detected && reporting.decision.valid === score.valid && reporting.decision.score === score.score, 'Typed score observation differs');
  const keys = apiResults.map(mutant => mutantIdentity(relativeSource(root, mutant.fileName), manifest.sources[relativeSource(root, mutant.fileName)], mutant));
  assertExactKeys(keys, manifest.shards[shard], 'Resolved API result');
  const reportStatuses = new Map(Object.entries(report.files).flatMap(([file, data]) => data.mutants.map(mutant => [mutantIdentity(file, data.source, mutant), mutant.status])));
  apiResults.forEach((mutant, index) => check(reportStatuses.get(keys[index]) === mutant.status, 'API/report status mismatch'));
  const planKeys = plans.mutantPlans.map(({ mutant }) => mutantIdentity(relativeSource(root, mutant.fileName), manifest.sources[relativeSource(root, mutant.fileName)], mutant, true));
  assertExactKeys(planKeys, manifest.shards[shard], 'Mutation plan');
  check(dry.result?.status === 'complete' && dry.result.tests.length > 0, 'Incomplete mutation dry run');
  check(dry.result.tests.every(test => test.status === 0), 'Failed/skipped mutation dry-run test');
  const wire = dry.result.tests.filter(test => test.fileName.endsWith('/focusedContextualBindingWire.test.ts'));
  check(wire.length === 31, 'Missing historical Worker compatibility tests');
  const testIds = dry.result.tests.map(test => test.id).sort();
  // Parameterized tests can share a runner ID. Hash the complete sorted array,
  // retaining every occurrence; report-local numeric IDs remain unique.
  const dryDistinctIds = new Set(testIds).size;
  const code = getExitCode() ?? 0;
  const scoreDeferred = code === 1 && reporting.decision.kind === 'below-threshold' && reporting.decision.breaking === 50;
  check((code === 0 && reporting.decision.kind !== 'below-threshold') || scoreDeferred, `Mutation API operational/threshold exit mismatch: ${code}`);
  if (scoreDeferred) setExitCode(0);
  return { kind: 'complete', shard, score, scoreDeferred, originalExitCode: code, reporting, dryTests: testIds.length, dryDistinctIds, dryTestIdsHash: sha256(JSON.stringify(testIds)), wireTests: wire.length, manifestHash: sha256(JSON.stringify(manifest)), identity: manifest.identity };
}

export async function prepareInventory({ root, instrumenter, ts, config, identity, versions }) {
  assertPolicy(config);
  const sources = Object.fromEntries(targets.map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
  const ranges = partitionRanges(sources, ts);
  const inputHashes = Object.fromEntries(['package.json', 'package-lock.json', 'vite.config.mjs', 'tsconfig.json', '.node-version'].map(file => [file, sha256(fs.readFileSync(path.join(root, file)))]));
  const instrument = async selected => {
    const files = targets.map(file => ({ name: path.join(root, file), content: sources[file], mutate: selected ? selected.filter(range => range.file === file).map(range => ({ start: { line: range.start - 1, column: 0 }, end: { line: range.end - 1, column: Number.MAX_SAFE_INTEGER } })) : true }));
    const result = await instrumenter.instrument(files, { plugins: null, excludedMutations: [], ignorers: [] });
    return result.mutants.map(mutant => mutantIdentity(relativeSource(root, mutant.fileName), sources[relativeSource(root, mutant.fileName)], mutant, true));
  };
  const full = await instrument();
  const shards = {};
  for (const shard of shardIds) shards[shard] = await instrument(ranges[shard]);
  provePartition(full, shards);
  return { schemaVersion: 1, identity, versions, inputHashes, installedHash: sha256(JSON.stringify(snapshotLockedToolchain(root))), canonicalConfig: config, reporterPlugin: './scripts/ci/mutation-partition-plugin.mjs', policy: detectionPolicy(config), configHash: sha256(fs.readFileSync(path.join(root, 'stryker.config.mjs'))), sources, ranges, full, shards };
}

async function main() {
  const [directory, mode, input, shard] = process.argv.slice(2);
  const root = process.cwd();
  const { requireTool, versions } = attestTools(directory);
  const base = (await import(pathToFileURL(path.join(root, 'stryker.config.mjs')).href)).default;
  assertPolicy(base);
  if (mode === 'validate-report') {
    const { default: Ajv } = await import(pathToFileURL(requireTool.resolve('ajv')).href);
    const { schema } = await import(pathToFileURL(requireTool.resolve('mutation-testing-report-schema')).href);
    const ajv = new Ajv({ allErrors: true });
    ajv.addFormat('uri', { type: 'string', validate: value => !/[\u0000-\u0020\u007f]/.test(value) && URL.canParse(value) });
    const validate = ajv.compile(schema);
    check(validate(json(input)), `Invalid merged mutation report schema: ${JSON.stringify(validate.errors)}`);
    return;
  }
  if (mode === 'plan') {
    // This is a reporting-only negative control, not a Stryker/test/checker run.
    // Exercise the actual pinned broadcaster which catches wrapUp failures.
    const coreRoot = path.dirname(requireTool.resolve('@stryker-mutator/core/package.json'));
    const { BroadcastReporter } = await import(pathToFileURL(path.join(coreRoot, 'dist/src/reporters/broadcast-reporter.js')).href);
    const observed = createReporterState();
    let outputWritten = false;
    const adapter = strictReporter({ json: { onMutationTestReportReady() { outputWritten = true; }, wrapUp() { throw new Error('intentional completed-output wrapUp negative control'); } } }, observed, 50);
    const logger = { debug() {}, info() {}, warn() {}, error() {}, isDebugEnabled: () => false };
    const broadcast = new BroadcastReporter({ reporters: [] }, {}, logger, adapter);
    broadcast.onMutationTestReportReady({ thresholds: { break: 50 }, files: { source: { mutants: [{ status: 'Survived' }] } } }, { systemUnderTestMetrics: { metrics: { mutationScore: 0 } } });
    await broadcast.wrapUp();
    check(outputWritten && observed.failures.some(failure => failure.method === 'wrapUp'), 'Pinned broadcaster negative control lost typed failure');
    let rejected = false;
    try { assertReporterComplete(observed, 1); } catch { rejected = true; }
    check(rejected, 'Completed-output reporter failure was accepted');
    process.env.MUTATION_TOOLS_DIRECTORY = directory;
    const plugin = await import(pathToFileURL(path.join(root, 'scripts/ci/mutation-partition-plugin.mjs')).href);
    const { createInjector } = requireTool('typed-inject');
    const injector = createInjector().provideValue('pluginCreator', { create: () => ({ wrapUp() {} }) }).provideValue('options', { thresholds: { break: 50 } });
    const registered = injector.injectFunction(plugin.strykerPlugins[0].factory);
    check(typeof registered.wrapUp === 'function' && Object.keys(reporterState.delegates).length === 4, 'Strict reporter plugin binding failed');
    await injector.dispose();
    write(path.join(path.dirname(input), 'reporter-negative-control.json'), { outputWritten, caughtUpstream: true, rejected, failures: observed.failures, pluginBound: true });
    const { Instrumenter } = await import(pathToFileURL(requireTool.resolve('@stryker-mutator/instrumenter')).href);
    const ts = requireTool('typescript');
    const instrumentLogger = { debug() {}, info() {}, warn: console.warn, error: console.error, trace() {}, isDebugEnabled: () => false };
    const identity = JSON.parse(process.env.MUTATION_RUN_IDENTITY);
    write(input, await prepareInventory({ root, instrumenter: new Instrumenter(instrumentLogger), ts, config: base, identity, versions }));
    return;
  }
  check(mode === 'shard' && shardIds.includes(shard), 'Unknown mutation partition command');
  const manifest = json(input);
  check(JSON.stringify(versions) === JSON.stringify(manifest.versions), 'Inventory/worker tool versions differ');
  check(JSON.stringify(manifest.identity) === process.env.MUTATION_RUN_IDENTITY, 'Worker checkout/run identity differs');
  check(manifest.configHash === sha256(fs.readFileSync(path.join(root, 'stryker.config.mjs'))), 'Canonical mutation config drift');
  for (const [file, hash] of Object.entries(manifest.inputHashes)) check(sha256(fs.readFileSync(path.join(root, file))) === hash, `Mutation input drift: ${file}`);
  check(manifest.installedHash === sha256(JSON.stringify(snapshotLockedToolchain(root))), 'Worker installed dependency baseline differs');
  for (const file of targets) check(fs.readFileSync(path.join(root, file), 'utf8') === manifest.sources[file], 'Worker source drift');
  provePartition(manifest.full, manifest.shards);
  const output = path.resolve('reports/stryker/shards', shard);
  const configFile = path.join(output, 'stryker.config.mjs');
  const patterns = manifest.ranges[shard].map(range => `${range.file}:${range.start}-${range.end}`);
  fs.mkdirSync(output, { recursive: true });
  process.env.MUTATION_TOOLS_DIRECTORY = directory;
  fs.writeFileSync(configFile, `import base from ${JSON.stringify(pathToFileURL(path.join(root, 'stryker.config.mjs')).href)};\nexport default { ...base, plugins: [...base.plugins, ${JSON.stringify(manifest.reporterPlugin)}], reporters: ['strict-mutation-evidence'], mutate: ${JSON.stringify(patterns)}, incrementalFile: ${JSON.stringify(path.join(output, 'incremental.json'))}, jsonReporter: {fileName:${JSON.stringify(path.join(output, 'weekly-planning.json'))}}, eventReporter: {baseDir:${JSON.stringify(path.join(output, 'events'))}} };\n`);
  const { Stryker } = await import(pathToFileURL(requireTool.resolve('@stryker-mutator/core')).href);
  let completion;
  try { completion = await executeShardApi({
    run: () => new Stryker({ configFile }).runMutationTest(), manifest, shard, root,
    getExitCode: () => process.exitCode, setExitCode: code => { process.exitCode = code; },
    readEvidence: () => {
      const event = name => {
        const matches = fs.readdirSync(path.join(output, 'events')).filter(file => file.endsWith(`-${name}.json`));
        check(matches.length === 1, `Missing/ambiguous mutation event: ${name}`);
        return json(path.join(output, 'events', matches[0]));
      };
      return { report: json(path.join(output, 'weekly-planning.json')), dry: event('onDryRunCompleted'), plans: event('onMutationTestingPlanReady') };
    },
  }); } finally { write(path.join(output, 'reporter-state.json'), reporterState); }
  write(path.join(output, 'completion-candidate.json'), completion);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
