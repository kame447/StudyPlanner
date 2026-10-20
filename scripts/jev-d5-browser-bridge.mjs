import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { appendFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { estimateAiRequestCost } from '../workers/ai-proxy/src/aiUsagePricing.ts';
import { AI_PROXY_CHAT_REQUEST_LIMITS } from '../shared/aiProxyContract.ts';
import { PREREGISTERED_PRICING, workerRates, callReserveUsd } from './jev-contextual-unit0-budget.mjs';

// One token per UTF-8 byte plus the existing framing allowance; the Jev
// short-input contract supplies the tighter bound, also below Luna's threshold.
export const D5_BRIDGE_MAX_BODY_BYTES = PREREGISTERED_PRICING.jev.maxInputTokensPerCall - PREREGISTERED_PRICING.jev.inputTokenOverheadPerCall;
export const D5_BRIDGE_RESERVATION_USD = .05;
export function d5BridgePriceBounds() {
  const inputBound = D5_BRIDGE_MAX_BODY_BYTES + PREREGISTERED_PRICING.jev.inputTokenOverheadPerCall;
  const usage = { promptTokens: inputBound, completionTokens: AI_PROXY_CHAT_REQUEST_LIMITS.maxOutputTokens,
    cachedTokens: 0, cacheWriteTokens: inputBound };
  // Charge every input token at the cache-write upper rate, never a cache discount.
  const luna = Object.fromEntries(['gpt-6-luna', 'gpt-5.6-luna'].map(model => {
    const estimate = estimateAiRequestCost({ provider: 'openai', model, operationKind: 'chat_completion', usage });
    assert.ok(estimate.estimatedCostMicros !== null);
    // Two rounded tariff terms: two extra microdollars conservatively cover rounding.
    return [model, { pricingVersion: estimate.pricingVersion, maximumUsd: (estimate.estimatedCostMicros + 2) / 1e6 }];
  }));
  const jev = { pricingVersion: PREREGISTERED_PRICING.version, maximumUsd: callReserveUsd(workerRates(PREREGISTERED_PRICING).jev, inputBound) };
  assert.ok([jev, ...Object.values(luna)].every(bound => bound.maximumUsd <= D5_BRIDGE_RESERVATION_USD));
  return { inputBound, maximumBodyBytes: D5_BRIDGE_MAX_BODY_BYTES, maxOutputTokens: AI_PROXY_CHAT_REQUEST_LIMITS.maxOutputTokens, jev, luna };
}

// Browser/controller/persistence bridge, not an evaluation framework. No execution on import.
// Real: Worker chat ingress, catalogs, provider calls. Synthetic: Firebase session,
// full-app local repository, fixed browser clock. Remote-dev quota namespace is isolated.
export function d5BridgeEnvironment(env) {
  return {
    OPENROUTER_API_KEY: env.OPENROUTER_API_KEY, OPENAI_API_KEY: env.OPENAI_API_KEY, AI_QUOTA: env.AI_QUOTA,
    OPENAI_BASE_URL: 'https://api.openai.com/v1', ALLOWED_CHAT_MODELS: 'gpt-6-luna,gpt-5.6-luna',
    FIREBASE_WEB_API_KEY: 'synthetic-session-only', ALLOWED_ORIGIN: 'http://127.0.0.1:4174', SEMANTIC_CENSUS_MODE: 'off',
    JEV_MODE: 'canary', JEV_CANARY_PERCENT: '100', JEV_CANDIDATE_CHOICE_MODE: 'canary', JEV_CANDIDATE_CHOICE_CANARY_PERCENT: '100',
    JEV_FOCUSED_AUTHORIZATION_MODE: 'canary', JEV_FOCUSED_AUTHORIZATION_CANARY_PERCENT: '100',
    JEV_FOCUSED_CONTEXTUAL_ANSWER_MODE: 'canary', JEV_FOCUSED_CONTEXTUAL_ANSWER_CANARY_PERCENT: '100',
  };
}

export function readD5BridgeRemainingBudget(args) {
  const value = name => { const at = args.indexOf(name); assert.ok(at >= 0 && args[at + 1] !== undefined, `Required ${name}`); return Number(args[at + 1]); };
  const budget = { jev: value('--remaining-jev'), luna: value('--remaining-luna'), usd: value('--remaining-usd') };
  assert.ok(Number.isSafeInteger(budget.jev) && budget.jev >= 0 && budget.jev <= 200);
  assert.ok(Number.isSafeInteger(budget.luna) && budget.luna >= 0 && budget.luna <= 60);
  assert.ok(Number.isFinite(budget.usd) && budget.usd > 0 && budget.usd <= 3);
  return budget;
}

export function d5BridgeWorkerSource({ workerPath, digest, expiresAt, runId, remaining }) {
  assert.ok(remaining && Number.isSafeInteger(remaining.jev) && remaining.jev >= 0 && remaining.jev <= 200
    && Number.isSafeInteger(remaining.luna) && remaining.luna >= 0 && remaining.luna <= 60
    && Number.isFinite(remaining.usd) && remaining.usd > 0 && remaining.usd <= 3, 'Explicit remaining budget required');
  const priceBounds = d5BridgePriceBounds();
  return `
import worker from ${JSON.stringify(workerPath)};
export { AiQuotaDurableObject } from ${JSON.stringify(workerPath)};
const EXPECTED_DIGEST = ${JSON.stringify(digest)};
const EXPIRES_AT = ${expiresAt};
const RUN_ID = ${JSON.stringify(runId)};
const CAPS = ${JSON.stringify(remaining)};
const PRICE_BOUNDS = ${JSON.stringify(priceBounds)};
const RESERVATION_USD = ${D5_BRIDGE_RESERVATION_USD};
const JEV_MODELS = ${JSON.stringify(PREREGISTERED_PRICING.jev.servedModels)};
const bridgeEnvironment = ${d5BridgeEnvironment.toString()};
const upstream = globalThis.fetch.bind(globalThis);
let counters = { jev: 0, luna: 0, reservedUsd: 0 }; let receipts = []; let busy = false; let tariffViolation = false;
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('');
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === 'identitytoolkit.googleapis.com' && url.pathname === '/v1/accounts:lookup') {
    return Response.json({ users: [{ localId: 'planner-recovery-owner-' + RUN_ID, emailVerified: true }] });
  }
  const family = url.origin === 'https://openrouter.ai' && url.pathname === '/api/alpha/decisions' ? 'jev'
    : url.origin === 'https://api.openai.com' && url.pathname === '/v1/chat/completions' ? 'luna' : null;
  if (!family) throw new Error('Dev bridge denies non-provider network');
  if (tariffViolation) throw new Error('Provider tariff violation stopped this run');
  const providerBody = typeof init?.body === 'string' ? init.body : await new Request(input, init).clone().text();
  const bodyBytes = new TextEncoder().encode(providerBody).length;
  if (bodyBytes > PRICE_BOUNDS.maximumBodyBytes) throw new Error('Provider body exceeds proven tariff bound');
  const payload = JSON.parse(providerBody);
  if (family === 'luna' ? !Object.hasOwn(PRICE_BOUNDS.luna, payload.model)
    || !Number.isSafeInteger(payload.max_completion_tokens) || payload.max_completion_tokens < 1 || payload.max_completion_tokens > PRICE_BOUNDS.maxOutputTokens
    : !JEV_MODELS.includes(payload.model)) throw new Error('Provider model/output exceeds proven tariff bound');
  // A proved maximum remains charged even if usage/cost is absent.
  if (counters[family] >= CAPS[family] || counters.reservedUsd + RESERVATION_USD > CAPS.usd + 1e-9) {
    throw new Error('Dev bridge provider budget exhausted');
  }
  counters[family]++; counters.reservedUsd = Math.round((counters.reservedUsd + RESERVATION_USD) * 1e6) / 1e6;
  const receipt = { family, ordinal: counters[family], phase: 'reserved_before_send', reservedUsd: RESERVATION_USD,
    providerBodyBytes: bodyBytes, model: payload.model, priceBound: family === 'luna' ? PRICE_BOUNDS.luna[payload.model] : PRICE_BOUNDS.jev, startedAt: Date.now() };
  receipts.push(receipt);
  const response = await upstream(input, { ...init, redirect: 'error' });
  try {
    const body = await response.clone().json(); const usage = body.usage ?? {};
    const cost = typeof usage.cost === 'number' && Number.isFinite(usage.cost) && usage.cost >= 0 ? usage.cost : null;
    Object.assign(receipt, { phase: 'completed', httpStatus: response.status, latencyMs: Date.now() - receipt.startedAt,
      inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? null, outputTokens: usage.output_tokens ?? usage.completion_tokens ?? null, costUsd: cost });
    if (cost !== null && cost > RESERVATION_USD) { counters.reservedUsd += cost - RESERVATION_USD; tariffViolation = true; throw new Error('Provider exceeded conservative reservation'); }
  } catch (error) { if (tariffViolation || counters.reservedUsd > CAPS.usd) throw error; }
  return response;
};
export default { async fetch(request, env, ctx) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  if (Date.now() > EXPIRES_AT || await hash(token) !== EXPECTED_DIGEST) return new Response('Not found', { status: 404 });
  if (new URL(request.url).pathname === '/ready') return Response.json({ openRouter: !!env.OPENROUTER_API_KEY?.trim(), openAi: !!env.OPENAI_API_KEY?.trim(), counters });
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/chat/completions' || busy) return new Response('Unavailable', { status: 409 });
  busy = true; receipts = [];
  try {
    const headers = new Headers(request.headers); headers.set('Authorization', 'Bearer synthetic-fixture-session');
    headers.set('Origin', 'http://127.0.0.1:4174');
    const body = await request.text();
    if (new TextEncoder().encode(body).length > ${D5_BRIDGE_MAX_BODY_BYTES}) return new Response('Too large', { status: 413 });
    const response = await worker.fetch(new Request('https://d5-synthetic.invalid/chat/completions', { method: 'POST', headers, body }),
      bridgeEnvironment(env), undefined, ctx);
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('X-D5-Bridge-Receipts', JSON.stringify({ counters, receipts }));
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } finally { busy = false; }
} };
`;
}

export async function startD5BrowserBridge({ workerName, evidenceDir, remainingArgs = process.argv.slice(2), paceMs = 2200 } = {}) {
  assert.equal(process.env.JEV_D5_LIVE, '1', 'Live D5 bridge requires explicit JEV_D5_LIVE=1');
  const remaining = readD5BridgeRemainingBudget(remainingArgs);
  assert.match(workerName ?? '', /^[a-zA-Z0-9-]+$/);
  assert.ok(evidenceDir, 'Pass a dedicated synthetic evidence directory (JEV_D5_EVIDENCE_DIR)');
  assert.ok(paceMs >= 2200, 'Preserve provider/Worker pacing');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const wranglerRoot = join(root, 'node_modules/wrangler');
  assert.equal(JSON.parse(await readFile(join(wranglerRoot, 'package.json'), 'utf8')).version, '4.151.0');
  const { unstable_dev } = await import(pathToFileURL(join(wranglerRoot, 'wrangler-dist/cli.js')).href);
  const directory = await mkdtemp(join(tmpdir(), 'studyplanner-d5-browser-'));
  const remoteToken = randomBytes(32).toString('hex'); const localToken = randomBytes(32).toString('hex');
  const runId = randomBytes(8).toString('hex');
  const entry = join(directory, 'd5-browser.ts'); const config = join(directory, 'wrangler.json');
  await mkdir(evidenceDir, { recursive: true });
  const journal = join(evidenceDir, `d5-browser-${runId}.jsonl`);
  let worker; let server; let sequence = 0; let lastSend = 0; let chain = Promise.resolve();
  let reservedUsd = 0; let reservedJev = 0; let reservedLuna = 0;
  const receipt = row => appendFile(journal, JSON.stringify({ runId, ...row }) + '\n');
  try {
    await writeFile(entry, d5BridgeWorkerSource({ workerPath: join(root, 'workers/ai-proxy/src/worker.ts'),
      digest: createHash('sha256').update(remoteToken).digest('hex'), expiresAt: Date.now() + 45 * 60_000, runId, remaining }));
    await writeFile(config, JSON.stringify({ name: workerName, main: 'd5-browser.ts', compatibility_date: '2026-04-10',
      vars: { JEV_MODE: 'canary', JEV_CANARY_PERCENT: '100', JEV_CANDIDATE_CHOICE_MODE: 'canary', JEV_CANDIDATE_CHOICE_CANARY_PERCENT: '100',
        SEMANTIC_CENSUS_MODE: 'off', ALLOWED_ORIGIN: 'http://127.0.0.1:4174' },
      durable_objects: { bindings: [{ name: 'AI_QUOTA', class_name: 'AiQuotaDurableObject' }] },
      migrations: [{ tag: 'v1', new_sqlite_classes: ['AiQuotaDurableObject'] }],
    }));
    worker = await unstable_dev(entry, { config, local: false, ip: '127.0.0.1', port: 0, inspect: false, logLevel: 'none',
      experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false, showInteractiveDevSession: false, enableIpc: false } });
    const ready = await worker.fetch('/ready', { headers: { Authorization: `Bearer ${remoteToken}` }, signal: AbortSignal.timeout(45_000) });
    assert.equal(ready.status, 200); assert.deepEqual(await ready.json(), { openRouter: true, openAi: true, counters: { jev: 0, luna: 0, reservedUsd: 0 } });
    await receipt({ phase: 'ready', workerName, boundary: 'remote-dev-real-worker;synthetic-firebase;local-repository-not-firestore', remainingBudget: remaining, priceBounds: d5BridgePriceBounds(), paceMs });
    server = createServer((request, response) => {
      chain = chain.then(async () => {
        if (request.headers.authorization !== `Bearer ${localToken}` || request.method !== 'POST') { response.writeHead(404); response.end(); return; }
        let body = ''; for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > D5_BRIDGE_MAX_BODY_BYTES) throw new Error('Oversized loopback request'); }
        const payload = JSON.parse(body); const focused = payload.decisionContext?.purpose;
        const jev = focused ? 1 : 0; const luna = focused === 'candidate_choice' ? 0 : 1;
        const reservation = D5_BRIDGE_RESERVATION_USD * (jev + luna);
        if (reservedJev + jev > remaining.jev || reservedLuna + luna > remaining.luna || reservedUsd + reservation > remaining.usd + 1e-9) throw new Error('Loopback budget exhausted');
        reservedJev += jev; reservedLuna += luna; reservedUsd += reservation;
        const seq = ++sequence; const schema = payload.response_format?.json_schema?.name ?? null;
        // Persist a conservative permit covering every possible dispatch in this Worker chat call BEFORE send.
        await receipt({ seq, phase: 'reserved_before_send', schema, purpose: focused ?? payload.purpose,
          jevPermit: jev, lunaPermit: luna, reservedUsd: reservation, cumulativeReservedUsd: reservedUsd });
        const delay = Math.max(0, lastSend + paceMs - Date.now()); if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        lastSend = Date.now();
        const upstreamResponse = await worker.fetch('/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${remoteToken}`, 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(95_000) });
        const bytes = await upstreamResponse.text();
        const dispatches = JSON.parse(upstreamResponse.headers.get('X-D5-Bridge-Receipts') ?? 'null');
        let outcome = 'non_json'; try { const parsed = JSON.parse(bytes); outcome = parsed.status ?? (parsed.content ? 'content' : 'error'); } catch { /* Receipt stays count-only. */ }
        await receipt({ seq, phase: 'completed', schema, purpose: focused ?? payload.purpose, httpStatus: upstreamResponse.status,
          provider: upstreamResponse.headers.get('X-StudyPlanner-AI-Provider'), outcome, latencyMs: Date.now() - lastSend, dispatches });
        response.writeHead(upstreamResponse.status, { 'Content-Type': 'application/json', 'X-StudyPlanner-AI-Provider': upstreamResponse.headers.get('X-StudyPlanner-AI-Provider') ?? 'unknown' });
        response.end(bytes);
      }).catch(async error => { await receipt({ phase: 'bridge_error', category: error.name }); if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: 'Bounded dev bridge failed; inspect receipt.' })); });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return { url: `http://127.0.0.1:${server.address().port}/chat/completions`, token: localToken, journal,
      async close() { await new Promise(resolve => server.close(resolve)); await chain; try { await worker.stop(); } finally { await rm(directory, { recursive: true, force: true }); } } };
  } catch (error) {
    if (server) await new Promise(resolve => server.close(resolve));
    try { await worker?.stop(); } finally { await rm(directory, { recursive: true, force: true }); }
    throw error;
  }
}
