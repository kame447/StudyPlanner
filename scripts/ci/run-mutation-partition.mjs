import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { withIsolatedMutationTools } from './isolated-mutation-toolchain.mjs';
import { aggregateReports, sha256, shardIds } from './mutation-partition.mjs';
import { snapshotLockedToolchain } from './locked-test-toolchain.mjs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); };
export async function publishGuardedCandidate(candidate, destination, task) {
  fs.rmSync(destination, { force: true });
  await task();
  const pending = destination + '.pending';
  write(pending, { ...read(candidate), guardsVerified: true });
  fs.renameSync(pending, destination);
}
export function runIdentity() {
  const git = arg => execFileSync('git', ['rev-parse', arg], { encoding: 'utf8' }).trim();
  const checkout = git('HEAD');
  if (process.env.GITHUB_ACTIONS === 'true' && checkout !== process.env.GITHUB_SHA) throw new Error('Checkout differs from the workflow event SHA');
  return { repository: process.env.GITHUB_REPOSITORY ?? 'local', checkout, tree: git('HEAD^{tree}'), eventSha: process.env.GITHUB_SHA ?? checkout, headSha: process.env.MUTATION_HEAD_SHA ?? checkout, run: process.env.GITHUB_RUN_ID ?? 'local', attempt: process.env.GITHUB_RUN_ATTEMPT ?? 'local' };
}

export async function runPartitionCommand([mode, shard]) {
  const identity = runIdentity();
  const manifestPath = path.resolve('reports/stryker/inventory/manifest.json');
  const worker = fileURLToPath(new URL('./mutation-partition-worker.mjs', import.meta.url));
  if (mode === 'validate-report' && shard) {
    await withIsolatedMutationTools(({ directory, run }) => run(worker, [directory, mode, path.resolve(shard)]));
    return;
  }
  if (mode === 'aggregate') {
    for (const file of ['weekly-planning.json', 'aggregate-summary.json', 'aggregate-candidate.json']) fs.rmSync(path.resolve('reports/stryker', file), { force: true });
    if (process.env.MUTATION_PLAN_RESULT !== 'success' || process.env.MUTATION_SHARDS_RESULT !== 'success') throw new Error('Mutation workload failed, cancelled or skipped');
    const workers = Object.fromEntries(shardIds.map(id => [id, { report: read(`reports/stryker/shards/${id}/weekly-planning.json`), completion: read(`reports/stryker/shards/${id}/completion.json`) }]));
    const manifest = read(manifestPath);
    for (const [file, hash] of Object.entries({ ...manifest.inputHashes, 'stryker.config.mjs': manifest.configHash })) {
      if (sha256(fs.readFileSync(file)) !== hash) throw new Error(`Aggregator input drift: ${file}`);
    }
    if (process.version !== manifest.versions.node || manifest.installedHash !== sha256(JSON.stringify(snapshotLockedToolchain(process.cwd())))) throw new Error('Aggregator installed dependency baseline differs');
    const { report, summary } = aggregateReports(manifest, workers, identity);
    const candidate = path.resolve('reports/stryker/aggregate-candidate.json');
    write(candidate, report);
    await withIsolatedMutationTools(({ directory, run }) => run(worker, [directory, 'validate-report', candidate]));
    fs.renameSync(candidate, 'reports/stryker/weekly-planning.json');
    write('reports/stryker/aggregate-summary.json', summary);
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.passed) throw new Error('Global mutation score is below50');
    return;
  }
  if (mode !== 'plan' && !(mode === 'shard' && shardIds.includes(shard))) throw new Error('Expected partition plan, shard a/b or aggregate');
  const output = mode === 'plan' ? path.dirname(manifestPath) : path.resolve('reports/stryker/shards', shard);
  fs.mkdirSync(output, { recursive: true });
  // Invalidate old execution evidence, preserving capacity logs recorded by CI.
  const generated = mode === 'plan' ? ['manifest.json', 'inventory-candidate.json', 'reporter-negative-control.json'] : ['completion.json', 'completion-candidate.json', 'weekly-planning.json', 'incremental.json', 'events', 'reporter-state.json', 'stryker.config.mjs'];
  for (const name of generated) fs.rmSync(path.join(output, name), { recursive: true, force: true });
  const previous = process.env.MUTATION_RUN_IDENTITY;
  process.env.MUTATION_RUN_IDENTITY = JSON.stringify(identity);
  try {
    const candidate = mode === 'plan' ? path.join(output, 'inventory-candidate.json') : path.join(output, 'completion-candidate.json');
    await publishGuardedCandidate(candidate, mode === 'plan' ? manifestPath : path.join(output, 'completion.json'), () => withIsolatedMutationTools(({ directory, run }) => {
      run(worker, [directory, mode, mode === 'plan' ? candidate : manifestPath, shard ?? '']);
    }));
    console.log(`${mode} ${shard ?? ''}: guarded completion`);
  } finally {
    if (previous === undefined) delete process.env.MUTATION_RUN_IDENTITY;
    else process.env.MUTATION_RUN_IDENTITY = previous;
  }
}
