import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runPlaywright, validateShard } from './playwright-shard.mjs';

const roots = [];
afterEach(() => { while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true }); });

function fixture(listing, { listingStatus = 0, runStatus = 0 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'playwright-shard-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'tests/e2e/node_modules/.bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'listing.json'), typeof listing === 'string' ? listing : JSON.stringify(listing));
  fs.writeFileSync(path.join(root, 'tests/e2e/node_modules/.bin/playwright'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync('calls.jsonl', JSON.stringify(args) + '\\n');
if (args.includes('--list')) {
  process.stdout.write(fs.readFileSync('listing.json'));
  process.exit(${listingStatus});
}
process.exit(${runStatus});
`, { mode: 0o755 });
  return { root, calls: () => fs.existsSync(path.join(root, 'calls.jsonl'))
    ? fs.readFileSync(path.join(root, 'calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [] };
}

const valid = { suites: [{ suites: [{ specs: [{ tests: [{}] }] }] }], errors: [] };
const args = ['test', '--config=tests/e2e/playwright.cross-browser.config.mjs', '--project=webkit-mobile', '--shard=2/2'];

describe('shared Playwright shard preflight', () => {
  it('accepts only canonical positive i/n values in range', () => {
    for (const shard of [undefined, '1/2', '2/2', '1/1']) expect(() => validateShard(shard)).not.toThrow();
    for (const shard of ['', '0/2', '1/0', '3/2', '01/2', '1/02', '1', '1/2/3', '1.5/2', '-1/2', ' 1/2', '1/2\n', '--shard=1/2', null, 1]) {
      expect(() => validateShard(shard, 'UI_REGRESSION_SHARD'), String(shard)).toThrow('Invalid UI_REGRESSION_SHARD');
    }
  });

  it('lists the exact selection first and propagates the real run exit status', () => {
    const f = fixture(valid, { runStatus: 17 });
    expect(runPlaywright(f.root, args)).toBe(17);
    expect(f.calls()).toEqual([[...args, '--list', '--reporter=json'], args]);
  });

  it.each([
    { suites: [], errors: [] },
    { suites: [{ specs: [{ tests: [] }] }], errors: [] },
    { ...valid, errors: [{ message: 'load error' }] },
    { suites: valid.suites },
    { errors: [] },
    '{malformed',
  ])('never launches browsers for an empty, erroneous or malformed listing: %j', listing => {
    const f = fixture(listing);
    expect(() => runPlaywright(f.root, args)).toThrow();
    expect(f.calls()).toEqual([[...args, '--list', '--reporter=json']]);
  });

  it('propagates a listing failure before launching browsers', () => {
    const f = fixture(valid, { listingStatus: 23 });
    expect(runPlaywright(f.root, args)).toBe(23);
    expect(f.calls()).toHaveLength(1);
  });

  it.each(['--shard=', '--shard=3/2', '--shard=1/2\n', '--shard'])('rejects an invalid shard before invoking Playwright: %s', shard => {
    const f = fixture(valid);
    expect(() => runPlaywright(f.root, [...args.slice(0, -1), shard])).toThrow();
    expect(f.calls()).toEqual([]);
  });

  it('rejects duplicate shard arguments', () => {
    const f = fixture(valid);
    expect(() => runPlaywright(f.root, [...args, '--shard=1/2'])).toThrow();
    expect(f.calls()).toEqual([]);
  });

  it('preserves unsharded execution without running a listing', () => {
    const f = fixture({ suites: [], errors: [] }, { runStatus: 19 });
    expect(runPlaywright(f.root, args.slice(0, -1))).toBe(19);
    expect(f.calls()).toEqual([args.slice(0, -1)]);
  });
});
