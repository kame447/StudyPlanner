import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
const root = process.cwd();
const out = 'artifacts/grid';
fs.mkdirSync(out, { recursive: true });
const write = (file, value) => fs.writeFileSync(`${out}/${file}`, JSON.stringify(value, null, 2));
const base = (await import(pathToFileURL(path.resolve('tests/e2e/playwright.cross-browser.config.mjs')))).default;
const off = { ...base, use: { ...base.use, video: 'off', trace: 'off' }, projects: base.projects.map(project => project.name === 'webkit-mobile' ? { ...project, testMatch: ['**/bookshelf-grid-diagnostic.spec.mjs'] } : project) };
const restored = { ...off, use: { ...off.use, video: base.use.video, trace: base.use.trace }, projects: base.projects };
if (!isDeepStrictEqual(restored, base) || base.retries !== 1 || base.workers !== 1 || !base.failOnFlakyTests) throw new Error('Unexpected baseline');
fs.writeFileSync('tests/e2e/playwright.grid-diagnostic.config.mjs', "import base from './playwright.cross-browser.config.mjs';\nexport default { ...base, use: { ...base.use, video: 'off', trace: 'off' }, projects: base.projects.map(project => project.name === 'webkit-mobile' ? { ...project, testMatch: ['**/bookshelf-grid-diagnostic.spec.mjs'] } : project) };\n");
const generatedOff = (await import(pathToFileURL(path.resolve('tests/e2e/playwright.grid-diagnostic.config.mjs')))).default;
if (!isDeepStrictEqual(generatedOff, off)) throw new Error('Unexpected generated config');
const originalSpec = fs.readFileSync('tests/e2e/bookshelf-surface.spec.mjs', 'utf8');
let spec = originalSpec;
const replacements = [
  ["import { expect, test } from './support/fixed-clock.mjs';", "import { expect, test, captureGridProof } from './support/grid-diagnostic.mjs';"],
  ["await expect(page.locator('.bookshelf-view')).toBeVisible();", "await expect(page.locator('.bookshelf-view')).toBeVisible();\n  await captureGridProof(page, null, 'bookshelf');"],
  ["await testInfo.attach(`material-detail-${name}`, { body: await page.screenshot({ scale: 'css', animations: 'disabled' }), contentType: 'image/png' });", "await testInfo.attach(`material-detail-${name}`, { body: await page.screenshot({ scale: 'css', animations: 'disabled' }), contentType: 'image/png' });\n          await captureGridProof(page, testInfo, 'detail');"],
  ["await testInfo.attach(`material-editor-${name}`, { body: await page.screenshot({ scale: 'css', animations: 'disabled' }), contentType: 'image/png' });", "await testInfo.attach(`material-editor-${name}`, { body: await page.screenshot({ scale: 'css', animations: 'disabled' }), contentType: 'image/png' });\n          await captureGridProof(page, testInfo, 'editor');"],
];
for (const [from, to] of replacements) { if (spec.split(from).length !== 2) throw new Error('Unexpected diagnostic insertion point'); spec = spec.replace(from, to); }
let restoredSpec = spec;
for (const [from, to] of [...replacements].reverse()) restoredSpec = restoredSpec.replace(to, from);
if (restoredSpec !== originalSpec) throw new Error('Original behavioral spec changed');
fs.writeFileSync('tests/e2e/bookshelf-grid-diagnostic.spec.mjs', spec);
write('spec-proof.json', { originalSha256: createHash('sha256').update(originalSpec).digest('hex'), diagnosticSha256: createHash('sha256').update(spec).digest('hex'), reversibleInstrumentationOnly: true });
const tracked = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
if (tracked.status !== 0) throw new Error('Cannot enumerate source inputs');
const files = tracked.stdout.split('\0').filter(Boolean);
const snapshot = () => Object.fromEntries(files.map(file => [file, createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const before = snapshot();
write('source-before.json', before);
const diagnosticPaths = ['.github/workflows/diagnose-pr833-mobile-three.yml', 'scripts/ci/mobile-grid-diagnostic.mjs', 'tests/e2e/support/grid-diagnostic.mjs'];
const frozenManifest = Object.fromEntries(Object.entries(before).filter(([file]) => !diagnosticPaths.includes(file)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
const frozenManifestSha256 = createHash('sha256').update(JSON.stringify(frozenManifest)).digest('hex');
if (frozenManifestSha256 !== 'e78f86e563443d5fc6254350b1140ce46ce021d37dc5131c7ea4f34f7adb2ba0') throw new Error('Frozen PR833 source manifest mismatch');
write('frozen-source-proof.json', { frozenCommit: '4c1c93ce0dec91fdec30644ee1575e2c9c2ed62d', frozenManifestSha256, files: Object.keys(frozenManifest).length, excludedDiagnosticPaths: diagnosticPaths });

write('host.json', { cpuModels: [...new Set(os.cpus().map(cpu => cpu.model))], logicalCpuCount: os.cpus().length,
  availableParallelism: os.availableParallelism(), arch: os.arch(), platform: os.platform(), release: os.release(),
  imageOS: process.env.ImageOS ?? null, imageVersion: process.env.ImageVersion ?? null,
  node: process.version, playwright: JSON.parse(fs.readFileSync('tests/e2e/node_modules/@playwright/test/package.json')).version,
  sourceCommit: process.env.GITHUB_SHA, order: ['original', 'none'] });
const grep = 'material long text 1920x1080 (saves the last chapter and preserves it after full reload at (100|200)%|keeps full detail text and cancels unsaved chapter edits at 200%)$';
const expected = ['saves the last chapter and preserves it after full reload at 100%', 'keeps full detail text and cancels unsaved chapter edits at 200%', 'saves the last chapter and preserves it after full reload at 200%'].sort();
function validate(report) {
  if (report.config.workers !== 1 || report.config.projects.find(project => project.name === 'webkit-mobile')?.retries !== 1) throw new Error('Worker or retry limit changed');
  const found = [];
  function visit(suites, parents = []) {
    for (const suite of suites ?? []) {
      const chain = [...parents, suite.title];
      for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) found.push({ title: spec.title, chain, project: test.projectName, file: spec.file, test });
      visit(suite.suites, chain);
    }
  }
  visit(report.suites);
  if (report.errors?.length || found.length !== 3 || JSON.stringify(found.map(x => x.title).sort()) !== JSON.stringify(expected)
    || found.some(x => x.project !== 'webkit-mobile' || !x.chain.includes('material long text 1920x1080') || !x.file.endsWith('bookshelf-grid-diagnostic.spec.mjs') || x.test.timeout !== 30000)) throw new Error('Exact-three selection or unchanged execution limits failed');
  return found;
}
async function assertPortsFree() {
  for (const port of [4173, 4174, 4175]) await new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); reject(new Error(`Unexpected existing server at port ${port}`)); });
    socket.once('error', error => { socket.destroy(); error.code === 'ECONNREFUSED' ? resolve() : reject(error); });
    socket.setTimeout(2000, () => { socket.destroy(); reject(new Error(`Port ownership check timed out: ${port}`)); });
  });
}
function comparePaintEvidence() {
  const records = {};
  for (const arm of ['original', 'none']) {
    const report = JSON.parse(fs.readFileSync(`${out}/${arm}/playwright-cross-browser-results.json`, 'utf8'));
    records[arm] = validate(report).flatMap(item => item.test.results.map(result => {
      const attachment = result.attachments?.find(a => a.name === 'grid-paint-proof');
      return { title: item.title, retry: result.retry, proof: attachment?.body ? JSON.parse(Buffer.from(attachment.body, 'base64').toString()) : null };
    }));
  }
  const invalid = [];
  const matched = [];
  for (const arm of ['original', 'none']) for (const item of records[arm]) {
    if (item.proof?.css.some(css => !cssBundleProof.some(asset => asset.asset === css.asset && asset.sha256 === css.originalSha256))) invalid.push({ arm, title: item.title, errors: ['Served original CSS does not match frozen build'] });
    if (!item.proof || item.proof.errors.length) invalid.push({ arm, title: item.title, retry: item.retry, errors: item.proof?.errors ?? ['Missing paint proof'] });
  }
  function differences(a, b, field = '') {
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1 ? [] : [field];
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return [field];
      return a.flatMap((value, index) => differences(value, b[index], `${field}[${index}]`));
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      if (!isDeepStrictEqual(Object.keys(a).sort(), Object.keys(b).sort())) return [field];
      return Object.keys(a).flatMap(key => differences(a[key], b[key], `${field}.${key}`));
    }
    return a === b ? [] : [field];
  }
  for (const original of records.original) {
    const none = records.none.find(item => item.title === original.title && item.retry === original.retry);
    if (!original.proof || !none?.proof) { invalid.push({ title: original.title, retry: original.retry, errors: ['Missing matched attempt'] }); continue; }
    const originalAssets = original.proof.css.map(item => [item.asset, item.originalSha256]);
    const noneAssets = none.proof.css.map(item => [item.asset, item.originalSha256]);
    if (!isDeepStrictEqual([...new Set(originalAssets.map(JSON.stringify))].sort(), [...new Set(noneAssets.map(JSON.stringify))].sort())) invalid.push({ title: original.title, errors: ['Original CSS assets differ'] });
    for (const phase of ['detail', 'editor']) if (!original.proof.checkpoints.some(p => p.phase === phase) || !none.proof.checkpoints.some(p => p.phase === phase)) invalid.push({ title: original.title, retry: original.retry, errors: [`Missing ${phase} checkpoint`] });
    const keys = [...new Set([...original.proof.checkpoints, ...none.proof.checkpoints].map(p => `${p.phase}:${p.index}`))];
    for (const key of keys) {
      const a = original.proof.checkpoints.find(p => `${p.phase}:${p.index}` === key);
      const b = none.proof.checkpoints.find(p => `${p.phase}:${p.index}` === key);
      if (!a || !b) { invalid.push({ title: original.title, retry: original.retry, key, errors: ['Missing matched checkpoint'] }); continue; }
      const geometry = differences(a.geometry, b.geometry, 'geometry');
      const invariant = item => ({ rootFont: item.rootFont, appearance: item.appearance, theme: item.theme, viewport: item.viewport, scroll: item.scroll, fontLoaded: item.fontLoaded,
        paint: item.paint.map(({ image, ...rest }) => ({ ...rest, conic: image.match(/repeating-conic-gradient\([^)]*\)(?:[^)]*\))?/)?.[0] ?? null })) });
      const errors = [...geometry, ...differences(invariant(a), invariant(b), 'invariants')];
      matched.push({ title: original.title, retry: original.retry, key, equivalent: errors.length === 0 });
      if (errors.length) invalid.push({ title: original.title, retry: original.retry, key, errors });
    }
  }
  for (const none of records.none) if (!records.original.some(item => item.title === none.title && item.retry === none.retry)) invalid.push({ title: none.title, retry: none.retry, errors: ['Missing matched original attempt'] });
  return { valid: invalid.length === 0 && matched.length > 0, invalid, matched, limitation: 'Fixed original-to-none order and outcome-dependent worker reuse; geometry tolerance at most one CSS pixel, no acceptance assertion weakened.' };
}

