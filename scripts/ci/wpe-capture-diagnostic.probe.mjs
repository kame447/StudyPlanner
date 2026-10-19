import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { admitEnvironment, validateCollection, filesUnder, runSlots, artifactLimit,
  validateBundleSize, packageArtifacts, runBlock } from './wpe-capture-diagnostic.mjs';
import { captureSlots } from '../../tests/e2e/support/wpe-capture-diagnostic.mjs';
const roots = [];
const root = () => { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-probe-')); roots.push(p); return p; };
afterEach(() => { for (const p of roots.splice(0)) fs.rmSync(p, { recursive: true, force: true }); });
const env = { CI: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: 'kame447/StudyPlanner',
  GITHUB_REF: 'refs/heads/test/wpe-recording-diagnostic-local', DIAGNOSTIC_VISIBILITY: 'public', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'a'.repeat(40) };
function listing(slot = 'capture-on-1') {
  return { errors: [], config: { workers: 1, forbidOnly: true, failOnFlakyTests: true,
    metadata: { wpeCaptureDiagnostic: { slot } }, projects: [{ timeout: 30000, retries: 1, repeatEach: 1 }] },
  suites: [{ title: 'bookshelf-surface.spec.mjs', suites: [{ title: 'material long text 1920x1080',
    specs: [{ title: 'keeps full detail text and cancels unsaved chapter edits at 200%',
      id: 'original-identity', file: 'bookshelf-surface.spec.mjs', tests: [{ timeout: 30000,
        projectName: 'webkit-mobile', expectedStatus: 'passed', results: [] }] }] }] }] };
}
test('only the approved first manual block on the public repository is admitted', () => {
  admitEnvironment(env);
  for (const change of [{ CI: '1' }, { GITHUB_EVENT_NAME: 'push' }, { GITHUB_REPOSITORY: 'another/repo' },
    { DIAGNOSTIC_VISIBILITY: 'private' }, { GITHUB_RUN_ATTEMPT: '2' }, { GITHUB_SHA: 'main' },
    { GITHUB_REF: 'refs/heads/main' }, { GITHUB_REF: 'refs/heads/other' },
    { UI_SPEC: 'bookshelf-surface.spec.mjs' }, { PW_TEST_REUSE_CONTEXT: '1' }, { PWTEST_REUSE_CONTEXT: '1' }, { PWDEBUG: '1' }])
    assert.throws(() => admitEnvironment({ ...env, ...change }));
});
test('collection admits only the original full contract and preserved deadline/policy', () => {
  assert.equal(validateCollection(listing(), 'capture-on-1'), 'original-identity');
  const mutations = [d => d.errors.push({ message: 'load failed' }), d => d.suites.push(d.suites[0]),
    d => d.config.workers = 2, d => d.config.projects[0].timeout = 60000,
    d => d.config.projects[0].retries = 0, d => d.config.projects[0].repeatEach = 2,
    d => d.config.metadata.wpeCaptureDiagnostic.slot = 'capture-off-2',
    d => d.suites[0].suites[0].title = 'material long text 390x844',
    d => d.suites[0].suites[0].specs[0].tests[0].results.push({ status: 'passed' })];
  for (const mutate of mutations) { const data = listing(); mutate(data); assert.throws(() => validateCollection(data, 'capture-on-1')); }
});
test('ABBA runs all four exactly once and keeps failures, signals and partial checkpoints', async () => {
  const calls = [], records = [];
  const results = [{ code: 1 }, { code: 0 }, { code: null, signal: 'SIGTERM' }, { code: 0 }];
  const actual = await runSlots(captureSlots, async slot => { calls.push(slot); return results[calls.length - 1]; },
    outcomes => records.push(structuredClone(outcomes)));
  assert.deepEqual(calls, captureSlots); assert.deepEqual(records.map(x => x.length), [1, 2, 3, 4]);
  assert.deepEqual(actual, captureSlots.map((slot, i) => ({ slot, ...results[i] })));
});
test('input-admission exceptions stop without replay and retain previous checkpoints', async () => {
  const calls = [], checkpoints = [];
  await assert.rejects(runSlots(captureSlots, async slot => {
    calls.push(slot); if (calls.length === 2) throw new Error('input drift'); return { code: 1 };
  }, outcomes => checkpoints.push(structuredClone(outcomes))), /input drift/);
  assert.equal(calls.length, 2); assert.equal(checkpoints.length, 1);
});
test('artifact traversal rejects both root and nested symlinks', () => {
  const p = root(); fs.mkdirSync(path.join(p, 'real')); fs.writeFileSync(path.join(p, 'real', 'ok'), 'ok');
  fs.symlinkSync(path.join(p, 'real'), path.join(p, 'alias'));
  assert.throws(() => filesUnder(path.join(p, 'alias')), /real directory/);
  assert.throws(() => filesUnder(p), /symlink/);
});
test('artifact budget reserves ZIP envelope room and cannot silently truncate', () => {
  validateBundleSize(artifactLimit - 1024 ** 2);
  for (const n of [0, -1, Infinity, 0.5, artifactLimit - 1024 ** 2 + 1, artifactLimit])
    assert.throws(() => validateBundleSize(n), /budget/);
});
test('packaging retains complete evidence and refuses overwriting a prior bundle', () => {
  const p = root(), output = path.join(p, 'artifacts/wpe-capture-diagnostic'); fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'partial.json'), '{"complete":false}');
  const result = packageArtifacts(p);
  assert.equal(result.files, 1); assert.ok(result.bytes > 0); assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.ok(fs.existsSync(path.join(output, 'partial.json')));
  assert.throws(() => packageArtifacts(p), /earlier artifact/);
});

