import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const workflows = fs.readdirSync(new URL('.github/workflows/', root))
  .filter(name => /\.ya?ml$/.test(name));

describe('repository Node security pin', () => {
  it('pins the patched Node 22 release rather than a cached major range', () => {
    expect(read('.node-version').trim()).toBe('22.23.4');
  });

  it.each(workflows)('%s uses the canonical exact runtime for every setup-node step', name => {
    const source = read(`.github/workflows/${name}`);
    const steps = source.split(/^\s*- /m).filter(step => /uses: actions\/setup-node@/.test(step));
    for (const step of steps) {
      expect(step).toMatch(/^\s+node-version-file: \.node-version\s*$/m);
      expect(step).not.toMatch(/^\s+node-version:/m);
    }
  });
});

const { isPatchedNodeVersion, patchedNodeMinimums } = await import('./check-node-security-version.mjs');

describe('actual Node runtime security gate', () => {
  it('imports without CLI side effects and executes explicitly against the actual runtime', () => {
    const script = new URL('./check-node-security-version.mjs', import.meta.url);
    const imported = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(script.href)})`], { encoding: 'utf8' });
    expect(imported.status).toBe(0);
    expect(imported.stdout).toBe('');
    const executed = spawnSync(process.execPath, [fileURLToPath(script)], { encoding: 'utf8' });
    expect(executed.status).toBe(isPatchedNodeVersion(process.versions.node) ? 0 : 1);
    if (!isPatchedNodeVersion(process.versions.node)) expect(executed.stderr).toContain('Upgrade to the .node-version release');
  });
  it.each(['22.23.0', '22.23.3', '22.22.99', '24.19.0', '24.22.0', '26.12.0', '20.99.99', '23.99.99', '25.99.99', '27.0.0', '22.23.4-rc.1', 'garbage'])('rejects %s', version => {
    expect(isPatchedNodeVersion(version)).toBe(false);
  });
  it.each(['22.23.4', 'v22.23.4', '22.23.5', '22.24.0', '24.22.1', '24.23.0', '26.12.1', '26.13.0'])('accepts patched %s', version => {
    expect(isPatchedNodeVersion(version)).toBe(true);
  });
  it('keeps package and lock engine declarations aligned with the supported security floors', () => {
    const manifest = JSON.parse(read('package.json'));
    const expected = Object.entries(patchedNodeMinimums).map(([major, rest]) => `^${major}.${rest.join('.')}`).join(' || ');
    expect(manifest.engines.node).toBe(expected);
    expect(JSON.parse(read('package-lock.json')).packages[''].engines.node).toBe(expected);
    expect(manifest.scripts['check:node']).toBe('node scripts/ci/check-node-security-version.mjs');
    expect(manifest.scripts.verify).toMatch(/^npm run check:node && /);
    expect(manifest.scripts.prebuild).toBe('npm run check:node');
  });
});
