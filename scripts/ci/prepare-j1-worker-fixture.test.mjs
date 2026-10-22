import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { J1_COMPATIBILITY_COMMIT, prepareJ1WorkerFixture } from './prepare-j1-worker-fixture.mjs';

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
