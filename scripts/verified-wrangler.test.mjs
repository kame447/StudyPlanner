import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PINNED_WRANGLER_VERSION } from './verified-wrangler.mjs';

const fixtures = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'verified-wrangler-'));
  fixtures.push(root);
  return root;
}
function installation(root, name, version = PINNED_WRANGLER_VERSION, cli = true) {
  const pkg = join(root, name);
  mkdirSync(join(pkg, 'bin'), { recursive: true });
  mkdirSync(join(pkg, 'wrangler-dist'));
  writeFileSync(join(pkg, 'bin/wrangler.js'), '');
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ version, type: 'module' }));
  if (cli) writeFileSync(join(pkg, 'wrangler-dist/cli.js'), `export const marker = ${JSON.stringify(name)};`);
  const path = join(root, `${name}-path`);
  mkdirSync(path);
  symlinkSync(join(pkg, 'bin/wrangler.js'), join(path, 'wrangler'));
  return { path, pkg };
}
function load(root, paths, purpose = 'remote evaluation', missingMessage = 'Wrangler is unavailable.') {
  // A real Node import isolates PATH and module caches without evaluating a provider.
  const source = `import { loadVerifiedWrangler } from ${JSON.stringify(new URL('./verified-wrangler.mjs', import.meta.url).href)};
  try { const result = await loadVerifiedWrangler(${JSON.stringify({ purpose, missingMessage })}); console.log(JSON.stringify({ marker: result.marker })); }
  catch (error) { console.log(JSON.stringify({ name: error.name, message: error.message, actual: error.actual, expected: error.expected })); }`;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: root, env: { ...process.env, PATH: paths.join(delimiter) }, encoding: 'utf8',
  }));
}
afterEach(() => { for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('verified Wrangler loader boundary', () => {
  it('follows the executable symlink and loads the exact pinned CLI, not the bin entry', () => {
    const root = fixture(); const supported = installation(root, 'supported');
    expect(load(root, [supported.path])).toEqual({ marker: 'supported' });
  });
  it('skips absent binaries and keeps PATH precedence among supported installations', () => {
    const root = fixture(); const first = installation(root, 'first'); const second = installation(root, 'second');
    expect(load(root, [join(root, 'absent'), first.path, second.path])).toEqual({ marker: 'first' });
  });
  it.each(['4.150.9', '4.151.1', '4.151.2', undefined])('fails closed on version %s before importing or trying a later candidate', (version) => {
    const root = fixture(); const rejected = installation(root, 'rejected', 'temporary', false);
    writeFileSync(join(rejected.pkg, 'package.json'), JSON.stringify({ version }));
    const supported = installation(root, 'supported');
    const error = load(root, [rejected.path, supported.path], 'contextual evaluation');
    expect(error.name).toBe('AssertionError');
    expect(error.actual).toBe(version);
    expect(error.expected).toBe(PINNED_WRANGLER_VERSION);
    // Node versions append their own actual/expected diff after the caller message.
    expect(error.message.split('\n')[0]).toBe(`Refusing contextual evaluation with Wrangler ${String(version)}; expected ${PINNED_WRANGLER_VERSION}.`);
  });
  it('does not hide malformed metadata by falling through to a later executable', () => {
    const root = fixture(); const broken = installation(root, 'broken'); const supported = installation(root, 'supported');
    writeFileSync(join(broken.pkg, 'package.json'), 'invalid-json');
    expect(load(root, [broken.path, supported.path]).name).toBe('SyntaxError');
  });
  it('propagates an unavailable CLI instead of falling back after pin acceptance', () => {
    const root = fixture(); const broken = installation(root, 'broken', PINNED_WRANGLER_VERSION, false);
    const supported = installation(root, 'supported');
    expect(load(root, [broken.path, supported.path]).message).toContain('Cannot find module');
  });
  it('retains the caller-specific missing-toolchain instruction', () => {
    const root = fixture();
    expect(load(root, [], 'remote smoke', 'Use the smoke runbook.')).toEqual({ name: 'Error', message: 'Use the smoke runbook.' });
  });
});
