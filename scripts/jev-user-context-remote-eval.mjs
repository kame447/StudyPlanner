import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VERIFIED_WRANGLER_VERSION = '4.140.0';
const EVIDENCE_DIRECTORY = 'workers/ai-proxy/src/decision/evaluation/evidence';
const OUTPUTS = {
  tuning: `${EVIDENCE_DIRECTORY}/user-context-routing-tuning-20260927.json`,
  holdout: `${EVIDENCE_DIRECTORY}/user-context-routing-holdout-20260927.json`,
  'luna-baseline': `${EVIDENCE_DIRECTORY}/user-context-routing-luna-baseline-20260927.json`,
  faults: `${EVIDENCE_DIRECTORY}/user-context-routing-faults-20260927.json`,
};
let failureStage = 'startup';

async function loadWrangler() {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    let executable;
    try { executable = await realpath(join(directory, 'wrangler')); } catch { continue; }
    const packageJson = JSON.parse(await readFile(
      resolve(dirname(executable), '../package.json'),
      'utf8',
    ));
    assert.equal(
      packageJson.version,
      VERIFIED_WRANGLER_VERSION,
      `Refusing user-context evaluation with Wrangler ${String(packageJson.version)}; expected ${VERIFIED_WRANGLER_VERSION}.`,
    );
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
  const maxCasesRaw = value('--max-cases');
  if (!worker || !/^[a-zA-Z0-9-]+$/.test(worker)) {
    throw new Error('Pass --worker followed by the existing Worker name.');
  }
  if (!['tuning', 'holdout', 'luna-baseline', 'faults'].includes(suite)) {
    throw new Error('Pass --suite tuning, holdout, luna-baseline, or faults.');
  }
  const maxCases = maxCasesRaw === null ? null : Number(maxCasesRaw);
  if (maxCases !== null && (
    suite !== 'tuning'
    || !Number.isSafeInteger(maxCases)
    || maxCases <= 0
    || maxCases > 52
  )) {
    throw new Error('--max-cases is allowed only for tuning and must be from 1 to 52.');
  }
  return { worker, suite, maxCases };
}

async function atomicJsonWrite(path, value) {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  await rename(temporary, path);
}

