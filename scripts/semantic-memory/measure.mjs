/**
 * Run: SEMANTIC_MEMORY_PLAYWRIGHT=/path/to/playwright/index.mjs node scripts/semantic-memory/measure.mjs
 * Uses the repo's existing Playwright version/workflow, no root heavy dependency.
 * Builds a synthetic HTML entry with the real production worker, serves Vite preview.
 * Only fixed synthetic strings; no application login, memory store or remote AI.
 */
import { build, preview } from 'vite';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
let playwrightPath = process.env.SEMANTIC_MEMORY_PLAYWRIGHT;
if (!playwrightPath) {
  try { playwrightPath = require.resolve('../../tests/e2e/node_modules/playwright/index.mjs'); }
  catch { throw Error('Playwright missing: use the existing @playwright/test@1.64.0 workflow install and set SEMANTIC_MEMORY_PLAYWRIGHT to its playwright/index.mjs'); }
}
const { chromium, webkit } = await import(pathToFileURL(playwrightPath).href);
const outDir = process.env.SEMANTIC_MEMORY_BENCH_DIST ?? '/private/tmp/laplance-semantic-memory-bench';
const reportPath = process.env.SEMANTIC_MEMORY_REPORT ?? path.join(root, 'scripts/semantic-memory/desktop-results.json');
await build({ root, configFile: path.join(root, 'vite.config.mjs'), build: { outDir, emptyOutDir: true, manifest: true,
  rollupOptions: { input: path.join(root, 'scripts/semantic-memory/benchmark.html') } } });
const server = await preview({ root, configFile: path.join(root, 'vite.config.mjs'), build: { outDir }, preview: { port: 4184, strictPort: true, host: '127.0.0.1', https: false } });
const base = 'http://127.0.0.1:4184';
function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label)), timeoutMs); })])
    .finally(() => clearTimeout(timer));
}
const bundleOnly = process.env.SEMANTIC_MEMORY_BUNDLE_ONLY === '1';
await mkdir(path.dirname(reportPath), { recursive: true });
const freshResults = { timestamp: new Date().toISOString(), platform: process.platform, arch: process.arch,
  transformers: '4.3.0', playwright: '1.64.0', realIPhoneSafari: 'NOT RUN — no physical device available', browsers: [], bundle: [] };
