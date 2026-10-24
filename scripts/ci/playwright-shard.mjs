import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export function validateShard(shard, name = 'shard') {
  if (shard !== undefined && (typeof shard !== 'string'
    || !/^[1-9][0-9]*\/[1-9][0-9]*$/.test(shard)
    || BigInt(shard.split('/')[0]) > BigInt(shard.split('/')[1]))) {
    throw new Error(`Invalid ${name}: expected i/n with 1 <= i <= n`);
  }
}

export function runPlaywright(root, args) {
  const shardArgs = args.filter(arg => arg.startsWith('--shard='));
  if (shardArgs.length > 1 || args.includes('--shard')) throw new Error('Expected at most one --shard=i/n');
  const shardArg = shardArgs[0];
  validateShard(shardArg?.slice('--shard='.length));
  // Playwright 1.64 permits empty shards even without --pass-with-no-tests.
  // Prove this leg contains tests before starting any browser or server.
  if (shardArg) {
    const listed = spawnSync('./tests/e2e/node_modules/.bin/playwright', [...args, '--list', '--reporter=json'], {
      cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    });
    if (listed.error) throw listed.error;
    if (listed.status !== 0) {
      process.stderr.write(listed.stderr || listed.stdout || 'Browser shard listing failed\n');
      return listed.status ?? 1;
    }
    const report = JSON.parse(listed.stdout);
    const hasTests = suite => suite.specs?.some(spec => spec.tests?.length > 0) || suite.suites?.some(hasTests);
    if (!Array.isArray(report.errors) || report.errors.length
      || !Array.isArray(report.suites) || !report.suites.some(hasTests)) {
      throw new Error(`Empty or invalid browser shard listing: ${shardArg}`);
    }
  }
  const result = spawnSync('./tests/e2e/node_modules/.bin/playwright', args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const shardArg = args.find(arg => arg.startsWith('--shard='));
  process.stdout.write(`Playwright execution: ${shardArg ? `sharded ${shardArg.slice('--shard='.length)}` : 'unsharded'}\n`);
  process.exitCode = runPlaywright(process.cwd(), args);
}