function createWorkerSource(paths, digest) {
  return `
import { createOpenRouterDecisionProvider } from ${JSON.stringify(paths.provider)};
import {
  evaluateUserContextRoutingCase,
  evaluateUserContextRoutingLunaBaseline,
  summarizeUserContextRouting,
  summarizeUserContextRoutingLunaBaseline,
  compareUserContextRoutingPaired,
} from ${JSON.stringify(paths.evaluation)};
import { userContextRoutingCorpus } from ${JSON.stringify(paths.corpus)};
import { createUserContextRoutingLunaEvaluator } from ${JSON.stringify(paths.luna)};
import { userContextRoutingPolicyFingerprints } from ${JSON.stringify(paths.fingerprint)};
import {
  USER_CONTEXT_ROUTING_DECISION_CATALOG,
  USER_CONTEXT_ROUTING_JEV_TIMEOUT_MS,
} from ${JSON.stringify(paths.policy)};

const expiresAt = ${Date.now() + 3_600_000};
const expectedDigest = ${JSON.stringify(digest)};
const faultIds = [
  'low_confidence', 'user_context', 'mixed_heads', 'timeout', 'http_429',
  'http_500', 'malformed', 'model_mismatch', 'provider_abort',
];
const faultCandidate = {
  id: 'user-context-routing-fault-control',
  conversationGroupId: 'user-context-routing-fault-control',
  split: 'tuning',
  evaluationClass: 'security_negative',
  currentUserText: '数学では図形問題がずっと苦手です。',
  expectedRoute: 'luna',
  expectedTargetDomain: 'user_context',
  labelStatus: 'synthetic_unreviewed',
};

function metadata(id, latencyMs = 0) {
  return {
    provider: 'typesafe', requestedModel: 'fault:' + id,
    servedModel: id === 'model_mismatch' ? 'unexpected-model' : 'fault:' + id,
    latencyMs, inputTokens: null, outputTokens: null, costUsd: null,
    requestBytes: 0, responseBytes: null,
  };
}

function evaluated(decision, options = {}) {
  const selected = options.selectedProbability ?? 0.995;
  const remainder = (1 - selected) / 5;
  return {
    status: 'evaluated', decision, confidence: options.confidence ?? 0.999,
    probabilities: {
      user_context: decision === 'user_context' ? selected : remainder,
      bookshelf: decision === 'bookshelf' ? selected : remainder,
      timetable: decision === 'timetable' ? selected : remainder,
      schedule: decision === 'schedule' ? selected : remainder,
      actual: decision === 'actual' ? selected : remainder,
      uncertain: decision === 'uncertain' ? selected : remainder,
    },
    conditionChange: options.multipleDomains ?? 0.001,
    independentMeaning: options.independentMeaning ?? 0.001,
    metadata: metadata(options.id ?? decision),
  };
}

function faultProvider(id) {
  return { async evaluate() {
    if (id === 'low_confidence') return evaluated('bookshelf', { confidence: 0.5, id });
    if (id === 'user_context') return evaluated('user_context', { id });
    if (id === 'mixed_heads') return evaluated('schedule', { multipleDomains: 0.99, id });
    if (id === 'timeout') {
      const startedAt = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 1_600));
      return { status: 'unavailable', reason: 'timeout', metadata: metadata(id, Date.now() - startedAt) };
    }
    if (id === 'http_429' || id === 'http_500') {
      return {
        status: 'unavailable', reason: 'http',
        httpStatus: id === 'http_429' ? 429 : 500, metadata: metadata(id),
      };
    }
    if (id === 'malformed') {
      return { status: 'unavailable', reason: 'invalid_response', metadata: metadata(id) };
    }
    if (id === 'model_mismatch') {
      return { status: 'unavailable', reason: 'model_mismatch', metadata: metadata(id) };
    }
    return { status: 'unavailable', reason: 'cancelled', metadata: metadata(id) };
  }};
}

async function authorized(request) {
  if (Date.now() > expiresAt) return false;
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const actual = Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0')).join('');
  return actual === expectedDigest;
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
  if (url.pathname === '/fingerprints') {
    return Response.json(await userContextRoutingPolicyFingerprints());
  }
  if (url.pathname === '/manifest') {
    const split = url.searchParams.get('split');
    if (split !== 'tuning' && split !== 'holdout') return new Response('Bad request', { status: 400 });
    return Response.json({ ids: userContextRoutingCorpus(split).map((item) => item.id) });
  }
  if (request.method !== 'POST') return new Response('Not found', { status: 404 });
  const body = await request.json();
  const luna = createUserContextRoutingLunaEvaluator({ apiKey: openAiKey });
  if (url.pathname === '/case') {
    const all = [...userContextRoutingCorpus('tuning'), ...userContextRoutingCorpus('holdout')];
    const candidate = all.find((item) => item.id === body.id);
    if (!candidate) return new Response('Bad request', { status: 400 });
    return Response.json(await evaluateUserContextRoutingCase({
      candidate,
      provider: createOpenRouterDecisionProvider({
        apiKey: openRouterKey,
        timeoutMs: USER_CONTEXT_ROUTING_JEV_TIMEOUT_MS,
        catalog: USER_CONTEXT_ROUTING_DECISION_CATALOG,
      }),
      luna,
    }), { headers: { 'Cache-Control': 'no-store' } });
  }
  if (url.pathname === '/luna-case') {
    const candidate = userContextRoutingCorpus('holdout').find((item) => item.id === body.id);
    if (!candidate) return new Response('Bad request', { status: 400 });
    return Response.json(await evaluateUserContextRoutingLunaBaseline({ candidate, luna }), {
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  if (url.pathname === '/fault') {
    if (!faultIds.includes(body.id)) return new Response('Bad request', { status: 400 });
    return Response.json(await evaluateUserContextRoutingCase({
      candidate: { ...faultCandidate, id: 'fault-' + body.id },
      provider: faultProvider(body.id),
      luna,
    }), { headers: { 'Cache-Control': 'no-store' } });
  }
  if (url.pathname === '/summary') {
    return Response.json(summarizeUserContextRouting(body.cases));
  }
  if (url.pathname === '/luna-summary') {
    return Response.json(summarizeUserContextRoutingLunaBaseline(body.cases));
  }
  if (url.pathname === '/paired') {
    return Response.json(compareUserContextRoutingPaired(body.firstRoute, body.lunaOnly));
  }
  return new Response('Not found', { status: 404 });
}};
`;
}

