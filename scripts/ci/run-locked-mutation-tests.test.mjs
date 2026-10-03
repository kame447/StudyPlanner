import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('./run-locked-mutation-tests.mjs', import.meta.url));
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function execute(mode = 'success') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-launcher-fixture-'));
  roots.push(root);
  const packages = {};
  for (const [name, version] of [['vitest', '3.2.7'], ['typescript', '5.9.3']]) {
    const directory = path.join(root, 'node_modules', name);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version }));
    packages['node_modules/' + name] = { version };
  }
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}');
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages }));
  const fakeNpm = path.join(root, 'fake-npm.cjs');
  fs.writeFileSync(fakeNpm, `
    const fs = require('node:fs'), path = require('node:path');
    const args = process.argv.slice(2);
    const prefix = args[args.indexOf('--prefix') + 1];
    fs.writeFileSync('tool-prefix.txt', prefix);
    fs.writeFileSync('install-args.json', JSON.stringify(args));
    for (const name of ['vitest', 'typescript']) {
      const version = args.find(arg => arg.startsWith(name + '@')).slice(name.length + 1);
      const dir = path.join(prefix, 'node_modules', name);
      fs.mkdirSync(dir, {recursive:true});
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        name, version: process.env.FIXTURE_MODE === 'wrong-version' ? '0.0.0' : version
      }));
    }
    const core = path.join(prefix, 'node_modules/@stryker-mutator/core');
    fs.mkdirSync(core, {recursive:true});
    fs.writeFileSync(path.join(core, 'package.json'), JSON.stringify({bin:{stryker:'run.cjs'}}));
    fs.writeFileSync(path.join(core, 'run.cjs'),
      "const fs=require('node:fs'); fs.writeFileSync('report.txt', 'retained');" +
      "if(process.env.FIXTURE_MODE==='drift') fs.writeFileSync('node_modules/typescript/package.json', JSON.stringify({version:'5.6.3'}));" +
      "if(process.env.FIXTURE_MODE==='runner-failure') process.exit(3);"
    );
  `);
  const result = spawnSync(process.execPath, [script, 'stryker.config.mjs'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, npm_execpath: fakeNpm, FIXTURE_MODE: mode },
  });
  const prefix = fs.readFileSync(path.join(root, 'tool-prefix.txt'), 'utf8');
  return { root, result, prefix };
}

describe('isolated mutation launcher integration', () => {
  it('passes exact application versions, preserves reports and cleans only its temporary tools', () => {
    const { root, result, prefix } = execute();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(root, 'install-args.json'), 'utf8')))
      .toEqual(expect.arrayContaining(['vitest@3.2.7', 'typescript@5.9.3', '@stryker-mutator/core@9.6.1']));
    expect(fs.existsSync(prefix)).toBe(false);
    expect(fs.readFileSync(path.join(root, 'report.txt'), 'utf8')).toBe('retained');
    expect(JSON.parse(fs.readFileSync(path.join(root, 'node_modules/typescript/package.json'), 'utf8')).version).toBe('5.9.3');
  });
  it.each(['runner-failure', 'wrong-version', 'drift'])('fails closed and cleans temporary tools after %s', mode => {
    const { root, result, prefix } = execute(mode);
    expect(result.status).not.toBe(0);
    expect(fs.existsSync(prefix)).toBe(false);
    if (mode === 'runner-failure') {
      expect(result.stderr).toContain('Mutation tool command failed: 3');
      expect(fs.existsSync(path.join(root, 'report.txt'))).toBe(true);
    } else if (mode === 'wrong-version') {
      expect(result.stderr).toContain('version mismatch');
      expect(fs.existsSync(path.join(root, 'report.txt'))).toBe(false);
    } else {
      expect(result.stderr).toContain('before=5.9.3, after=5.6.3');
    }
  });
});
