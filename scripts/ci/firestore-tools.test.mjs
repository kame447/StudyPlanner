import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const directories = [];
function fixture(cliSource) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'firestore-tools-test-'));
  directories.push(directory);
  const launcher = path.join(directory, 'scripts/ci/firestore-tools.mjs');
  fs.mkdirSync(path.dirname(launcher), { recursive: true });
  fs.copyFileSync(new URL('./firestore-tools.mjs', import.meta.url), launcher);
  if (cliSource) {
    const cli = path.join(directory, 'tools/firebase-tools/node_modules/firebase-tools/lib/bin/firebase.js');
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.writeFileSync(cli, cliSource);
  }
  return (...args) => spawnSync(process.execPath, [launcher, ...args], { encoding: 'utf8' });
}

describe('locked Firestore CLI launcher', () => {
  afterEach(() => {
    for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
  });

  it('fails with the locked installation command when the CLI is missing', () => {
    const result = fixture()('--version');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('npm ci --prefix tools/firebase-tools --ignore-scripts');
  });

  it('passes literal arguments to the installed CLI without shell interpretation', () => {
    const result = fixture('console.log(JSON.stringify(process.argv.slice(2)))')('emulators:exec', 'space and $literal; text');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(['emulators:exec', 'space and $literal; text']);
  });

  it('preserves a failing CLI exit status', () => {
    const result = fixture('process.exitCode = 17;')();
    expect(result.status).toBe(17);
  });
});
