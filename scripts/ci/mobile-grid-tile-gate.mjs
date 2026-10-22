import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import base from '../../tests/e2e/playwright.cross-browser.config.mjs';
import visual from '../../tests/e2e/playwright.grid-equivalence.config.mjs';
const out = 'artifacts/grid-tile';
fs.mkdirSync(out, { recursive: true });
const write = (name, data) => fs.writeFileSync(`${out}/${name}.json`, JSON.stringify(data, null, 2));
const expectedVisual = [];
for (const width of [390, 1920]) for (const theme of ['light', 'dark']) for (const percent of [100, 200]) for (const surface of ['home', 'settings']) for (const geometry of ['actual', 'fractional']) for (const position of ['top', 'scrolled']) expectedVisual.push({ suite: `grid ${width}px`, title: `${theme} ${percent}% ${surface} ${geometry} ${position}: exact original/tile pixels` });
const expectedPerformance = ['saves the last chapter and preserves it after full reload at 100%', 'keeps full detail text and cancels unsaved chapter edits at 200%', 'saves the last chapter and preserves it after full reload at 200%'];
const grep = 'material long text 1920x1080 (saves the last chapter and preserves it after full reload at (100|200)%|keeps full detail text and cancels unsaved chapter edits at 200%)$';
const restored = { ...visual, projects: base.projects };
if (!isDeepStrictEqual(restored, base) || !base.failOnFlakyTests || base.retries !== 1 || base.workers !== 1 || base.use.trace !== 'retain-on-failure' || base.use.video !== 'retain-on-failure') throw new Error('Normal capture or execution policy changed');
const list = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
if (list.status !== 0) throw new Error('Cannot enumerate source');
const files = list.stdout.split('\0').filter(Boolean);
const snapshot = () => Object.fromEntries(files.map(file => [file, createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const before = snapshot(); write('source-before', before);
write('host', { cpuModels: [...new Set(os.cpus().map(cpu => cpu.model))], logicalCpuCount: os.cpus().length, availableParallelism: os.availableParallelism(), arch: os.arch(), platform: os.platform(), release: os.release(), node: process.version, playwright: JSON.parse(fs.readFileSync('tests/e2e/node_modules/@playwright/test/package.json')).version, sourceCommit: process.env.GITHUB_SHA ?? null, imageOS: process.env.ImageOS ?? null, imageVersion: process.env.ImageVersion ?? null, configuredContainer: 'mcr.microsoft.com/playwright:v1.64.0-noble' });
const diagnosticPaths = ['.github/workflows/diagnose-pr833-mobile-three.yml', 'scripts/ci/mobile-grid-diagnostic.mjs', 'tests/e2e/support/grid-diagnostic.mjs', 'scripts/ci/mobile-grid-tile-gate.mjs', 'tests/e2e/playwright.grid-equivalence.config.mjs', 'tests/e2e/pixel-grid-equivalence.diagnostic.mjs'];
if (before['src/styles/appearance-pixel.css'] !== 'ff0dd75f13ee0d85867b1434b67c3a55de209fdede2e497c13ae9247b02fcef7') throw new Error('Unexpected candidate CSS');
const frozenManifest = Object.fromEntries(Object.entries(before).filter(([file]) => !diagnosticPaths.includes(file)).map(([file, hash]) => [file, file === 'src/styles/appearance-pixel.css' ? 'e7f261226ee777594a539f064e12104870987894e212ece4be6a4164c40a8aa3' : hash]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
const frozenManifestSha256 = createHash('sha256').update(JSON.stringify(frozenManifest)).digest('hex');
if (frozenManifestSha256 !== 'e78f86e563443d5fc6254350b1140ce46ce021d37dc5131c7ea4f34f7adb2ba0') throw new Error('Unexpected non-treatment source difference from frozen833');
write('frozen-source-proof', { frozenCommit: '4c1c93ce0dec91fdec30644ee1575e2c9c2ed62d', frozenManifestSha256, originalCssSha256: 'e7f261226ee777594a539f064e12104870987894e212ece4be6a4164c40a8aa3', candidateCssSha256: 'ff0dd75f13ee0d85867b1434b67c3a55de209fdede2e497c13ae9247b02fcef7', diagnosticPaths });

write('config-proof', { trace: base.use.trace, video: base.use.video, screenshot: base.use.screenshot, retries: base.retries, workers: base.workers, visualOnlyDelta: 'webkit-mobile testMatch and single project selection', performanceConfigUnchanged: true });
function collect(report, kind) {
  const found = [];
  function visit(suites, ancestors = []) { for (const suite of suites ?? []) { const chain = [...ancestors, suite.title]; for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) found.push({ title: spec.title, chain, file: spec.file, test }); visit(suite.suites, chain); } }
  visit(report.suites);
  const expected = kind === 'visual' ? expectedVisual : expectedPerformance.map(title => ({ title, suite: 'material long text 1920x1080' }));
  if (report.errors?.length || found.length !== expected.length || report.config.workers !== 1 || report.config.projects.find(p => p.name === 'webkit-mobile')?.retries !== 1 || found.some(item => item.test.projectName !== 'webkit-mobile' || item.test.timeout !== 30000 || !item.file.endsWith(kind === 'visual' ? 'pixel-grid-equivalence.diagnostic.mjs' : 'bookshelf-surface.spec.mjs'))) throw new Error(`Invalid ${kind} collection or execution limits`);
  for (const entry of expected) if (found.filter(item => item.title === entry.title && item.chain.includes(entry.suite)).length !== 1) throw new Error(`Missing or duplicate ${kind} case`);
  return found;
}
const artifacts = ['playwright-cross-browser-results', 'playwright-cross-browser-report', 'playwright-cross-browser-results.json'];
const summary = { visual: 'not-started', performance: 'not-started', setupFailure: null, success: false };
async function run(kind, args) {
  fs.mkdirSync(`${out}/${kind}`, { recursive: true });
  if (artifacts.some(name => fs.existsSync(`artifacts/${name}`))) throw new Error('Unisolated earlier output');
  const listed = spawnSync('./tests/e2e/node_modules/.bin/playwright', [...args, '--list', '--reporter=json'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  fs.writeFileSync(`${out}/${kind}/selected.json`, listed.stdout || '');
  if (listed.status !== 0 || listed.error) throw new Error(`${kind} collection failed`);
  collect(JSON.parse(listed.stdout), kind);
  if (process.argv.includes('--collect-only')) return true;
  for (const port of [4173, 4174, 4175]) await new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); reject(new Error(`Existing server at ${port}`)); });
    socket.once('error', error => { socket.destroy(); error.code === 'ECONNREFUSED' ? resolve() : reject(error); });
    socket.setTimeout(2000, () => { socket.destroy(); reject(new Error('Server ownership check timed out')); });
  });
  const run = spawnSync(process.execPath, ['scripts/ci/playwright-shard.mjs', ...args], { stdio: 'inherit' });
  for (const name of artifacts) if (fs.existsSync(`artifacts/${name}`)) fs.renameSync(`artifacts/${name}`, `${out}/${kind}/${name}`);
  if (run.error || run.signal || run.status === null) throw new Error(`${kind} execution interrupted`);
  const report = JSON.parse(fs.readFileSync(`${out}/${kind}/playwright-cross-browser-results.json`, 'utf8'));
  if (run.status !== 0) {
    const hasAttempt = suites => (suites ?? []).some(suite => suite.specs?.some(spec => spec.tests?.some(test => test.results?.some(result => ['passed', 'failed', 'timedOut'].includes(result.status)))) || hasAttempt(suite.suites));
    write(`${kind}-execution-outcome`, { exitCode: run.status, reportErrors: report.errors ?? [], classification: hasAttempt(report.suites) ? 'test-failure-or-incomplete' : 'setup-no-test-attempt' });
    if (!hasAttempt(report.suites)) throw new Error(`${kind} setup failed before a test attempt`);
    return false;
  }
  const found = collect(report, kind);
  const completePass = run.status === 0 && found.every(item => item.test.results?.length === 1 && item.test.results[0].status === 'passed');
  if (kind === 'visual' && completePass) for (const item of found) {
    const attachments = item.test.results[0].attachments ?? [];
    for (const name of ['original', 'candidate', 'original-repeat', 'pixel-comparison']) if (attachments.filter(a => a.name === name).length !== 1) throw new Error('Incomplete visual evidence');
    const proof = attachments.find(a => a.name === 'pixel-comparison');
    if (!proof.body) throw new Error('Missing inline pixel comparison');
    const value = JSON.parse(Buffer.from(proof.body, 'base64').toString());
    if (value.settlements?.length !== 3 || value.settlements.some(item => item.settled !== true || !Array.isArray(item.observed) || item.observed.some(transition => !Number.isFinite(transition.endTime) || transition.endTime > 1000)) || value.settlements[0].value !== value.settlements[2].value || value.settlements[0].value === value.settlements[1].value) throw new Error('Missing or invalid settled transition evidence');
    if (!value.stability.sameDimensions || value.stability.changedPixels !== 0 || !value.comparison.sameDimensions || value.comparison.changedPixels !== 0) throw new Error('Pixel equality evidence failed');
  }
  return completePass;
}
try {
  summary.visual = await run('visual', ['test', '--config=tests/e2e/playwright.grid-equivalence.config.mjs', '--project=webkit-mobile', '--max-failures=1']) ? 'passed' : 'failed-or-incomplete';
  if (summary.visual === 'passed') summary.performance = await run('performance', ['test', '--config=tests/e2e/playwright.cross-browser.config.mjs', '--project=webkit-mobile', '(^|/)bookshelf-surface\\.spec\\.mjs$', '--grep', grep]) ? 'passed' : 'failed-or-incomplete';
  else summary.performance = 'skipped-visual-gate-failed';
} catch (error) { summary.setupFailure = String(error); if (summary.performance === 'not-started') summary.performance = 'skipped-prerequisite-failed'; }
finally {
  const after = snapshot(); write('source-after', after); summary.sourceUnchanged = isDeepStrictEqual(before, after);
  summary.collectionOnly = process.argv.includes('--collect-only');
  summary.success = !summary.setupFailure && summary.sourceUnchanged && summary.visual === 'passed' && summary.performance === 'passed';
  const valid = summary.success;
  if (summary.collectionOnly) { summary.visual = summary.visual === 'passed' ? 'collected-only' : summary.visual; summary.performance = summary.performance === 'passed' ? 'collected-only' : summary.performance; summary.success = false; }
  write('summary', summary); process.exitCode = valid ? 0 : 1;
}
