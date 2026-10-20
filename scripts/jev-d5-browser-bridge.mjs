import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { appendFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  return `
import worker from ${JSON.stringify(workerPath)};
export { AiQuotaDurableObject } from ${JSON.stringify(workerPath)};
const EXPECTED_DIGEST = ${JSON.stringify(digest)};
const EXPIRES_AT = ${expiresAt};
const RUN_ID = ${JSON.stringify(runId)};
const CAPS = ${JSON.stringify(remaining)};
const bridgeEnvironment = ${d5BridgeEnvironment.toString()};
const upstream = globalThis.fetch.bind(globalThis);
let counters = { jev: 0, luna: 0, reservedUsd: 0 }; let receipts = []; let busy = false;
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('');
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === 'identitytoolkit.googleapis.com' && url.pathname === '/v1/accounts:lookup') {
    return Response.json({ users: [{ localId: 'planner-recovery-owner-' + RUN_ID, emailVerified: true }] });
  }
  const family = url.origin === 'https://openrouter.ai' && url.pathname === '/api/alpha/decisions' ? 'jev'
    : url.origin === 'https://api.openai.com' && url.pathname === '/v1/chat/completions' ? 'luna' : null;
  if (!family) throw new Error('Dev bridge denies non-provider network');
  // Conservative pre-send reservation remains charged even if usage/cost is absent.
  // At <=256KiB input and <=4096 completion tokens this exceeds the repository's
  // Luna text price upper bound; Jev actual reported cost is additionally checked.
  if (counters[family] >= CAPS[family] || counters.reservedUsd + .05 > CAPS.usd + 1e-9) {
    throw new Error('Dev bridge provider budget exhausted');
  }
  counters[family]++; counters.reservedUsd = Math.round((counters.reservedUsd + .05) * 100) / 100;
  const receipt = { family, ordinal: counters[family], phase: 'reserved_before_send', reservedUsd: .05, startedAt: Date.now() };
  receipts.push(receipt);
  const response = await upstream(input, { ...init, redirect: 'error' });
  try {
    const body = await response.clone().json(); const usage = body.usage ?? {};
    const cost = typeof usage.cost === 'number' && Number.isFinite(usage.cost) && usage.cost >= 0 ? usage.cost : null;
    Object.assign(receipt, { phase: 'completed', httpStatus: response.status, latencyMs: Date.now() - receipt.startedAt,
      inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? null, outputTokens: usage.output_tokens ?? usage.completion_tokens ?? null, costUsd: cost });
    if (cost !== null && cost > .05) { counters.reservedUsd += cost - .05; throw new Error('Provider exceeded conservative reservation'); }
  } catch (error) { if (counters.reservedUsd > CAPS.usd) throw error; }
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
    if (new TextEncoder().encode(body).length > 256 * 1024) return new Response('Too large', { status: 413 });
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
    await receipt({ phase: 'ready', workerName, boundary: 'remote-dev-real-worker;synthetic-firebase;local-repository-not-firestore', remainingBudget: remaining, paceMs });
    server = createServer((request, response) => {
      chain = chain.then(async () => {
        if (request.headers.authorization !== `Bearer ${localToken}` || request.method !== 'POST') { response.writeHead(404); response.end(); return; }
        let body = ''; for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 256 * 1024) throw new Error('Oversized loopback request'); }
        const payload = JSON.parse(body); const focused = payload.decisionContext?.purpose;
        const jev = focused ? 1 : 0; const luna = focused === 'candidate_choice' ? 0 : 1;
        const reservation = .05 * (jev + luna);
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
