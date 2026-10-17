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
const bundleOnly = process.env.SEMANTIC_MEMORY_BUNDLE_ONLY === '1';
const results = bundleOnly ? JSON.parse(await readFile(reportPath, 'utf8')) : { timestamp: new Date().toISOString(), platform: process.platform, arch: process.arch,
  transformers: '4.3.0', playwright: '1.64.0', realIPhoneSafari: 'NOT RUN — no physical device available', browsers: [], bundle: [] };
try {
  results.bundle = [];
  results.bundleTimestamp = new Date().toISOString();
  for (const [name, launcher] of (bundleOnly ? [] : [['chromium', chromium], ['webkit', webkit]])) {
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
    const context = await browser.newContext();
    const page = await context.newPage();
    const resources = []; const reads = []; const violations = []; const consoleErrors = [];
    context.on('request', request => {
      const url = new URL(request.url());
      if (url.origin !== base && (request.method() !== 'GET' || request.postData() !== null)) violations.push({ origin: url.origin, method: request.method() });
    });
    context.on('response', response => {
      const url = new URL(response.url());
      // Actual response bodies, not estimates from missing/CORS transferSize.
      reads.push((async () => {
        try { resources.push({ origin: url.origin, path: url.pathname, status: response.status(), bytes: (await response.body()).byteLength }); }
        catch { resources.push({ origin: url.origin, path: url.pathname, status: response.status(), bytes: null }); }
      })());
    });
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 400)); });
    await page.goto(`${base}/scripts/semantic-memory/benchmark.html`);
    await page.waitForFunction(() => window.runtimeReady === true);
    const measurement = await page.evaluate(() => window.measure());
    await Promise.allSettled(reads);
    const weights = resources.filter(resource => resource.origin !== base);
    results.browsers.push({ name, version: browser.version(), ...measurement,
      publicModelDownloadBytes: weights.every(resource => resource.bytes !== null) ? weights.reduce((sum, resource) => sum + resource.bytes, 0) : null,
      resources, networkMethodOrBodyViolations: violations, consoleErrors });
    console.log(JSON.stringify({ browser: name, ...measurement }));
    await browser.close();
    // Persist each terminal browser result before the next potentially expensive run.
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