if (process.argv.includes('--collect-only')) {
  for (const mode of ['original', 'none']) {
    const listed = spawnSync('./tests/e2e/node_modules/.bin/playwright', ['test', '--config=tests/e2e/playwright.grid-diagnostic.config.mjs', '--project=webkit-mobile', 'bookshelf-grid-diagnostic.spec.mjs', '--grep', grep, '--list', '--reporter=json'], { encoding: 'utf8', env: { ...process.env, GRID_DIAGNOSTIC_MODE: mode }, maxBuffer: 16 * 1024 * 1024 });
    if (listed.status !== 0) throw new Error(listed.stderr || listed.stdout);
    const found = validate(JSON.parse(listed.stdout));
    console.log(`${mode}: exact ${found.length}; all timeout 30000, retries 1, workers 1`);
  }
  process.exit(0);
}
const cssBundleProof = fs.readdirSync('dist/assets').filter(file => file.endsWith('.css')).map(file => {
  const text = fs.readFileSync(`dist/assets/${file}`, 'utf8');
  const matches = [...text.matchAll(/--pixel-grid-paper\s*:\s*([^;{}]+)(?=[;}])/g)];
  if (matches.length > 1 || matches.some(match => (match[0].match(/repeating-linear-gradient\(/g) ?? []).length !== 2)) throw new Error('Unexpected built grid CSS');
  if (matches.length) {
    const modified = text.replace(matches[0][0], '--pixel-grid-paper:none,none');
    if (modified.replace('--pixel-grid-paper:none,none', matches[0][0]) !== text) throw new Error('Built CSS transformation not reversible');
  }
  return { asset: `/assets/${file}`, sha256: createHash('sha256').update(text).digest('hex'), declarations: matches.length };
});
if (cssBundleProof.reduce((sum, item) => sum + item.declarations, 0) !== 1) throw new Error('Expected exactly one built grid declaration');
write('css-bundle-proof.json', cssBundleProof);
const generated = ['playwright-cross-browser-results', 'playwright-cross-browser-report', 'playwright-cross-browser-results.json'];
const arms = [];
let setupFailure = null;
try {
  for (const arm of ['original', 'none']) {
    const armDir = `${out}/${arm}`;
    fs.mkdirSync(armDir);
    process.env.GRID_DIAGNOSTIC_MODE = arm;
    const capture = false;
    const args = ['test', '--config=tests/e2e/playwright.grid-diagnostic.config.mjs', '--project=webkit-mobile', '(^|/)bookshelf-grid-diagnostic\\.spec\\.mjs$', '--grep', grep];
    const entry = { arm, capture, status: 'not-executed', startedAt: null, endedAt: null, exitCode: null };
    arms.push(entry);
    write('summary.json', { arms, setupFailure, complete: false });
    await assertPortsFree();
    if (generated.some(name => fs.existsSync(`artifacts/${name}`))) throw new Error('Previous arm output was not isolated');
    const listed = spawnSync('./tests/e2e/node_modules/.bin/playwright', [...args, '--list', '--reporter=json'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    fs.writeFileSync(`${armDir}/selected-three.json`, listed.stdout || '');
    if (listed.status !== 0 || listed.error) throw new Error('Test collection failed');
    validate(JSON.parse(listed.stdout));
    fs.writeFileSync(`${armDir}/config-proof.json`, JSON.stringify({ changedProperties: ['use.video', 'use.trace', 'projects.webkit-mobile.testMatch'], matchedInstrumentation: true, gridMode: arm, trace: capture ? base.use.trace : 'off', video: capture ? base.use.video : 'off', screenshot: base.use.screenshot, retries: base.retries, workers: base.workers, deepRestorationMatchesBaseline: true }, null, 2));
    entry.startedAt = new Date().toISOString();
    entry.status = 'running';
    write('summary.json', { arms, setupFailure, complete: false });
    console.log(`Grid ${arm}: starting exact three tests`);
    const run = spawnSync(process.execPath, ['scripts/ci/playwright-shard.mjs', ...args], { stdio: 'inherit' });
    entry.endedAt = new Date().toISOString();
    entry.exitCode = run.status;
    entry.signal = run.signal;
    entry.status = run.status === 0 ? 'passed' : 'failed';
    for (const name of generated) if (fs.existsSync(`artifacts/${name}`)) fs.renameSync(`artifacts/${name}`, `${armDir}/${name}`);
    fs.writeFileSync(`${armDir}/exit-status.json`, JSON.stringify(entry, null, 2));
    if (run.error || run.signal || run.status === null) throw new Error('Test invocation interrupted or could not start');
    const result = JSON.parse(fs.readFileSync(`${armDir}/playwright-cross-browser-results.json`, 'utf8'));
    const results = validate(result);
    if (results.some(x => !x.test.results?.length || x.test.results.some(result => ['skipped', 'interrupted'].includes(result.status)))) throw new Error('Incomplete test execution');
    console.log(`Grid ${arm}: exit ${run.status}; ${JSON.stringify(result.stats)}`);
  }
} catch (error) {
  setupFailure = { message: error.message, arm: arms.at(-1)?.arm ?? null };
  console.error('Grid setup/incomplete failure:', error.message);
} finally {
  const after = snapshot();
  write('source-after.json', after);
  const sourceUnchanged = isDeepStrictEqual(before, after);
  const complete = !setupFailure && arms.length === 2 && arms.every(arm => ['passed', 'failed'].includes(arm.status));
  let paintComparison = { valid: false, invalid: ['Incomplete experiment'] };
  if (complete) { try { paintComparison = comparePaintEvidence(); } catch (error) { paintComparison = { valid: false, invalid: [String(error)] }; } }
  write('paint-comparison.json', paintComparison);
  const success = complete && sourceUnchanged && paintComparison.valid && arms.every(arm => arm.exitCode === 0);
  write('summary.json', { arms, setupFailure, sourceUnchanged, complete, paintComparisonValid: paintComparison.valid, success });
  process.exitCode = success ? 0 : 1;
}