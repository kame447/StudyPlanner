import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VERIFIED_WRANGLER_VERSION = '4.140.0';
let failureStage = 'startup';

async function loadWrangler() {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    let executable;
    try { executable = await realpath(join(directory, 'wrangler')); } catch { continue; }
    const packageJson = JSON.parse(await readFile(resolve(dirname(executable), '../package.json'), 'utf8'));
    assert.equal(packageJson.version, VERIFIED_WRANGLER_VERSION,
      `Refusing remote evaluation with Wrangler ${String(packageJson.version)}; expected ${VERIFIED_WRANGLER_VERSION}.`);
    return import(pathToFileURL(resolve(dirname(executable), '../wrangler-dist/cli.js')).href);
  }
  throw new Error('Put the verified Wrangler 4.140.0 binary on PATH before running this evaluator.');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const value = (name) => {
    const index = args.indexOf(name);
    return index < 0 ? null : args[index + 1] ?? null;
  };
  const worker = value('--worker');
  const suite = value('--suite');
  const split = value('--split');
  const maxCasesRaw = value('--max-cases');
  if (!worker || !/^[a-zA-Z0-9-]+$/.test(worker)) {
    throw new Error('Pass --worker followed by the existing Worker name.');
  }
  if (suite !== 'corpus' && suite !== 'faults' && suite !== 'luna-baseline') {
    throw new Error('Pass --suite corpus, --suite luna-baseline, or --suite faults.');
  }
  if (suite === 'corpus' && split !== 'tuning' && split !== 'holdout') {
    throw new Error('Corpus evaluation requires --split tuning or --split holdout.');
  }
  if (suite === 'faults' && split !== null) {
    throw new Error('Fault evaluation does not accept --split.');
  }
  if (suite === 'luna-baseline' && split !== 'holdout') {
    throw new Error('The paired Luna baseline is limited to --split holdout.');
  }
  const maxCases = maxCasesRaw === null ? null : Number(maxCasesRaw);
  if (maxCases !== null && (!Number.isSafeInteger(maxCases) || maxCases <= 0 || maxCases > 131)) {
    throw new Error('--max-cases must be an integer from 1 to 131.');
  }
  return { worker, suite, split, maxCases, output: process.env.JEV_FIRST_OUTPUT?.trim() || null };
}

