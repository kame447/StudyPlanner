import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { captureSlots, captureCase } from '../../tests/e2e/support/wpe-capture-diagnostic.mjs';

export const diagnosticPushBase = '0c0f0071a83ebf2755a9b1689bbad007497b1f86';
export const artifactLimit = 1024 ** 3;
const config = 'tests/e2e/playwright.wpe-capture-diagnostic.config.mjs';
const outputRelative = 'artifacts/wpe-capture-diagnostic';
const cli = 'tests/e2e/node_modules/@playwright/test/cli.js';
const args = ['test', `--config=${config}`, '--project=webkit-mobile'];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
function command(root, command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 ** 2 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command}: ${result.stderr}`);
  return result.stdout.trim();
}
export function admitEnvironment(env) {
  assert.equal(env.CI, 'true');
  if (env.GITHUB_EVENT_NAME === 'push') {
    assert.equal(env.DIAGNOSTIC_PUSH_BEFORE, diagnosticPushBase, 'Only the one approved successor push');
    assert.equal(env.DIAGNOSTIC_PUSH_FORCED, 'false', 'No forced push');
    assert.equal(env.DIAGNOSTIC_PUSH_DELETED, 'false', 'No deleted branch');
  } else assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(env.GITHUB_REPOSITORY, 'kame447/StudyPlanner');
  assert.equal(env.GITHUB_REF, 'refs/heads/test/wpe-recording-diagnostic-local', 'Isolated branch only');
  assert.equal(env.DIAGNOSTIC_VISIBILITY, 'public');
  assert.equal(env.GITHUB_RUN_ATTEMPT, '1', 'Workflow reruns are not part of this bounded block');
  assert.match(env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/);
  assert.equal(env.UI_SPEC ?? '', '', 'Do not combine diagnostic mode with a spec override');
  assert.ok(!env.PW_TEST_REUSE_CONTEXT && !env.PWTEST_REUSE_CONTEXT && !env.PWDEBUG,
    'Context reuse/debug overrides invalidate the comparison');
}
export function validateCollection(report, slot) {
  assert.deepEqual(report.errors, []);
  const tests = [];
  const visit = (suite, ancestors = []) => {
    const titles = [...ancestors, suite.title];
    for (const spec of suite.specs ?? []) for (const test of spec.tests ?? [])
      tests.push({ spec, test, title: [...titles, spec.title].join(' ') });
    for (const child of suite.suites ?? []) visit(child, titles);
  };
  for (const suite of report.suites ?? []) visit(suite);
  assert.equal(tests.length, 1, 'Each slot must collect the one original contract');
  const { spec, test, title } = tests[0];
  assert.ok(captureCase.test(title));
  assert.equal(spec.file, 'bookshelf-surface.spec.mjs');
  assert.equal(test.timeout, 30000);
  assert.equal(test.expectedStatus, 'passed');
  assert.ok(typeof spec.id === 'string' && spec.id.length > 0);
  assert.equal(test.projectName, 'webkit-mobile');
  assert.deepEqual(test.results, []);
  const c = report.config, p = c.projects[0];
  assert.equal(c.projects.length, 1); assert.equal(c.workers, 1);
  assert.equal(c.forbidOnly, true); assert.equal(c.failOnFlakyTests, true);
  assert.equal(p.timeout, 30000); assert.equal(p.retries, 1); assert.equal(p.repeatEach, 1);
  assert.equal(c.metadata.wpeCaptureDiagnostic.slot, slot);
  return spec.id;
}
export function filesUnder(root) {
  assert.ok(fs.lstatSync(root).isDirectory(), 'Root must be a real directory');
  const files = [];
  const visit = dir => {
    for (const entry of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, entry), stat = fs.lstatSync(file);
      assert.ok(!stat.isSymbolicLink(), `Refuse artifact/build symlink: ${file}`);
      if (stat.isDirectory()) visit(file);
      else { assert.ok(stat.isFile(), `Not a regular file: ${file}`); files.push(file); }
    }
  };
  visit(root); return files;
}
function inputIdentity(root) {
  assert.equal(command(root, 'git', ['status', '--porcelain', '--untracked-files=no']), '', 'Tracked input drift');
  const dist = path.join(root, 'dist');
  const build = filesUnder(dist).map(file => [path.relative(dist, file), sha(fs.readFileSync(file))]);
  assert.ok(build.length > 0, 'A single completed production build is required');
  return { commit: command(root, 'git', ['rev-parse', 'HEAD']),
    tree: command(root, 'git', ['rev-parse', 'HEAD^{tree}']),
    buildSha256: sha(JSON.stringify(build)), buildFiles: build,
    runnerPackageSha256: sha(fs.readFileSync(path.join(root, 'tests/e2e/node_modules/playwright-core/package.json'))),
    node: process.version, platform: process.platform, arch: process.arch, kernel: os.release() };
}
export async function runSlots(slots, run, record) {
  const outcomes = [];
  for (const slot of slots) {
    // Nonzero original outcomes are evidence, not a reason to omit the next arm.
    const result = await run(slot);
    outcomes.push({ slot, ...result });
    record(outcomes);
  }
  return outcomes;
}
async function launch(root, slot, output) {
  const log = fs.createWriteStream(path.join(output, `${slot}.log`));
  const start = Date.now();
  return new Promise(resolve => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: root,
      env: { ...process.env, LAPLANS_CAPTURE_DIAGNOSTIC_SLOT: slot }, stdio: ['ignore', 'pipe', 'pipe'] });
    let error;
    child.stdout.on('data', bytes => { process.stdout.write(bytes); log.write(bytes); });
    child.stderr.on('data', bytes => { process.stderr.write(bytes); log.write(bytes); });
    child.on('error', value => { error = String(value); });
    child.on('close', (code, signal) => log.end(() => resolve({ code, signal, error,
      startedAt: new Date(start).toISOString(), elapsedMs: Date.now() - start })));
  });
}
export async function runBlock(root) {
  admitEnvironment(process.env);
  const output = path.join(root, outputRelative);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  // Never overwrite a prior block or silently resume a partial comparison.
  fs.mkdirSync(output);
  const initial = inputIdentity(root);
  assert.equal(initial.commit, process.env.GITHUB_SHA);
  const manifest = { schema: 1, purpose: 'Independent capture diagnostic, not ordinary acceptance',
    input: initial, runId: process.env.GITHUB_RUN_ID, runAttempt: 1,
    slots: captureSlots, completed: false, outcomes: [] };
  const save = () => json(path.join(output, 'block.json'), manifest);
  save();
  let identity;
  for (const slot of captureSlots) {
    const result = spawnSync(process.execPath, [cli, ...args, '--list', '--reporter=json'], {
      cwd: root, env: { ...process.env, LAPLANS_CAPTURE_DIAGNOSTIC_SLOT: slot },
      encoding: 'utf8', maxBuffer: 16 * 1024 ** 2,
    });
    fs.writeFileSync(path.join(output, `${slot}-collection.json`), result.stdout ?? '');
    fs.writeFileSync(path.join(output, `${slot}-collection.stderr`), result.stderr ?? '');
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `Collection failed for ${slot}`);
    const selected = validateCollection(JSON.parse(result.stdout), slot);
    if (identity !== undefined) assert.equal(selected, identity);
    identity = selected;
  }
  manifest.logicalIdentity = identity; save();
  await runSlots(captureSlots, async slot => {
    assert.deepEqual(inputIdentity(root), initial, 'Inputs changed between arms');
    return launch(root, slot, output);
  }, outcomes => { manifest.outcomes = outcomes; save(); });
  assert.deepEqual(inputIdentity(root), initial, 'Inputs changed during the block');
  manifest.completed = true; save();
  return manifest.outcomes.every(value => value.code === 0 && !value.signal && !value.error) ? 0 : 1;
}
export function validateBundleSize(bytes) {
  assert.ok(Number.isSafeInteger(bytes) && bytes > 0 && bytes <= artifactLimit - 1024 ** 2,
    'Complete bundle exceeds the1GiB upload budget; do not truncate');
}
function fileSha(file) {
  const hash = crypto.createHash('sha256'), buffer = Buffer.alloc(1024 ** 2), fd = fs.openSync(file, 'r');
  try { for (;;) { const n = fs.readSync(fd, buffer, 0, buffer.length, null); if (!n) break; hash.update(buffer.subarray(0, n)); } }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
export function packageArtifacts(root) {
  const output = path.join(root, outputRelative);
  assert.ok(fs.statSync(output).isDirectory());
  const files = filesUnder(output);
  assert.ok(files.length > 0, 'Missing diagnostic evidence');
  const bundle = path.join(root, 'artifacts/wpe-capture-diagnostic.tar.gz');
  assert.ok(!fs.existsSync(bundle), 'Do not replace an earlier artifact bundle');
  command(root, 'tar', ['-czf', bundle, '-C', path.join(root, 'artifacts'), 'wpe-capture-diagnostic']);
  const bytes = fs.statSync(bundle).size;
  // Upload exactly one archive; reserve1MiB for the artifact ZIP envelope.
  validateBundleSize(bytes);
  return { bytes, sha256: fileSha(bundle), files: files.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === 'run') process.exitCode = await runBlock(process.cwd());
    else if (process.argv[2] === 'package') {
      const result = packageArtifacts(process.cwd());
      process.stdout.write(`${JSON.stringify(result)}\n`);
      assert.ok(process.env.GITHUB_OUTPUT);
      fs.appendFileSync(process.env.GITHUB_OUTPUT, 'upload=true\n');
    } else throw new Error('Expected run or package');
  } catch (error) { console.error(error); process.exitCode = 1; }
}
