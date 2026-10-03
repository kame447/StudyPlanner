import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { snapshotLockedToolchain, verifyLockedToolchain } from './locked-test-toolchain.mjs';

const roots = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'locked-toolchain-'));
  roots.push(root);
  const packages = {
    '': { name: 'fixture' },
    'node_modules/vitest': { version: '3.2.7' },
    'node_modules/typescript': { version: '5.9.3' },
    'node_modules/optional-other-platform': { version: '1.0.0', optional: true },
  };
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages }));
  write(root, 'vitest', '3.2.7');
  write(root, 'typescript', '5.9.3');
  return root;
}
function write(root, name, version) {
  const directory = path.join(root, 'node_modules', name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version }));
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('locked test toolchain guard', () => {
  it('allows added tools without changing the installed application versions', () => {
    const root = fixture();
    const snapshot = snapshotLockedToolchain(root);
    write(root, '@vitest/coverage-v8', '3.2.7');
    expect(verifyLockedToolchain(root, snapshot)).toBe(2);
  });
  it.each([['vitest', '3.2.4'], ['typescript', '5.6.3']])('detects a silent %s downgrade despite unchanged manifests', (name, version) => {
    const root = fixture();
    const snapshot = snapshotLockedToolchain(root);
    const lock = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8');
    write(root, name, version);
    expect(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')).toBe(lock);
    expect(() => verifyLockedToolchain(root, snapshot)).toThrow('after=' + version);
  });
  it('detects a removed installed dependency', () => {
    const root = fixture();
    const snapshot = snapshotLockedToolchain(root);
    fs.rmSync(path.join(root, 'node_modules/vitest'), { recursive: true });
    expect(() => verifyLockedToolchain(root, snapshot)).toThrow('disappeared');
  });
  it('rejects a baseline already inconsistent with the lock', () => {
    const root = fixture();
    write(root, 'vitest', '3.2.4');
    expect(() => snapshotLockedToolchain(root)).toThrow('lock=3.2.7');
  });
  it('ignores uninstalled optional platform packages but rejects an empty installation', () => {
    const root = fixture();
    expect(Object.keys(snapshotLockedToolchain(root).installed)).toHaveLength(2);
    fs.rmSync(path.join(root, 'node_modules'), { recursive: true });
    expect(() => snapshotLockedToolchain(root)).toThrow('run npm ci first');
  });
  it('rejects an incomplete initial installation', () => {
    const root = fixture();
    fs.rmSync(path.join(root, 'node_modules/typescript'), { recursive: true });
    expect(() => snapshotLockedToolchain(root)).toThrow('Required locked package missing');
  });
  it('rejects a malformed snapshot rather than reporting vacuous success', () => {
    expect(() => verifyLockedToolchain(fixture(), { version: 1, installed: {} })).toThrow('Invalid');
  });
});
