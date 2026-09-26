import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function loadWrangler() {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    let executable;
    try { executable = await realpath(join(directory, 'wrangler')); } catch { continue; }
    return import(pathToFileURL(resolve(dirname(executable), '../wrangler-dist/cli.js')).href);
  }
  throw new Error('Run through npm exec --package=wrangler@4.140.0 so Wrangler is available.');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--worker' || !/^[a-zA-Z0-9-]+$/.test(args[1])) {
    throw new Error('Pass --worker followed by the existing Worker that holds OPENROUTER_API_KEY.');
  }
  const { unstable_dev } = await loadWrangler();
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const directory = await mkdtemp(join(tmpdir(), 'studyplanner-jev-smoke-'));
  const token = randomBytes(32).toString('hex');
  const digest = createHash('sha256').update(token).digest('hex');
  const entry = join(directory, 'smoke.ts');
  const config = join(directory, 'wrangler.json');
  const adapter = join(root, 'workers/ai-proxy/src/decision/openRouterDecisionProvider.ts');
  const policy = join(root, 'workers/ai-proxy/src/decision/decisionPolicy.ts');
  let worker;
  try {
    await writeFile(entry, `
import { createOpenRouterDecisionProvider } from ${JSON.stringify(adapter)};
import { gateDecision } from ${JSON.stringify(policy)};
export default { async fetch(request, env) {
  if (Date.now() > ${Date.now() + 180_000}) return new Response('Not found', { status: 404 });
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const digest = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
  if (digest !== ${JSON.stringify(digest)}) return new Response('Not found', { status: 404 });
  const key = env.OPENROUTER_API_KEY?.trim();
  if (request.method === 'GET') return Response.json({ configured: Boolean(key && /^[!-~]+$/.test(key)) });
  if (request.method !== 'POST') return new Response('Not found', { status: 404 });
  const result = await createOpenRouterDecisionProvider({ apiKey: key }).evaluate({
    currentUserText: 'はい、その条件のままで計画案を作ってください。',
    lastAssistantMessage: '必要な学習内容と条件はそろいました。この条件で未保存の計画案を作りますか？',
  });
  return Response.json({ result, gate: gateDecision(result) }, { headers: { 'Cache-Control': 'no-store' } });
}};
`);
    await writeFile(config, JSON.stringify({ name: args[1], main: 'smoke.ts', compatibility_date: '2026-04-10' }));
    worker = await unstable_dev(entry, {
      config, local: false, ip: '127.0.0.1', port: 0, inspect: false, logLevel: 'none',
      experimental: { disableExperimentalWarning: true, disableDevRegistry: true,
        watch: false, showInteractiveDevSession: false, enableIpc: false },
    });
    const headers = { Authorization: `Bearer ${token}` };
    const ready = await worker.fetch('/ready', { headers, signal: AbortSignal.timeout(45_000) });
    assert.equal(ready.status, 200, 'Cloudflare preview readiness failed.');
    assert.equal((await ready.json()).configured, true, 'Worker secret is missing or has an invalid input format.');
    const response = await worker.fetch('/test', { method: 'POST', headers, signal: AbortSignal.timeout(20_000) });
    assert.equal(response.status, 200, 'Cloudflare smoke request failed.');
    const { result, gate } = await response.json();
    console.info(JSON.stringify({ status: result.status, ...result.metadata,
      decision: result.status === 'evaluated' ? result.decision : null,
      reason: result.status === 'unavailable' ? result.reason : null, gate }));
    assert.equal(result.status, 'evaluated', 'Jev did not return a validated decision.');
    assert.equal(result.decision, 'create_plan', 'Jev did not select the expected decision.');
    assert.ok(result.probabilities.create_plan > result.probabilities.fallback);
    assert.notEqual(result.metadata.inputTokens, null, 'Jev usage was missing.');
  } finally {
    try { await worker?.stop(); } finally { await rm(directory, { recursive: true, force: true }); }
  }
}

main().catch(() => {
  // Upstream errors can include headers or provider text; keep the failure report fixed.
  console.error('Jev Cloudflare smoke failed. Check Wrangler login, Worker secret and the safe result above.');
  process.exitCode = 1;
});