async function postJson(worker, path, headers, body, timeoutMs = 95_000) {
  const response = await worker.fetch(path, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  assert.equal(response.status, 200, `Remote evaluation failed at ${path}.`);
  return response.json();
}

async function main() {
  const options = parseArgs();
  failureStage = 'load_wrangler';
  const { unstable_dev } = await loadWrangler();
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const outputPath = resolve(root, OUTPUTS[options.suite]);
  const sealPath = resolve(root, OUTPUTS.holdout);
  const seal = options.suite === 'holdout' ? JSON.parse(await readFile(sealPath, 'utf8')) : null;
  if (seal) {
    assert.equal(seal.status, 'sealed_unconsumed', 'Holdout is not sealed and unconsumed.');
    assert.equal(seal.consumed, false, 'Holdout has already been consumed.');
    assert.equal(seal.createdBeforeTuning, true, 'Holdout was not sealed before tuning.');
  }

  const directory = await mkdtemp(join(tmpdir(), 'studyplanner-jev-user-context-'));
  const token = randomBytes(32).toString('hex');
  const digest = createHash('sha256').update(token).digest('hex');
  const entry = join(directory, 'evaluation.ts');
  const config = join(directory, 'wrangler.json');
  const paths = {
    provider: join(root, 'workers/ai-proxy/src/decision/openRouterDecisionProvider.ts'),
    evaluation: join(root, 'workers/ai-proxy/src/decision/evaluation/userContextRoutingEvaluation.ts'),
    corpus: join(root, 'workers/ai-proxy/src/decision/evaluation/userContextRoutingCorpus.ts'),
    luna: join(root, 'workers/ai-proxy/src/decision/evaluation/userContextRoutingLunaEvaluation.ts'),
    fingerprint: join(root, 'workers/ai-proxy/src/decision/evaluation/userContextRoutingPolicyFingerprint.ts'),
    policy: join(root, 'workers/ai-proxy/src/decision/userContextRoutingPolicy.ts'),
  };
  let worker;
  try {
    failureStage = 'write_preview_entry';
    await writeFile(entry, createWorkerSource(paths, digest));
    await writeFile(config, JSON.stringify({
      name: options.worker,
      main: 'evaluation.ts',
      compatibility_date: '2026-04-10',
    }));
    failureStage = 'start_remote_preview';
    worker = await unstable_dev(entry, {
      config,
      local: false,
      ip: '127.0.0.1',
      port: 0,
      inspect: false,
      logLevel: 'none',
      experimental: {
        disableExperimentalWarning: true,
        disableDevRegistry: true,
        watch: false,
        showInteractiveDevSession: false,
        enableIpc: false,
      },
    });
    const headers = { Authorization: `Bearer ${token}` };
    const ready = await worker.fetch('/ready', {
      headers,
      signal: AbortSignal.timeout(45_000),
    });
    assert.equal(ready.status, 200, 'Cloudflare preview readiness failed.');
    assert.deepEqual(await ready.json(), {
      openRouterConfigured: true,
      openAiConfigured: true,
    });

    const fingerprintResponse = await worker.fetch('/fingerprints', { headers });
    assert.equal(fingerprintResponse.status, 200);
    const fingerprints = await fingerprintResponse.json();
    if (seal) assert.deepEqual(fingerprints, {
      catalogSha256: seal.policy.catalogSha256,
      gateSha256: seal.policy.gateSha256,
      corpusSha256: seal.policy.corpusSha256,
    }, 'Holdout policy/corpus fingerprint mismatch.');

    let cases = [];
    let summary;
    let paired = null;
    if (options.suite === 'faults') {
      const faultIds = [
        'low_confidence', 'user_context', 'mixed_heads', 'timeout', 'http_429',
        'http_500', 'malformed', 'model_mismatch', 'provider_abort',
      ];
      for (const id of faultIds) {
        failureStage = `fault:${id}`;
        cases.push(await postJson(worker, '/fault', headers, { id }));
      }
      summary = await postJson(worker, '/summary', headers, { cases });
    } else {
      const split = options.suite === 'tuning' ? 'tuning' : 'holdout';
      const manifestResponse = await worker.fetch(`/manifest?split=${split}`, { headers });
      assert.equal(manifestResponse.status, 200);
      let ids = (await manifestResponse.json()).ids;
      if (options.maxCases !== null) ids = ids.slice(0, options.maxCases);
      const endpoint = options.suite === 'luna-baseline' ? '/luna-case' : '/case';
      for (const id of ids) {
        failureStage = `${options.suite}:${id}`;
        cases.push(await postJson(worker, endpoint, headers, { id }));
      }
      summary = await postJson(
        worker,
        options.suite === 'luna-baseline' ? '/luna-summary' : '/summary',
        headers,
        { cases },
      );
      if (options.suite === 'luna-baseline') {
        const holdoutArtifact = JSON.parse(await readFile(sealPath, 'utf8'));
        assert.equal(holdoutArtifact.status, 'consumed', 'Run the sealed Jev-first holdout first.');
        paired = await postJson(worker, '/paired', headers, {
          firstRoute: holdoutArtifact.cases,
          lunaOnly: cases,
        });
      }
    }

    const now = new Date().toISOString();
    const artifact = options.suite === 'holdout'
      ? {
          ...seal,
          status: 'consumed',
          consumed: true,
          consumedAt: now,
          policy: {
            ...seal.policy,
            ...fingerprints,
          },
          rawTextIncluded: false,
          summary,
          cases,
        }
      : {
          schemaVersion: 1,
          artifactKind: `user_context_routing_${options.suite}`,
          corpusVersion: 'user-context-routing-corpus-2026-09-27-v1',
          executedAt: now,
          policy: fingerprints,
          rawTextIncluded: false,
          summary,
          ...(paired === null ? {} : { paired }),
          cases,
        };
    failureStage = 'write_typed_evidence';
    await atomicJsonWrite(outputPath, artifact);
    console.info(JSON.stringify({
      output: OUTPUTS[options.suite],
      summary,
      ...(paired === null ? {} : { paired }),
    }, null, 2));
  } finally {
    try { await worker?.stop(); } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

main().catch(() => {
  console.error(`Jev user-context remote evaluation failed at ${failureStage}. Raw provider data is intentionally suppressed.`);
  process.exitCode = 1;
});