test('the real block orchestrator launches four fresh child processes and preserves failed outcomes', async () => {
  const p = root();
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: p, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  };
  git('init', '-q'); fs.writeFileSync(path.join(p, 'tracked.txt'), 'frozen source');
  git('add', 'tracked.txt'); git('-c', 'user.name=Local Probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'fixture');
  fs.mkdirSync(path.join(p, 'dist')); fs.writeFileSync(path.join(p, 'dist/index.html'), 'one build');
  fs.mkdirSync(path.join(p, 'tests/e2e/node_modules/playwright-core'), { recursive: true });
  fs.writeFileSync(path.join(p, 'tests/e2e/node_modules/playwright-core/package.json'), '{"version":"1.64.0"}');
  const mock = path.join(p, 'tests/e2e/node_modules/@playwright/test'); fs.mkdirSync(mock, { recursive: true });
  fs.writeFileSync(path.join(mock, 'cli.js'), `const fs=require('node:fs');
const slot=process.env.LAPLANS_CAPTURE_DIAGNOSTIC_SLOT;
const report=${JSON.stringify(listing())};report.config.metadata.wpeCaptureDiagnostic.slot=slot;
if(process.argv.includes('--list'))process.stdout.write(JSON.stringify(report));
else{fs.appendFileSync('calls.jsonl',JSON.stringify({slot,pid:process.pid,args:process.argv.slice(2)})+'\\n');
 console.log(slot);process.exit(slot==='capture-on-1'?1:0);}`);
  const before = { ...process.env };
  try {
    Object.assign(process.env, env, { GITHUB_SHA: git('rev-parse', 'HEAD'), GITHUB_RUN_ID: 'local-mock' });
    assert.equal(await runBlock(p), 1);
    const calls = fs.readFileSync(path.join(p, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls.map(x => x.slot), captureSlots); assert.equal(new Set(calls.map(x => x.pid)).size, 4);
    for (const call of calls) assert.deepEqual(call.args, ['test', '--config=tests/e2e/playwright.wpe-capture-diagnostic.config.mjs', '--project=webkit-mobile']);
    const record = JSON.parse(fs.readFileSync(path.join(p, 'artifacts/wpe-capture-diagnostic/block.json')));
    assert.equal(record.completed, true); assert.deepEqual(record.outcomes.map(x => x.code), [1, 0, 0, 0]);
    assert.equal(record.input.commit, process.env.GITHUB_SHA);
    assert.equal(record.logicalIdentity, 'original-identity');
    await assert.rejects(runBlock(p), /EEXIST/);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
  }
});