const results = bundleOnly ? JSON.parse(await readFile(reportPath, 'utf8').catch(error => {
  if (error.code === 'ENOENT') return 'null';
  throw error;
})) ?? freshResults : freshResults;
try {
  results.bundle = [];
  results.bundleTimestamp = new Date().toISOString();
  const targets = [
    { name: 'chromium', launcher: chromium, backendPreference: 'auto' },
    { name: 'webkit', launcher: webkit, backendPreference: 'auto' },
    { name: 'webkit-wasm', launcher: webkit, backendPreference: 'wasm' },
  ];
  for (const { name, launcher, backendPreference } of (bundleOnly ? [] : targets)) {
    let browser;
    try { browser = await launcher.launch({ headless: true }); }
    catch (error) {
      const message = String(error);
      const reason = message.includes('bootstrap_check_in') ? 'sandbox MachPortRendezvousServer permission denied (1100)'
        : message.includes('Abort trap: 6') ? 'WebKit browser launch aborted (SIGABRT) before page execution' : message.slice(0, 600);
      results.browsers.push({ name, status: 'NOT RUN', stage: 'browser_launch', reason });
      await writeFile(reportPath, JSON.stringify(results, null, 2) + '\n');
      continue;
    }
    const version = browser.version();
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    const resources = []; const reads = []; const violations = []; const consoleErrors = []; const requests = [];
    const blockedOfflineRequests = []; const fixtureShellRequests = [];
    let phase = 'cold';
    let offlineShell = false;
    let holdWeight = false;
    let heldWeightResolve;
    let releaseHeldWeight;
    const weightReached = new Promise(resolve => { heldWeightResolve = resolve; });
    const releaseWeight = new Promise(resolve => { releaseHeldWeight = resolve; });
    const abortWorkers = []; let closedAbortWorkers = 0;
    let allAbortWorkersClosedResolve;
    const allAbortWorkersClosed = new Promise(resolve => { allAbortWorkersClosedResolve = resolve; });
    page.on('worker', worker => {
      if (phase === 'abortMidLoad') { abortWorkers.push(worker); worker.on('close', () => {
        closedAbortWorkers++;
        if (closedAbortWorkers === abortWorkers.length) allAbortWorkersClosedResolve();
      }); }
    });
    // Synthetic installed shell, NOT a service worker or product offline/PWA claim.
    // During offline phases only built HTML + app/worker/library JS are supplied.
    // Runtime .mjs/.wasm and all model artifacts MUST come from the real Cache API.
    await context.route('**/*', async route => {
      const request = route.request(); const url = new URL(request.url());
      if (offlineShell) {
        if (url.origin === base && (url.pathname.endsWith('.html') || url.pathname.endsWith('.js'))) {
          const fixturePath = path.resolve(outDir, '.' + url.pathname);
          if (fixturePath.startsWith(path.resolve(outDir) + path.sep)) {
            const body = await readFile(fixturePath);
            fixtureShellRequests.push({ phase, path: url.pathname });
            await route.fulfill({ status: 200, body, contentType: url.pathname.endsWith('.html') ? 'text/html' : 'text/javascript' });
            return;
          }
        }
        blockedOfflineRequests.push({ phase, origin: url.origin, path: url.pathname });
        await route.abort('internetdisconnected'); return;
      }
      if (holdWeight && url.pathname.endsWith('/onnx/model_int8.onnx') && !request.headers().range) {
        heldWeightResolve({ origin: url.origin, path: url.pathname });
        await releaseWeight;
        await route.abort('aborted').catch(() => undefined); return;
      }
      await route.continue();
    });
    context.on('request', request => {
      const url = new URL(request.url());
      requests.push({ phase, origin: url.origin, path: url.pathname, method: request.method() });
      const isPublicModelHost = url.hostname === 'huggingface.co' || url.hostname === 'hf.co' || url.hostname.endsWith('.hf.co');
      if (url.origin !== base && (!isPublicModelHost || request.method() !== 'GET' || request.postData() !== null)) {
        violations.push({ phase, origin: url.origin, method: request.method() });
      }
    });
    context.on('response', response => {
      const url = new URL(response.url()); const responsePhase = phase;
      reads.push((async () => {
        try { resources.push({ phase: responsePhase, origin: url.origin, path: url.pathname, status: response.status(), bytes: (await response.body()).byteLength }); }
        catch { resources.push({ phase: responsePhase, origin: url.origin, path: url.pathname, status: response.status(), bytes: null }); }
      })());
    });
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ phase, message: message.text().slice(0, 400) }); });
    const reload = async () => {
      await page.goto(`${base}/scripts/semantic-memory/benchmark.html`);
      await page.waitForFunction(() => window.runtimeReady === true);
    };
    let cold; const lifecycle = {};
    try {
      await reload();
      cold = await page.evaluate(preference => window.measure({ backendPreference: preference }), backendPreference);
      await Promise.allSettled(reads);
      lifecycle.cacheAfterCold = await page.evaluate(() => window.inspectModelCache());
      phase = 'offlineReload'; offlineShell = true; await context.setOffline(true);
      await reload();
      lifecycle.offlineReload = await page.evaluate(preference => window.measure({ clearCache: false, backendPreference: preference, steadyCount: 1 }), backendPreference);
      lifecycle.offlineReload.blockedFetches = blockedOfflineRequests.filter(request => request.phase === phase);
      phase = 'clearedOffline';
      await page.evaluate(() => window.clearModelCache());
      lifecycle.cacheAfterClear = await page.evaluate(() => window.inspectModelCache());
      await reload();
      lifecycle.clearedOffline = await page.evaluate(preference => window.measure({ clearCache: false, backendPreference: preference, steadyCount: 0 }), backendPreference);
      // Start with no cached model, then hold a real weight GET before aborting.
      phase = 'abortMidLoad'; offlineShell = false; await context.setOffline(false);
      await reload(); await page.evaluate(() => window.clearModelCache());
      holdWeight = true;
      await page.evaluate(preference => window.startAbortProbe({ backendPreference: preference }), backendPreference);
      lifecycle.heldWeightRequest = await withTimeout(weightReached, 30000, 'model weight request was not reached');
      await page.evaluate(() => window.abortActiveEmbed());
      lifecycle.abortMidLoad = await withTimeout(page.evaluate(() => window.abortProbeResult), 5000, 'abort did not settle');
      releaseHeldWeight(); holdWeight = false;
      await withTimeout(allAbortWorkersClosed, 5000, 'aborted Worker did not close');
      lifecycle.abortMidLoad.workerCount = abortWorkers.length;
      lifecycle.abortMidLoad.closedWorkerCount = closedAbortWorkers;
      lifecycle.checks = {
        coldEmbedding: cold.status === 'ok' && cold.dimensions === 384 && cold.allFinite === true,
        forcedWasm: backendPreference !== 'wasm' || cold.backend === 'wasm',
        cachePopulated: lifecycle.cacheAfterCold.entries.some(entry => entry.path.endsWith('/onnx/model_int8.onnx')),
        offlineReload: lifecycle.offlineReload.status === 'ok' && lifecycle.offlineReload.allFinite === true && lifecycle.offlineReload.browserOnline === false && lifecycle.offlineReload.blockedFetches.length === 0,
        cacheErased: lifecycle.cacheAfterClear.exists === false,
        clearedOfflineUnavailable: lifecycle.clearedOffline.status === 'unavailable' && lifecycle.clearedOffline.reason === 'model_download_failed',
        abortMidLoad: lifecycle.abortMidLoad.status === 'unavailable' && lifecycle.abortMidLoad.reason === 'aborted' &&
          lifecycle.abortMidLoad.metricsCountAfterAbort === 0 && abortWorkers.length > 0 && closedAbortWorkers === abortWorkers.length,
      };
    } catch (error) { lifecycle.harnessFailure = String(error).slice(0, 600); }
    finally { releaseHeldWeight(); await browser.close(); }
    await Promise.allSettled(reads);
    const weights = resources.filter(resource => resource.phase === 'cold' && resource.origin !== base && resource.status >= 200 && resource.status < 300);
    const record = { name, version, backendPreference, ...cold,
      status: lifecycle.checks && Object.values(lifecycle.checks).every(Boolean) && violations.length === 0 ? 'ok' : 'failed',
      publicModelDownloadBytes: weights.every(resource => resource.bytes !== null) ? weights.reduce((sum, resource) => sum + resource.bytes, 0) : null,
      lifecycle, syntheticOfflineShell: 'Built HTML and app/worker/library JS supplied by fixture routing with network offline; model and ONNX runtime files require Cache API. No product PWA/offline claim.',
      resources, requests, blockedOfflineRequests, fixtureShellRequests, networkMethodOrBodyViolations: violations, consoleErrors };
    results.browsers.push(record);
    console.log(JSON.stringify({ browser: name, status: record.status, backend: cold?.backend, checks: lifecycle.checks, harnessFailure: lifecycle.harnessFailure }));
    await writeFile(reportPath, JSON.stringify(results, null, 2) + '\n');
  }
  for (const name of await readdir(path.join(outDir, 'assets'))) {
    const buffer = await readFile(path.join(outDir, 'assets', name));
    results.bundle.push({ file: name, bytes: buffer.byteLength, gzipBytes: gzipSync(buffer).byteLength });
  }
  const manifest = JSON.parse(await readFile(path.join(outDir, '.vite/manifest.json'), 'utf8'));
  const entry = Object.values(manifest).find(item => item.isEntry);
  const visited = new Set();
  function visit(key) { if (visited.has(key)) return; visited.add(key); for (const dependency of manifest[key]?.imports ?? []) visit(dependency); }
  for (const [key, value] of Object.entries(manifest)) if (value.isEntry) visit(key);
  const initialFiles = [...visited].map(key => manifest[key].file);
  results.initialGraph = { entry: entry.file, files: initialFiles };
  const worker = results.bundle.find(item => item.file.startsWith('embedding.worker-'));
  const workerSource = await readFile(path.join(outDir, 'assets', worker.file), 'utf8');
  results.workerGraph = { file: worker.file, dynamicImports: [...workerSource.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)].map(match => match[1]) };
  if (!results.workerGraph.dynamicImports.some(file => file.includes('transformers.web-'))) throw Error('Expected dynamic Transformers import in Worker');
  // Inference code must be absent even when a page statically imports the factory.
  for (const file of initialFiles) {
    const source = await readFile(path.join(outDir, file), 'utf8');
    if (source.includes('InferenceSession') || source.includes('class BertModel') || source.includes('onnxruntime-web@')) throw Error(`Inference code leaked into initial entry ${file}`);
  }
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(results, null, 2) + '\n');
} finally { await new Promise(resolve => server.httpServer.close(resolve)); }
if (!bundleOnly && results.browsers.some(browser => browser.status !== 'ok' || browser.networkMethodOrBodyViolations.length)) process.exitCode = 1;