async function main() {
  const options = parseArgs();
  failureStage = 'load_wrangler';
  const { unstable_dev } = await loadWrangler();
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const directory = await mkdtemp(join(tmpdir(), 'studyplanner-jev-first-'));
  const token = randomBytes(32).toString('hex');
  const digest = createHash('sha256').update(token).digest('hex');
  const entry = join(directory, 'evaluation.ts');
  const config = join(directory, 'wrangler.json');
  const providerPath = join(root, 'workers/ai-proxy/src/decision/openRouterDecisionProvider.ts');
  const lunaPath = join(root, 'workers/ai-proxy/src/decision/evaluation/focusedAuthorizationLunaEvaluation.ts');
  const evaluatorPath = join(root, 'workers/ai-proxy/src/decision/evaluation/focusedAuthorizationFirstRouteEvaluation.ts');
  const corpusPath = join(root, 'workers/ai-proxy/src/decision/evaluation/focusedAuthorizationFirstRouteCorpus.ts');
  const fingerprintPath = join(root, 'workers/ai-proxy/src/decision/evaluation/focusedAuthorizationPolicyFingerprint.ts');
  const holdoutArtifactPath = join(
    root,
    'workers/ai-proxy/src/decision/evaluation/evidence/focused-authorization-holdout-20260927.json',
  );
  const recordedHoldoutPolicy = options.split === 'holdout'
    ? JSON.parse(await readFile(holdoutArtifactPath, 'utf8')).policy
    : null;
  let worker;
  try {
    failureStage = 'write_preview_entry';
    await writeFile(entry, `
import { createOpenRouterDecisionProvider } from ${JSON.stringify(providerPath)};
import { createLunaFocusedAuthorizationEvaluator } from ${JSON.stringify(lunaPath)};
import {
  evaluateFocusedAuthorizationLunaBaselineCase,
  evaluateFocusedAuthorizationFirstRouteCase,
  summarizeFocusedAuthorizationLunaBaseline,
  summarizeFocusedAuthorizationFirstRoute,
} from ${JSON.stringify(evaluatorPath)};
import { focusedAuthorizationFirstRouteCorpus } from ${JSON.stringify(corpusPath)};
import { focusedAuthorizationPolicyFingerprints } from ${JSON.stringify(fingerprintPath)};

const expiresAt = ${Date.now() + 3_600_000};
const faultIds = ['timeout', 'http_429', 'http_500', 'malformed', 'model_mismatch', 'provider_abort', 'stale_context'];
const faultCandidate = {
  id: 'fault-control', conversationGroupId: 'fault-control', layer: 'fault_injection', split: 'tuning',
  currentUserText: 'はい、その条件のままで未保存の計画案を作ってください。',
  lastAssistantMessage: '必要な条件はそろいました。この条件で未保存の計画案を作りますか？',
  expected: 'create_plan', labelStatus: 'fault_control',
};

function metadata(id, latencyMs = 0) {
  return {
    provider: 'typesafe', requestedModel: 'fault:' + id, servedModel: id === 'model_mismatch' ? 'unexpected-model' : null,
    latencyMs, inputTokens: null, outputTokens: null, costUsd: null,
    requestBytes: 0, responseBytes: null,
  };
}

function acceptedControl() {
  return {
    status: 'evaluated', decision: 'create_plan', confidence: 0.999,
    probabilities: { create_plan: 0.999, fallback: 0.001 },
    conditionChange: 0.001, independentMeaning: 0.001,
    metadata: metadata('stale_context'),
  };
}

function faultProvider(id) {
  return { async evaluate() {
    if (id === 'timeout') {
      const startedAt = Date.now();
      await new Promise(resolve => setTimeout(resolve, 1_600));
      return { status: 'unavailable', reason: 'timeout', metadata: metadata(id, Date.now() - startedAt) };
    }
    if (id === 'http_429') return { status: 'unavailable', reason: 'http', httpStatus: 429, metadata: metadata(id) };
    if (id === 'http_500') return { status: 'unavailable', reason: 'http', httpStatus: 500, metadata: metadata(id) };
    if (id === 'malformed') return { status: 'unavailable', reason: 'invalid_response', metadata: metadata(id) };
    if (id === 'model_mismatch') return { status: 'unavailable', reason: 'model_mismatch', metadata: metadata(id) };
    if (id === 'provider_abort') return { status: 'unavailable', reason: 'cancelled', metadata: metadata(id) };
    return acceptedControl();
  }};
}

async function authorized(request) {
  if (Date.now() > expiresAt) return false;
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const actual = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
  return actual === ${JSON.stringify(digest)};
}

export default { async fetch(request, env) {
  if (!(await authorized(request))) return new Response('Not found', { status: 404 });
  const url = new URL(request.url);
  const openRouterKey = env.OPENROUTER_API_KEY?.trim();
  const openAiKey = env.OPENAI_API_KEY?.trim();
  if (url.pathname === '/ready') {
    return Response.json({
      openRouterConfigured: Boolean(openRouterKey && /^[!-~]+$/.test(openRouterKey)),
      openAiConfigured: Boolean(openAiKey && /^[!-~]+$/.test(openAiKey)),
    });
  }
  if (url.pathname === '/manifest') {
    const split = url.searchParams.get('split');
    if (split !== 'tuning' && split !== 'holdout') return new Response('Bad request', { status: 400 });
    return Response.json({ ids: focusedAuthorizationFirstRouteCorpus(split).map(value => value.id) });
  }
  if (url.pathname === '/policy-fingerprints') {
    return Response.json(await focusedAuthorizationPolicyFingerprints());
  }
  if (request.method !== 'POST') return new Response('Not found', { status: 404 });
  const body = await request.json();
  const luna = createLunaFocusedAuthorizationEvaluator({ apiKey: openAiKey });
  if (url.pathname === '/case') {
    const all = [...focusedAuthorizationFirstRouteCorpus('tuning'), ...focusedAuthorizationFirstRouteCorpus('holdout')];
    const candidate = all.find(value => value.id === body.id);
    if (!candidate) return new Response('Bad request', { status: 400 });
    const result = await evaluateFocusedAuthorizationFirstRouteCase({
      candidate,
      provider: createOpenRouterDecisionProvider({ apiKey: openRouterKey }),
      luna,
    });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (url.pathname === '/luna-case') {
    const candidate = focusedAuthorizationFirstRouteCorpus('holdout').find(value => value.id === body.id);
    if (!candidate) return new Response('Bad request', { status: 400 });
    const result = await evaluateFocusedAuthorizationLunaBaselineCase({ candidate, luna });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (url.pathname === '/summary') {
    if (!Array.isArray(body.cases)) return new Response('Bad request', { status: 400 });
    return Response.json(summarizeFocusedAuthorizationFirstRoute(body.cases));
  }
  if (url.pathname === '/luna-summary') {
    if (!Array.isArray(body.cases)) return new Response('Bad request', { status: 400 });
    return Response.json(summarizeFocusedAuthorizationLunaBaseline(body.cases));
  }
  if (url.pathname === '/luna-control') {
    const result = await luna.evaluate({
      currentUserText: faultCandidate.currentUserText,
      lastAssistantMessage: faultCandidate.lastAssistantMessage,
    });
    return Response.json({
      status: result.status,
      decision: result.status === 'evaluated' ? result.decision : null,
      reason: result.status === 'evaluated' ? null : result.reason,
      metadata: result.metadata,
    });
  }
  if (url.pathname === '/fault') {
    if (!faultIds.includes(body.id)) return new Response('Bad request', { status: 400 });
    const result = await evaluateFocusedAuthorizationFirstRouteCase({
      candidate: { ...faultCandidate, id: 'fault-' + body.id },
      provider: faultProvider(body.id),
      luna,
      contextCurrent: body.id !== 'stale_context',
    });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (url.pathname === '/both-fail') {
    const unavailableLuna = { async evaluate() {
      return { status: 'unavailable', reason: 'network', metadata: {
        requestedModel: 'gpt-5.6-luna', servedModel: null, latencyMs: 1,
        promptTokens: null, completionTokens: null, costUsd: null,
      }};
    }};
    const result = await evaluateFocusedAuthorizationFirstRouteCase({
      candidate: { ...faultCandidate, id: 'fault-both-provider-failure' },
      provider: faultProvider('http_500'),
      luna: unavailableLuna,
    });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  }
  return new Response('Not found', { status: 404 });
}};
`);
    await writeFile(config, JSON.stringify({
      name: options.worker,
      main: 'evaluation.ts',
      compatibility_date: '2026-04-10',
    }));
    failureStage = 'start_remote_preview';
    worker = await unstable_dev(entry, {
      config, local: false, ip: '127.0.0.1', port: 0, inspect: false, logLevel: 'none',
      experimental: {
        disableExperimentalWarning: true, disableDevRegistry: true, watch: false,
        showInteractiveDevSession: false, enableIpc: false,
      },
    });
    const headers = { Authorization: `Bearer ${token}` };
    failureStage = 'preview_readiness';
    const ready = await worker.fetch('/ready', { headers, signal: AbortSignal.timeout(45_000) });
    assert.equal(ready.status, 200, 'Cloudflare preview readiness failed.');
    const configuration = await ready.json();
    assert.equal(configuration.openRouterConfigured, true, 'Worker OPENROUTER_API_KEY is unavailable.');
    assert.equal(configuration.openAiConfigured, true, 'Worker OPENAI_API_KEY is unavailable.');

    if (options.split === 'holdout') {
      failureStage = 'holdout_policy_guard';
      const policyResponse = await worker.fetch('/policy-fingerprints', {
        headers, signal: AbortSignal.timeout(45_000),
      });
      assert.equal(policyResponse.status, 200, 'Holdout policy fingerprint lookup failed.');
      const currentPolicy = await policyResponse.json();
      assert.deepEqual(currentPolicy, {
        catalogSha256: recordedHoldoutPolicy?.catalogSha256,
        gateSha256: recordedHoldoutPolicy?.gateSha256,
      }, 'Refusing holdout execution because the catalog or gate differs from the recorded evidence.');
    }

    let report;
    if (options.suite === 'corpus') {
      failureStage = `corpus_${options.split}`;
      if (options.split === 'holdout') {
        console.warn(JSON.stringify({
          event: 'jev_first_holdout_opened',
          warning: 'Do not tune the question catalog or gate from this result.',
        }));
      }
      const manifestResponse = await worker.fetch(`/manifest?split=${options.split}`, {
        headers, signal: AbortSignal.timeout(45_000),
      });
      assert.equal(manifestResponse.status, 200, 'Corpus manifest failed.');
      const manifest = await manifestResponse.json();
      const ids = options.maxCases === null ? manifest.ids : manifest.ids.slice(0, options.maxCases);
      const cases = [];
      for (const id of ids) {
        const response = await worker.fetch('/case', {
          method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }), signal: AbortSignal.timeout(120_000),
        });
        assert.equal(response.status, 200, `Remote case failed: ${id}`);
        const result = await response.json();
        cases.push(result);
        console.log(JSON.stringify({ event: 'jev_first_case', ...result }));
      }
      const summaryResponse = await worker.fetch('/summary', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cases }), signal: AbortSignal.timeout(45_000),
      });
      assert.equal(summaryResponse.status, 200, 'Remote summary failed.');
      report = {
        suite: 'corpus', split: options.split, caseCount: cases.length,
        cases, summary: await summaryResponse.json(),
      };
    } else if (options.suite === 'luna-baseline') {
      failureStage = 'luna_baseline_holdout';
      console.warn(JSON.stringify({
        event: 'jev_first_luna_baseline_holdout_opened',
        warning: 'Paired production Luna baseline; do not tune the fixed Jev gate from this result.',
      }));
      const manifestResponse = await worker.fetch('/manifest?split=holdout', {
        headers, signal: AbortSignal.timeout(45_000),
      });
      assert.equal(manifestResponse.status, 200, 'Holdout manifest failed.');
      const manifest = await manifestResponse.json();
      const ids = options.maxCases === null ? manifest.ids : manifest.ids.slice(0, options.maxCases);
      const cases = [];
      for (const id of ids) {
        const response = await worker.fetch('/luna-case', {
          method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }), signal: AbortSignal.timeout(120_000),
        });
        assert.equal(response.status, 200, `Remote Luna baseline case failed: ${id}`);
        const result = await response.json();
        cases.push(result);
        console.log(JSON.stringify({ event: 'jev_first_luna_baseline_case', ...result }));
      }
      const summaryResponse = await worker.fetch('/luna-summary', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cases }), signal: AbortSignal.timeout(45_000),
      });
      assert.equal(summaryResponse.status, 200, 'Remote Luna baseline summary failed.');
      report = {
        suite: 'luna-baseline', split: 'holdout', caseCount: cases.length,
        cases, summary: await summaryResponse.json(),
      };
    } else {
      failureStage = 'fault_luna_control';
      const controlResponse = await worker.fetch('/luna-control', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: '{}', signal: AbortSignal.timeout(120_000),
      });
      assert.equal(controlResponse.status, 200, 'Luna control failed.');
      const lunaControl = await controlResponse.json();
      console.log(JSON.stringify({ event: 'jev_first_luna_control', ...lunaControl }));
      assert.equal(lunaControl.status, 'evaluated', 'Luna control did not produce a decision.');
      const cases = [];
      for (const id of ['timeout', 'http_429', 'http_500', 'malformed', 'model_mismatch', 'provider_abort', 'stale_context']) {
        failureStage = `fault_${id}`;
        const response = await worker.fetch('/fault', {
          method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }), signal: AbortSignal.timeout(120_000),
        });
        assert.equal(response.status, 200, `Remote fault failed: ${id}`);
        const result = await response.json();
        assert.equal(result.luna.called, true, `Luna fallback was not called for ${id}.`);
        assert.equal(result.final.decision, lunaControl.decision,
          `Fallback semantics differed from Luna control for ${id}.`);
        cases.push(result);
        console.log(JSON.stringify({ event: 'jev_first_fault', ...result }));
      }
      failureStage = 'fault_both_providers';
      const bothResponse = await worker.fetch('/both-fail', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: '{}', signal: AbortSignal.timeout(45_000),
      });
      assert.equal(bothResponse.status, 200, 'Both-provider failure injection failed.');
      const bothProvidersFailed = await bothResponse.json();
      assert.equal(bothProvidersFailed.final.status, 'controlled_failure');
      assert.equal(bothProvidersFailed.final.decision, null);
      report = { suite: 'faults', lunaControl, cases, bothProvidersFailed };
    }

    failureStage = 'report';
    console.log(JSON.stringify({ event: 'jev_first_remote_completed', ...report }, null, 2));
    if (options.output) {
      await writeFile(resolve(options.output), `${JSON.stringify(report, null, 2)}\n`);
    }
  } finally {
    try { await worker?.stop(); } finally { await rm(directory, { recursive: true, force: true }); }
  }
}

main().catch((error) => {
  // Provider failures can carry private upstream details; keep terminal output fixed.
  console.error(JSON.stringify({
    event: 'jev_first_remote_failed',
    stage: failureStage,
    errorType: error instanceof Error ? error.name : 'UnknownError',
  }));
  process.exitCode = 1;
});
