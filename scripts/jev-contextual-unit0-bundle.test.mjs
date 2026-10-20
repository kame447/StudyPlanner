import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const childSource = `
import { buildWorkerBundle, preSendFor, writeSegmentFiles } from ${JSON.stringify(new URL('./jev-contextual-unit0-eval.mjs', import.meta.url).href)};
import { DRY_RUN_PRICING } from ${JSON.stringify(new URL('./jev-contextual-unit0-dry-run.mjs', import.meta.url).href)};
const bundle = await buildWorkerBundle({ cases: [], preSend: preSendFor(DRY_RUN_PRICING) });
const { entry, codeSha256 } = await writeSegmentFiles(bundle, process.argv[1], { digest: 'a'.repeat(64), expiresAt: 1 });
process.stdout.write(JSON.stringify({ pid: process.pid, cwd: process.cwd(), entry,
  templateSha256: bundle.templateSha256, codeSha256 }));
`;

it('writes identical Unit0 bundle bytes and hashes from fresh processes with different working directories', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'unit0-bundle-cwd-'));
  try {
    const foreignCwd = join(directory, 'outside repository 日本語');
    const outputs = [join(directory, 'root-output'), join(directory, 'foreign-output')];
    await Promise.all([foreignCwd, ...outputs].map(path => mkdir(path)));
    const cwds = [ROOT, foreignCwd];
    // Fresh processes are required: changing cwd after esbuild starts its
    // service in one process can hide the original comment-path defect.
    const runs = await Promise.all(cwds.map(async (cwd, index) => {
      const { stdout } = await execFileAsync(process.execPath,
        ['--input-type=module', '--eval', childSource, outputs[index]],
        { cwd, timeout: 30_000, maxBuffer: 8_192 });
      const result = JSON.parse(stdout);
      expect(result.cwd).toBe(await realpath(cwd));
      return result;
    }));
    expect(new Set(runs.map(run => run.pid)).size).toBe(2);
    expect(new Set(runs.map(run => run.cwd)).size).toBe(2);
    expect(runs[0].templateSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(runs[1].templateSha256).toBe(runs[0].templateSha256);
    const bytes = await Promise.all(runs.map(run => readFile(run.entry)));
    expect(bytes[1]).toEqual(bytes[0]);
    for (const [index, run] of runs.entries()) {
      expect(run.codeSha256).toBe(run.templateSha256);
      expect(createHash('sha256').update(bytes[index]).digest('hex')).toBe(run.codeSha256);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 60_000);

it('D5 bridge bundles the actual Worker without deploying and refuses implicit live execution', async () => {
  const { d5BridgeWorkerSource, startD5BrowserBridge } = await import('./jev-d5-browser-bridge.mjs');
  const { build } = await import('esbuild');
  const source = d5BridgeWorkerSource({ workerPath: join(ROOT, 'workers/ai-proxy/src/worker.ts'), digest: 'a'.repeat(64), expiresAt: 1, runId: 'synthetic', remaining: { jev: 200, luna: 60, usd: 3 } });
  const bundled = await build({ stdin: { contents: source, resolveDir: ROOT, sourcefile: 'd5-dev-only.ts', loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:workers'] });
  expect(bundled.outputFiles[0].text).toContain('evaluateCandidateChoice');
  expect(bundled.outputFiles[0].text).toContain('requireFirebaseSession');
  expect(bundled.outputFiles[0].text).toContain('Dev bridge provider budget exhausted');
  if (process.env.JEV_D5_LIVE !== '1') await expect(startD5BrowserBridge({ workerName: 'synthetic' })).rejects.toThrow('JEV_D5_LIVE=1');
});

it('D5 bridge gates expiry/auth and enforces provider reservations before sends (offline VM)', async () => {
  const { runInNewContext } = await import('node:vm');
  const { webcrypto } = await import('node:crypto');
  const { d5BridgeWorkerSource, D5_BRIDGE_MAX_BODY_BYTES } = await import('./jev-d5-browser-bridge.mjs');
  const token = 'offline-token'; let sends = 0;
  const source = d5BridgeWorkerSource({ workerPath: '/synthetic-worker.ts', digest: createHash('sha256').update(token).digest('hex'),
    expiresAt: Date.now() + 60_000, runId: 'offline', remaining: { jev: 200, luna: 60, usd: 3 } })
    .replace(/^import worker from .*;$/m, `const worker = { async fetch() { return globalThis.fetch('https://openrouter.ai/api/alpha/decisions', { method: 'POST', body: JSON.stringify({ model: 'typesafe/jev-1.13' }) }); } };`)
    .replace(/^export \{ AiQuotaDurableObject \} from .*;$/m, '')
    .replace('export default {', 'globalThis.bridge = {');
  const context = { crypto: webcrypto, TextEncoder, URL, Request, Response, Headers, Date, Uint8Array,
    fetch: async (_input, init) => { expect(init.redirect).toBe('error'); sends++; return Response.json({ usage: { cost: .001, input_tokens: 20, output_tokens: 2 } }); } };
  runInNewContext(source, context);
  const request = auth => new Request('https://synthetic/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${auth}` }, body: '{}' });
  expect((await context.bridge.fetch(request('wrong'), {})).status).toBe(404); expect(sends).toBe(0);
  // These bounds are checked on the actual provider body, before any paid send.
  await expect(context.fetch('https://api.openai.com/v1/chat/completions', { method: 'POST',
    body: JSON.stringify({ model: 'gpt-6-luna', max_completion_tokens: 4097 }) })).rejects.toThrow('output');
  await expect(context.fetch('https://api.openai.com/v1/chat/completions', { method: 'POST',
    body: JSON.stringify({ model: 'unpriced-model', max_completion_tokens: 4096 }) })).rejects.toThrow('model');
  await expect(context.fetch('https://openrouter.ai/api/alpha/decisions', { method: 'POST',
    body: JSON.stringify({ model: 'typesafe/jev-1.13', padding: 'あ'.repeat(20_000) }) })).rejects.toThrow('body');
  expect(sends).toBe(0);
  const base = JSON.stringify({ model: 'gpt-6-luna', max_completion_tokens: 4096, padding: '' });
  const maximumBody = JSON.stringify({ model: 'gpt-6-luna', max_completion_tokens: 4096, padding: 'x'.repeat(D5_BRIDGE_MAX_BODY_BYTES - base.length) });
  expect(new TextEncoder().encode(maximumBody).length).toBe(D5_BRIDGE_MAX_BODY_BYTES);
  expect((await context.fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', body: maximumBody })).status).toBe(200);
  for (let i = 0; i < 59; i++) expect((await context.bridge.fetch(request(token), {})).status).toBe(200);
  await expect(context.bridge.fetch(request(token), {})).rejects.toThrow('budget exhausted');
  expect(sends).toBe(60);
});

it('D5 bridge allowlists environment keys and requires explicit remaining unit budgets', async () => {
  const { d5BridgeEnvironment, readD5BridgeRemainingBudget } = await import('./jev-d5-browser-bridge.mjs');
  const environment = d5BridgeEnvironment({ OPENROUTER_API_KEY: 'jev-fixture', OPENAI_API_KEY: 'luna-fixture', AI_QUOTA: 'isolated-preview-quota',
    FIREBASE_SERVICE_ACCOUNT: 'must-not-forward', AI_TURNS: 'production-turn-state', FIRESTORE_DATABASE: 'production', OBSERVABILITY: 'production' });
  expect(Object.keys(environment).sort()).toEqual(['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'AI_QUOTA', 'OPENAI_BASE_URL', 'ALLOWED_CHAT_MODELS',
    'FIREBASE_WEB_API_KEY', 'ALLOWED_ORIGIN', 'SEMANTIC_CENSUS_MODE', 'JEV_MODE', 'JEV_CANARY_PERCENT',
    'JEV_CANDIDATE_CHOICE_MODE', 'JEV_CANDIDATE_CHOICE_CANARY_PERCENT', 'JEV_FOCUSED_AUTHORIZATION_MODE', 'JEV_FOCUSED_AUTHORIZATION_CANARY_PERCENT',
    'JEV_FOCUSED_CONTEXTUAL_ANSWER_MODE', 'JEV_FOCUSED_CONTEXTUAL_ANSWER_CANARY_PERCENT'].sort());
  expect(JSON.stringify(environment)).not.toContain('production');
  expect(() => readD5BridgeRemainingBudget([])).toThrow('remaining-jev');
  expect(() => readD5BridgeRemainingBudget(['--remaining-jev', '201', '--remaining-luna', '60', '--remaining-usd', '3'])).toThrow();
  expect(readD5BridgeRemainingBudget(['--remaining-jev', '190', '--remaining-luna', '45', '--remaining-usd', '2.5'])).toEqual({ jev: 190, luna: 45, usd: 2.5 });
});

it('proves the fixed D5 reservation covers both existing Luna tariffs and the Jev bound', async () => {
  const { d5BridgePriceBounds, D5_BRIDGE_MAX_BODY_BYTES, D5_BRIDGE_RESERVATION_USD } = await import('./jev-d5-browser-bridge.mjs');
  const bounds = d5BridgePriceBounds();
  expect(D5_BRIDGE_MAX_BODY_BYTES).toBe(59_488);
  expect(bounds.inputBound).toBe(60_000);
  expect(bounds.maxOutputTokens).toBe(4096);
  expect(bounds.luna['gpt-6-luna']).toEqual({ pricingVersion: 'openai-public-2026-10-12-v1', maximumUsd: .00955 });
  expect(bounds.luna['gpt-5.6-luna'].maximumUsd).toBe(.019917);
  expect(bounds.jev.maximumUsd).toBeCloseTo(.00262, 10);
  for (const bound of [bounds.jev, ...Object.values(bounds.luna)]) expect(bound.maximumUsd).toBeLessThan(D5_BRIDGE_RESERVATION_USD);
});
