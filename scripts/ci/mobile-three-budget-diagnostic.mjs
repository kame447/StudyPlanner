import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import base from '../../tests/e2e/playwright.cross-browser.config.mjs';
const out = 'artifacts/mobile-budget';
fs.mkdirSync(out, { recursive: true });
const write = (name, data) => fs.writeFileSync(`${out}/${name}.json`, JSON.stringify(data, null, 2));
const expected = ['saves the last chapter and preserves it after full reload at 100%', 'keeps full detail text and cancels unsaved chapter edits at 200%', 'saves the last chapter and preserves it after full reload at 200%'];
const grep = 'material long text 1920x1080 (saves the last chapter and preserves it after full reload at (100|200)%|keeps full detail text and cancels unsaved chapter edits at 200%)$';
if (!base.failOnFlakyTests || base.retries !== 1 || base.workers !== 1 || base.use.trace !== 'retain-on-failure' || base.use.video !== 'retain-on-failure' || base.timeout !== undefined) throw new Error('Original normal policy changed');
const list = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
if (list.status !== 0) throw new Error('Cannot enumerate source');
const files = list.stdout.split('\0').filter(Boolean);
const snapshot = () => Object.fromEntries(files.map(file => [file, createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const before = snapshot(); write('source-before', before);
write('host', { cpuModels: [...new Set(os.cpus().map(cpu => cpu.model))], logicalCpuCount: os.cpus().length, availableParallelism: os.availableParallelism(), arch: os.arch(), platform: os.platform(), release: os.release(), node: process.version, playwright: JSON.parse(fs.readFileSync('tests/e2e/node_modules/@playwright/test/package.json')).version, sourceCommit: process.env.GITHUB_SHA ?? null, imageOS: process.env.ImageOS ?? null, imageVersion: process.env.ImageVersion ?? null, configuredContainer: 'mcr.microsoft.com/playwright:v1.64.0-noble' });
const diagnosticPaths = ['.github/workflows/diagnose-pr833-mobile-three.yml', 'scripts/ci/mobile-grid-diagnostic.mjs', 'tests/e2e/support/grid-diagnostic.mjs', 'scripts/ci/mobile-three-budget-diagnostic.mjs', 'scripts/ci/mobile-grid-tile-gate.mjs', 'tests/e2e/playwright.grid-equivalence.config.mjs', 'tests/e2e/pixel-grid-equivalence.diagnostic.mjs'];
if (before['src/styles/appearance-pixel.css'] !== 'e7f261226ee777594a539f064e12104870987894e212ece4be6a4164c40a8aa3') throw new Error('Unexpected candidate CSS');
const frozenManifest = Object.fromEntries(Object.entries(before).filter(([file]) => !diagnosticPaths.includes(file)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
const frozenManifestSha256 = createHash('sha256').update(JSON.stringify(frozenManifest)).digest('hex');
if (frozenManifestSha256 !== 'e78f86e563443d5fc6254350b1140ce46ce021d37dc5131c7ea4f34f7adb2ba0') throw new Error('Unexpected non-treatment source difference from frozen833');
write('frozen-source-proof', { frozenCommit: '4c1c93ce0dec91fdec30644ee1575e2c9c2ed62d', frozenManifestSha256, originalCssSha256: 'e7f261226ee777594a539f064e12104870987894e212ece4be6a4164c40a8aa3', diagnosticPaths });


const original = fs.readFileSync('tests/e2e/bookshelf-surface.spec.mjs', 'utf8');
const marker = '        test(`${purpose} at ${percent}%`, async ({ page }, testInfo) => {';
if (original.split(marker).length !== 2) throw new Error('Unexpected callback count');
const begin = original.indexOf(marker) + marker.length;
const end = original.indexOf('\n        });', begin);
if (end < 0) throw new Error('Missing callback boundary');
const prefix = `
          const diagnosticStarted = diagnosticPerformance.now();
          let diagnosticCompleted = false;
          let diagnosticBodyFailed = false;
          try {
            await test.step('diagnostic original functional body', async () => {
`;
const suffix = `
            });
            diagnosticCompleted = true;
          } catch (error) {
            diagnosticBodyFailed = true;
            throw error;
          } finally {
            const elapsedMs = diagnosticPerformance.now() - diagnosticStarted;
            await testInfo.attach('diagnostic-body-budget', { body: JSON.stringify({
              elapsedMs, completed: diagnosticCompleted, ordinaryBudgetMs: 30000,
              observationBudgetMs: 60000, beforeEachAndFixtureSetupIncluded: false,
              afterEachAndTeardownIncluded: false,
              ordinaryBudgetResult: elapsedMs > 30000 ? 'exceeded-by-body-alone' : 'unknown-not-rerun-at-30000',
            }), contentType: 'application/json' }).catch(attachmentError => {
              testInfo.annotations.push({ type: 'diagnostic-timing-attachment-failure', description: String(attachmentError) });
              if (!diagnosticBodyFailed) throw attachmentError;
            });
          }
`;
const transformed = `import { performance as diagnosticPerformance } from 'node:perf_hooks';\n` + original.slice(0, begin) + prefix + original.slice(begin, end) + suffix + original.slice(end);
const specPath = 'tests/e2e/bookshelf-budget.diagnostic.mjs';
const configPath = 'tests/e2e/playwright.budget-diagnostic.config.mjs';
if (fs.existsSync(specPath) || fs.existsSync(configPath)) throw new Error('Stale generated diagnostic source');
fs.writeFileSync(specPath, transformed);
fs.writeFileSync(configPath, `import base from './playwright.cross-browser.config.mjs';\nexport default { ...base, timeout: 60000, projects: base.projects.map(project => project.name === 'webkit-mobile' ? { ...project, testMatch: ['**/bookshelf-budget.diagnostic.mjs'] } : project) };\n`);
const { default: diagnostic } = await import('../../' + configPath);
const expectedConfig = { ...base, timeout: 60000, projects: base.projects.map(project => project.name === 'webkit-mobile' ? { ...project, testMatch: ['**/bookshelf-budget.diagnostic.mjs'] } : project) };
if (!isDeepStrictEqual(diagnostic, expectedConfig)) throw new Error('Unexpected config delta');
write('spec-proof', { originalSha256: createHash('sha256').update(original).digest('hex'), generatedSha256: createHash('sha256').update(transformed).digest('hex'), transformationCount: 1, unchangedBody: transformed.includes(prefix + original.slice(begin, end) + suffix), helperOrAssertionChanges: false });
write('config-proof', { diagnosticTimeout: diagnostic.timeout, originalTimeout: 30000, trace: base.use.trace, video: base.use.video, screenshot: base.use.screenshot, retries: base.retries, workers: base.workers, failOnFlakyTests: base.failOnFlakyTests, projectUse: diagnostic.projects.find(p => p.name === 'webkit-mobile').use, onlyConfigDeltas: ['diagnostic-only timeout60000', 'generated mobile testMatch'] });
function collect(report) {
  const found = [];
  function visit(suites, ancestors = []) { for (const suite of suites ?? []) { const chain = [...ancestors, suite.title]; for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) found.push({ title: spec.title, chain, file: spec.file, test }); visit(suite.suites, chain); } }
  visit(report.suites);
  if (found.length !== 3 || report.config.workers !== 1 || report.config.projects.find(p => p.name === 'webkit-mobile')?.retries !== 1 || found.some(item => item.test.projectName !== 'webkit-mobile' || item.test.timeout !== 60000 || !item.file.endsWith('bookshelf-budget.diagnostic.mjs'))) throw new Error('Invalid exact-three collection or execution limits');
  for (const title of expected) if (found.filter(item => item.title === title && item.chain.includes('material long text 1920x1080')).length !== 1) throw new Error('Missing or duplicate target case');
  return found;
}
const artifacts = ['playwright-cross-browser-results', 'playwright-cross-browser-report', 'playwright-cross-browser-results.json'];
const summary = { diagnosticOutcome: 'not-started', ordinaryGate: 'not-run-and-not-changed', latencyFixProven: false, setupFailure: null, success: false, cases: [] };
try {
  if (artifacts.some(name => fs.existsSync(`artifacts/${name}`))) throw new Error('Unisolated earlier output');
  const args = ['test', `--config=${configPath}`, '--project=webkit-mobile', '--grep', grep];
  const listed = spawnSync('./tests/e2e/node_modules/.bin/playwright', [...args, '--list', '--reporter=json'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  fs.writeFileSync(`${out}/selected.json`, listed.stdout || '');
  if (listed.status !== 0 || listed.error) throw new Error('Collection failed');
  const selection = JSON.parse(listed.stdout); if (selection.errors?.length) throw new Error('Collection errors'); collect(selection);
  if (process.argv.includes('--collect-only')) summary.diagnosticOutcome = 'collected-only';
  else {
    for (const port of [4173, 4174, 4175]) await new Promise((resolve, reject) => {
      const socket = net.connect({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); reject(new Error(`Existing server at ${port}`)); });
      socket.once('error', error => { socket.destroy(); error.code === 'ECONNREFUSED' ? resolve() : reject(error); });
      socket.setTimeout(2000, () => { socket.destroy(); reject(new Error('Server ownership check timed out')); });
    });
    const run = spawnSync(process.execPath, ['scripts/ci/playwright-shard.mjs', ...args], { stdio: 'inherit' });
    for (const name of artifacts) if (fs.existsSync(`artifacts/${name}`)) fs.renameSync(`artifacts/${name}`, `${out}/${name}`);
    if (run.error || run.signal || run.status === null) throw new Error('Execution interrupted');
    const report = JSON.parse(fs.readFileSync(`${out}/playwright-cross-browser-results.json`, 'utf8'));
    const found = collect(report);
    summary.exitCode = run.status; summary.reportErrors = report.errors ?? [];
    for (const item of found) {
      const attempts = (item.test.results ?? []).map(result => {
        const proofs = (result.attachments ?? []).filter(a => a.name === 'diagnostic-body-budget');
        if (proofs.length > 1) throw new Error('Duplicate timing evidence');
        const body = proofs[0]?.body ? JSON.parse(Buffer.from(proofs[0].body, 'base64').toString()) : null;
        if (result.status === 'passed' && (!body?.completed || !Number.isFinite(body.elapsedMs))) throw new Error('Missing complete-body evidence');
        return { status: result.status, retry: result.retry, reportedDurationIncludingHooksMs: result.duration, workerIndex: result.workerIndex, body, steps: result.steps ?? [], errors: result.errors ?? [] };
      });
      summary.cases.push({ title: item.title, annotations: item.test.annotations ?? [], attempts });
    }
    if (!summary.cases.some(c => c.attempts.some(a => ['passed', 'failed', 'timedOut'].includes(a.status)))) throw new Error('Setup failed before any test attempt');
    summary.diagnosticOutcome = run.status === 0 && !summary.reportErrors.length && summary.cases.every(c => c.attempts.length === 1 && c.attempts[0].status === 'passed') ? 'passed-observation-only' : 'test-failure-or-incomplete';
  }
} catch (error) { summary.setupFailure = String(error); }
finally {
  fs.rmSync(specPath, { force: true }); fs.rmSync(configPath, { force: true });
  const after = snapshot(); write('source-after', after); summary.sourceUnchanged = isDeepStrictEqual(before, after);
  summary.collectionOnly = process.argv.includes('--collect-only');
  summary.success = !summary.setupFailure && summary.sourceUnchanged && summary.diagnosticOutcome === 'passed-observation-only';
  write('summary', summary); process.exitCode = summary.success || (!summary.setupFailure && summary.sourceUnchanged && summary.collectionOnly) ? 0 : 1;
}
