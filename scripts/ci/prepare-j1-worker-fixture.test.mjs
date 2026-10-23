import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { J1_COMPATIBILITY_COMMIT, J1_WORKER_BUILD_OPTIONS, prepareJ1WorkerFixture } from './prepare-j1-worker-fixture.mjs';

const roots = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture() {
  const base = path.join(process.cwd(), '.cache');
  await fs.mkdir(base, { recursive: true });
  const cacheDirectory = await fs.mkdtemp(path.join(base, 'j1-fixture-regression-'));
  roots.push(cacheDirectory);
  return { cacheDirectory, repository: process.env.JEV_COMPATIBILITY_BASE_REPO ?? process.cwd() };
}
function validate(bytes) {
  const newline = bytes.indexOf(10);
  const header = bytes.subarray(0, newline).toString('utf8');
  const digest = createHash('sha256').update(bytes.subarray(newline + 1)).digest('hex');
  expect(header).toMatch(new RegExp(`^// j1-worker-fixture [a-f0-9]{64} ${digest}$`));
}

describe('immutable pre-J1 Worker fixture publication', () => {
  it('accepts a read-only Git object directory without requiring a work tree', async () => {
    const settings = await fixture();
    const repository = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: settings.repository, encoding: 'utf8',
    }).trim();
    const file = await prepareJ1WorkerFixture({ ...settings, repository });
    validate(await fs.readFile(file));
    const module = await import(/* @vite-ignore */ pathToFileURL(file).href);
    expect(module.default.fetch).toBeTypeOf('function');
  });

  it('archives repository-root paths from a nested sandbox directory', async () => {
    const settings = await fixture();
    const file = await prepareJ1WorkerFixture({
      root: settings.cacheDirectory,
      repository: settings.cacheDirectory,
      cacheDirectory: path.join(settings.cacheDirectory, 'bundles'),
    });
    validate(await fs.readFile(file));
    const module = await import(/* @vite-ignore */ pathToFileURL(file).href);
    expect(module.default.fetch).toBeTypeOf('function');
  });

  it('matches the current ambient compiler output and ignores later ambient config changes', async () => {
    const settings = await fixture();
    const staging = settings.cacheDirectory;
    execFileSync('tar', ['-x', '-C', staging], { input: execFileSync('git', [
      'archive', J1_COMPATIBILITY_COMMIT, 'workers/ai-proxy/src', 'shared',
    ], { cwd: settings.repository, maxBuffer: 32 * 1024 * 1024 }) });
    const tsconfig = JSON.parse(await fs.readFile(new URL('../../tsconfig.json', import.meta.url), 'utf8'));
    const configPath = path.join(staging, 'tsconfig.json');
    await fs.writeFile(configPath, JSON.stringify(tsconfig));
    const inputs = {
      entryPoints: [path.join(staging, 'workers/ai-proxy/src/worker.ts')], write: false,
      alias: { 'cloudflare:workers': path.join(staging, 'workers/ai-proxy/src/cloudflareWorkersVitestStub.ts') },
    };
    const ambientOptions = { ...J1_WORKER_BUILD_OPTIONS };
    delete ambientOptions.tsconfigRaw;
    const compile = async options => Buffer.from((await build({ ...options, ...inputs })).outputFiles[0].contents);
    const explicit = await compile(J1_WORKER_BUILD_OPTIONS);
    expect((await compile(ambientOptions)).equals(explicit)).toBe(true);
    tsconfig.compilerOptions.useDefineForClassFields = false;
    await fs.writeFile(configPath, JSON.stringify(tsconfig));
    // Negative control: the ambient setting really changes this Worker bundle.
    expect((await compile(ambientOptions)).equals(explicit)).toBe(false);
    expect((await compile(J1_WORKER_BUILD_OPTIONS)).equals(explicit)).toBe(true);
  });

  it('publishes complete bundles for two concurrent setups and reuses the valid result', async () => {
    const settings = await fixture();
    const results = await Promise.all([0, 1].map(async () => {
      const file = await prepareJ1WorkerFixture(settings);
      validate(await fs.readFile(file));
      // Import immediately while the other builder may still be publishing.
      const module = await import(/* @vite-ignore */ pathToFileURL(file).href);
      expect(module.default.fetch).toBeTypeOf('function');
      return file;
    }));
    expect(results[0]).toBe(results[1]);
    expect(await fs.readdir(settings.cacheDirectory)).toEqual([path.basename(results[0])]);
    // A cache hit must not consult Git or rebuild; missing Git is intentional.
    const cached = await prepareJ1WorkerFixture({ ...settings, repository: path.join(settings.cacheDirectory, 'missing-repo') });
    expect(cached).toBe(results[0]);
    expect(J1_COMPATIBILITY_COMMIT).toBe('070d25cbe14796aebb8168ac5425c93e3506df1c');
  });

  it('rebuilds a corrupt cached result rather than importing partial output', async () => {
    const settings = await fixture();
    const file = await prepareJ1WorkerFixture(settings);
    await fs.writeFile(file, 'partial output');
    expect(await prepareJ1WorkerFixture(settings)).toBe(file);
    validate(await fs.readFile(file));
    expect(await fs.readdir(settings.cacheDirectory)).toEqual([path.basename(file)]);
  });

  it('fails closed when the immutable source cannot be read', async () => {
    const settings = await fixture();
    await expect(prepareJ1WorkerFixture({ ...settings, repository: path.join(settings.cacheDirectory, 'missing-repo') })).rejects.toThrow();
    expect(await fs.readdir(settings.cacheDirectory)).toEqual([]);
  });
});
