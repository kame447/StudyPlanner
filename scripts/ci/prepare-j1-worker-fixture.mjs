import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { build, version as esbuildVersion } from 'esbuild';

export const J1_COMPATIBILITY_COMMIT = '070d25cbe14796aebb8168ac5425c93e3506df1c';
const source = 'workers/ai-proxy/src/worker.ts';
const stub = 'workers/ai-proxy/src/cloudflareWorkersVitestStub.ts';
// Preserve today's compiler semantics for this immutable fixture independently
// of future root tsconfig changes. These explicit options are also cache inputs.
export const J1_WORKER_BUILD_OPTIONS = Object.freeze({
  bundle: true, platform: 'node', format: 'esm',
  tsconfigRaw: Object.freeze({ compilerOptions: Object.freeze({
    target: 'ES2020', useDefineForClassFields: true, jsx: 'react-jsx', strict: true,
  }) }),
});
const options = J1_WORKER_BUILD_OPTIONS;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const key = sha256(JSON.stringify({
  format: 1, commit: J1_COMPATIBILITY_COMMIT, esbuildVersion,
  source, options, alias: { 'cloudflare:workers': stub },
}));

async function isValidBundle(file) {
  let bytes;
  try { bytes = await fs.readFile(file); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  const newline = bytes.indexOf(10);
  const header = bytes.subarray(0, newline).toString('utf8');
  const match = /^\/\/ j1-worker-fixture ([a-f0-9]{64}) ([a-f0-9]{64})$/.exec(header);
  return match?.[1] === key && match[2] === sha256(bytes.subarray(newline + 1));
}

/** Cache only the immutable pre-J1 Worker, never current mutation inputs. */
export async function prepareJ1WorkerFixture({
  root = process.cwd(),
  repository = process.env.JEV_COMPATIBILITY_BASE_REPO ?? root,
  cacheDirectory = path.join(root, '.cache/j1-worker-fixtures'),
} = {}) {
  await fs.mkdir(cacheDirectory, { recursive: true });
  const destination = path.join(cacheDirectory, `${key}.mjs`);
  if (await isValidBundle(destination)) return destination;

  const staging = await fs.mkdtemp(path.join(cacheDirectory, '.build-'));
  try {
    // Stryker's cwd is a nested sandbox: git archive pathspecs would otherwise
    // be relative to that prefix, even when the historical commit is available.
    // An explicit Git directory also supports read-only object-store overrides
    // with no work tree, and prevents archive from inheriting the cwd prefix.
    const gitDirectory = execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
      cwd: repository, encoding: 'utf8',
    }).trim();
    execFileSync('tar', ['-x', '-C', staging], {
      input: execFileSync('git', [
        `--git-dir=${gitDirectory}`, 'archive', J1_COMPATIBILITY_COMMIT, 'workers/ai-proxy/src', 'shared',
      ], { cwd: repository, maxBuffer: 32 * 1024 * 1024 }),
    });
    const result = await build({
      ...options, entryPoints: [path.join(staging, source)], write: false,
      alias: { 'cloudflare:workers': path.join(staging, stub) },
    });
    const bytes = result.outputFiles[0].contents;
    const publication = path.join(staging, 'worker-bundle.mjs');
    await fs.writeFile(publication, Buffer.concat([
      Buffer.from(`// j1-worker-fixture ${key} ${sha256(bytes)}\n`), bytes,
    ]));
    // Same-filesystem rename publishes a complete, self-validating file. Other
    // builders can replace it only with another complete immutable bundle.
    await fs.rename(publication, destination);
    return destination;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
