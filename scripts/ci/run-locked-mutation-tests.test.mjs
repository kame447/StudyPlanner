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
  for (const [name, version] of [['vitest', '3.2.7'], ['typescript', '5.9.3'], ['tinypool', '2.1.2']]) {
    const directory = path.join(root, 'node_modules', name);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version, exports: name === 'tinypool' ? { './package.json': './package.json' } : undefined }));
    packages['node_modules/' + name] = { version };
  }
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', overrides: { 'vitest@3.2.7': { tinypool: '2.1.2' } } }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages }));
  if (mode === 'root-shadowed-pool' || mode === 'root-unversioned-pool') {
    const nested = path.join(root, 'node_modules/vitest/node_modules/tinypool');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'package.json'), JSON.stringify({ name: 'tinypool', version: mode === 'root-unversioned-pool' ? undefined : '1.1.1', exports: { './package.json': './package.json' } }));
  }
  const fakeNpm = path.join(root, 'fake-npm.cjs');
  fs.writeFileSync(fakeNpm, `
    const fs = require('node:fs'), path = require('node:path');
    const args = process.argv.slice(2);
    const prefix = args[args.indexOf('--prefix') + 1];
    fs.writeFileSync('tool-prefix.txt', prefix);
    fs.writeFileSync('install-args.json', JSON.stringify(args));
    const manifest = JSON.parse(fs.readFileSync(path.join(prefix, 'package.json'), 'utf8'));
    fs.writeFileSync('isolated-manifest.json', JSON.stringify(manifest));
    if (process.env.FIXTURE_MODE === 'install-failure') process.exit(2);
    if (process.env.FIXTURE_MODE !== 'missing-pool') {
      const pool = path.join(prefix, 'node_modules/tinypool');
      fs.mkdirSync(pool, { recursive: true });
      const version = process.env.FIXTURE_MODE === 'wrong-pool' ? '1.1.1' : manifest.overrides['vitest@3.2.7'].tinypool;
      fs.writeFileSync(path.join(pool, 'package.json'), JSON.stringify({ name: 'tinypool', version, exports: { './package.json': './package.json' } }));
    }
    for (const name of ['vitest', 'typescript']) {
      const version = args.find(arg => arg.startsWith(name + '@')).slice(name.length + 1);
      const dir = path.join(prefix, 'node_modules', name);
      fs.mkdirSync(dir, {recursive:true});
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        name, version: process.env.FIXTURE_MODE === 'wrong-version' ? '0.0.0' : version
      }));
    }
    if (process.env.FIXTURE_MODE === 'shadowed-pool') {
      const nested = path.join(prefix, 'node_modules/vitest/node_modules/tinypool');
      fs.mkdirSync(nested, { recursive: true });
      fs.writeFileSync(path.join(nested, 'package.json'), JSON.stringify({ name: 'tinypool', version: '1.1.1', exports: { './package.json': './package.json' } }));
    }
    if (process.env.FIXTURE_MODE === 'install-root-shadow') {
      const nested = path.join(process.cwd(), 'node_modules/vitest/node_modules/tinypool');
      fs.mkdirSync(nested, { recursive: true });
      fs.writeFileSync(path.join(nested, 'package.json'), JSON.stringify({ name: 'tinypool', version: '1.1.1', exports: { './package.json': './package.json' } }));
    }
    if (process.env.FIXTURE_MODE === 'external-pool') {
      const nested = path.join(prefix, 'node_modules/vitest/node_modules');
      fs.mkdirSync(nested, { recursive: true });
      fs.symlinkSync(path.join(process.cwd(), 'node_modules/tinypool'), path.join(nested, 'tinypool'), 'dir');
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
  const prefixFile = path.join(root, 'tool-prefix.txt');
  const prefix = fs.existsSync(prefixFile) ? fs.readFileSync(prefixFile, 'utf8') : undefined;
  return { root, result, prefix };
}

describe('isolated mutation launcher integration', () => {
  it('passes exact application versions, preserves reports and cleans only its temporary tools', () => {
    const { root, result, prefix } = execute();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(root, 'install-args.json'), 'utf8')))
      .toEqual(expect.arrayContaining(['vitest@3.2.7', 'typescript@5.9.3', '@stryker-mutator/core@9.6.1']));
    expect(JSON.parse(fs.readFileSync(path.join(root, 'isolated-manifest.json'), 'utf8')).overrides).toEqual({ 'vitest@3.2.7': { tinypool: '2.1.2' } });
    expect(result.stdout).toContain('Isolated tinypool resolved from Vitest: 2.1.2');
    expect(fs.existsSync(prefix)).toBe(false);
    expect(fs.readFileSync(path.join(root, 'report.txt'), 'utf8')).toBe('retained');
    expect(JSON.parse(fs.readFileSync(path.join(root, 'node_modules/typescript/package.json'), 'utf8')).version).toBe('5.9.3');
  });
  it.each(['root-shadowed-pool', 'root-unversioned-pool'])('rejects %s before installing or executing tools', mode => {
    const { root, result, prefix } = execute(mode);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(mode === 'root-shadowed-pool' ? 'Root resolved tinypool is not locked' : 'Missing exact resolved tinypool version');
    expect(prefix).toBeUndefined();
    expect(fs.existsSync(path.join(root, 'report.txt'))).toBe(false);
  });
  it.each(['runner-failure', 'wrong-version', 'drift', 'wrong-pool', 'missing-pool', 'shadowed-pool', 'install-root-shadow', 'external-pool', 'install-failure'])('fails closed and cleans temporary tools after %s', mode => {
    const { root, result, prefix } = execute(mode);
    expect(result.status).not.toBe(0);
    expect(fs.existsSync(prefix)).toBe(false);
    if (mode === 'runner-failure') {
      expect(result.stderr).toContain('Mutation tool command failed: 3');
      expect(fs.existsSync(path.join(root, 'report.txt'))).toBe(true);
    } else if (mode === 'wrong-version') {
      expect(result.stderr).toContain('version mismatch');
      expect(fs.existsSync(path.join(root, 'report.txt'))).toBe(false);
    } else if (mode === 'drift') {
      expect(result.stderr).toContain('before=5.9.3, after=5.6.3');
    } else {
      const expected = {
        'wrong-pool': 'Isolated tinypool version mismatch',
        'missing-pool': "Cannot find module 'tinypool/package.json'",
        'shadowed-pool': 'Isolated tinypool version mismatch',
        'install-root-shadow': 'Root resolved tinypool is not locked or changed',
        'external-pool': 'Tinypool resolved outside the tool installation',
        'install-failure': 'Mutation tool command failed: 2',
      };
      expect(result.stderr).toContain(expected[mode]);
      expect(fs.existsSync(path.join(root, 'report.txt'))).toBe(false);
    }
  });
});
