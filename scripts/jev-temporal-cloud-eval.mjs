import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { access, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VERIFIED_WRANGLER_VERSION = '4.140.0';

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
      `Refusing temporal evaluation with Wrangler ${String(packageJson.version)}; expected ${VERIFIED_WRANGLER_VERSION}.`,
    );
    return import(pathToFileURL(
      resolve(dirname(executable), '../wrangler-dist/cli.js'),
    ).href);
  }
  throw new Error('Put the verified Wrangler 4.140.0 binary on PATH before running this evaluator.');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const value = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const worker = value('--worker');
  const split = value('--split');
  const output = value('--output');
  if (!worker || !/^[a-zA-Z0-9-]+$/.test(worker)) {
    throw new Error('Pass --worker followed by the existing Worker holding provider Secrets.');
  }
  if (split !== 'tuning' && split !== 'holdout' && split !== 'faults') {
    throw new Error('Pass --split tuning, holdout, or faults.');
  }
  if (!output || !output.startsWith('/private/tmp/') || !output.endsWith('.json')) {
    throw new Error('Pass --output as a JSON path under /private/tmp.');
  }
  return { worker, split, output };
}

function binomialCdf(x, n, p) {
  if (p <= 0) return 1;
  if (p >= 1) return x >= n ? 1 : 0;
  let probability = (1 - p) ** n;
  let sum = probability;
  for (let k = 0; k < x; k += 1) {
    probability *= ((n - k) / (k + 1)) * (p / (1 - p));
    sum += probability;
  }
  return Math.min(1, Math.max(0, sum));
}

function clopperPearsonUpper95(errors, total) {
  if (total === 0 || errors >= total) return total === 0 ? null : 1;
  let low = 0;
  let high = 1;
  for (let index = 0; index < 80; index += 1) {
    const middle = (low + high) / 2;
    if (binomialCdf(errors, total, middle) > 0.05) low = middle;
    else high = middle;
  }
  return high;
}

function percentile(values, quantile) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)] ?? null;
}

function cost(records) {
  const lunaWithUsage = records.filter((record) => record.lunaCalled
    && record.lunaPromptTokens !== null
    && record.lunaCompletionTokens !== null);
  const missingUsageCalls = records.filter((record) => record.lunaCalled
    && (record.lunaPromptTokens === null || record.lunaCompletionTokens === null)).length;
  const promptTokens = lunaWithUsage.reduce((sum, record) => sum + record.lunaPromptTokens, 0);
  const completionTokens = lunaWithUsage.reduce((sum, record) =>
    sum + record.lunaCompletionTokens, 0);
  const lunaLowerUsd = (promptTokens * 0.02 + completionTokens * 1.2) / 1_000_000;
  const lunaUpperUsd = (promptTokens * 0.25 + completionTokens * 1.2) / 1_000_000;
  const jevExpected = records.filter((record) => record.providerStatus !== 'not_called');
  const jevKnown = jevExpected.every((record) => record.jevCostUsd !== null);
  const jevReportedUsd = jevKnown
    ? jevExpected.reduce((sum, record) => sum + record.jevCostUsd, 0)
    : null;
  return {
    jev: {
      inputTokens: records.reduce((sum, record) => sum + (record.jevInputTokens ?? 0), 0),
      outputTokens: records.reduce((sum, record) => sum + (record.jevOutputTokens ?? 0), 0),
      reportedCostUsd: jevReportedUsd,
    },
    luna: {
      promptTokens,
      completionTokens,
      knownCalls: lunaWithUsage.length,
      missingUsageCalls,
      lowerUsd: lunaLowerUsd,
      upperUsd: lunaUpperUsd,
    },
    totalKnownRangeUsd: jevReportedUsd === null ? null : {
      lower: jevReportedUsd + lunaLowerUsd,
      upper: jevReportedUsd + lunaUpperUsd,
    },
    perTurnKnownRangeUsd: jevReportedUsd === null || records.length === 0 ? null : {
      lower: (jevReportedUsd + lunaLowerUsd) / records.length,
      upper: (jevReportedUsd + lunaUpperUsd) / records.length,
    },
  };
}

function summarizeRoute(records) {
  const semantic = records.filter((record) => record.split !== 'faults');
  const negative = semantic.filter((record) => record.expected === 'uncertain');
  const falseAccepts = negative.filter((record) => record.finalDecision === 'plan_unavailable');
  const negativeGroups = new Set(negative.map((record) => record.group));
  const falseGroups = new Set(falseAccepts.map((record) => record.group));
  const agreements = semantic.filter((record) => record.finalDecision === record.expected);
  const latencies = records.map((record) => record.totalLatencyMs);
  return {
    route: records[0]?.route ?? null,
    cases: semantic.length,
    conversationGroups: new Set(semantic.map((record) => record.group)).size,
    labelStatus: 'Agreement with synthetic_unreviewed labels; not accuracy or gold.',
    directJevAccepts: records.filter((record) =>
      record.route === 'jev_first' && !record.lunaCalled).length,
    lunaCalls: records.filter((record) => record.lunaCalled).length,
    planUnavailableFalseAccept: {
      cases: falseAccepts.length,
      denominatorCases: negative.length,
      upper95Cases: clopperPearsonUpper95(falseAccepts.length, negative.length),
      groups: falseGroups.size,
      denominatorGroups: negativeGroups.size,
      upper95Groups: clopperPearsonUpper95(falseGroups.size, negativeGroups.size),
      caseIds: falseAccepts.map((record) => record.caseId),
    },
    syntheticLabelAgreement: { count: agreements.length, denominator: semantic.length },
    providerReasons: Object.fromEntries([...new Set(records.map((record) =>
      record.providerReason).filter(Boolean))].map((reason) => [reason, records.filter((record) =>
      record.providerReason === reason).length])),
    containmentErrors: records.filter((record) =>
      record.unexpectedResponseKeys.length > 0
      || record.unexpectedDecisionKeys.length > 0).map((record) => record.caseId),
    latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
    usageAndCost: cost(records),
  };
}

function summarize(split, records) {
  if (split !== 'holdout') return summarizeRoute(records);
  const jevFirst = records.filter((record) => record.route === 'jev_first');
  const lunaOnly = records.filter((record) => record.route === 'luna_only');
  const jevSummary = summarizeRoute(jevFirst);
  const lunaSummary = summarizeRoute(lunaOnly);
  return {
    pairedCases: jevFirst.length,
    jevFirst: jevSummary,
    lunaOnly: lunaSummary,
    pairedObservation: {
      jevFirstFalsePlanUnavailable: jevSummary.planUnavailableFalseAccept.cases,
      lunaOnlyFalsePlanUnavailable: lunaSummary.planUnavailableFalseAccept.cases,
      note: 'One paired run on synthetic_unreviewed labels; not a broad no-degradation claim.',
    },
  };
}

function createWorkerSource(params) {
  return `
import { dispatchTemporalScopeRepair } from ${JSON.stringify(params.dispatchPath)};
import { createOpenRouterDecisionProvider } from ${JSON.stringify(params.providerPath)};
import {
  TEMPORAL_SCOPE_REPAIR_DECISION_CATALOG,
  TEMPORAL_SCOPE_REPAIR_JEV_TIMEOUT_MS,
  gateTemporalScopeRepairDecision,
} from ${JSON.stringify(params.policyPath)};
import {
  FOCUSED_TEMPORAL_SCOPE_REPAIR_MAX_COMPLETION_TOKENS,
  FOCUSED_TEMPORAL_SCOPE_REPAIR_RESPONSE_FORMAT_V5,
  createFocusedTemporalScopeRepairMessagesV5,
} from ${JSON.stringify(params.featurePath)};
import {
  TEMPORAL_SCOPE_REPAIR_CASES,
  validateTemporalScopeRepairCorpus,
} from ${JSON.stringify(params.corpusPath)};
import { assertTemporalScopeRepairHoldoutSeal } from ${JSON.stringify(params.sealPath)};
import { temporalScopeRepairPolicyFingerprints } from ${JSON.stringify(params.fingerprintPath)};

const SPLIT = ${JSON.stringify(params.split)};
const EXPIRES_AT = ${params.expiresAt};
const EXPECTED_DIGEST = ${JSON.stringify(params.digest)};

function faultCases() {
  const definitions = [
    ['fault-abstain', 'abstain'],
    ['fault-conflicting-heads', 'conflicting_heads'],
    ['fault-timeout', 'timeout'],
    ['fault-network', 'network'],
    ['fault-http-429', 'http_429'],
    ['fault-http-500', 'http_500'],
    ['fault-unsupported-output', 'unsupported_output'],
    ['fault-malformed', 'invalid_response'],
    ['fault-model-mismatch', 'model_mismatch'],
    ['fault-provider-abort', 'cancelled'],
  ];
  return definitions.map(([id, fault]) => ({
    id,
    group: id,
    split: 'faults',
    caseClass: 'fault',
    expected: 'uncertain',
    labelSource: 'fault_injection',
    fault,
    state: {
      sourceText: 'この数学だけは火曜18時から20時を避けてください。',
      currentAttachedTask: { title: '数学の問題集' },
      interpretedTime: {
        dateExpression: 'weekday:tuesday',
        namedTimePeriod: null,
        startTime: '18:00',
        endTime: '20:00',
      },
    },
  }));
}

function selectedCases() {
  if (SPLIT === 'faults') return faultCases();
  return TEMPORAL_SCOPE_REPAIR_CASES.filter((item) => item.split === SPLIT);
}

function faultEvaluation(fault) {
  const metadata = {
    provider: 'typesafe', requestedModel: 'fault-injection', servedModel: 'fault-injection',
    latencyMs: 1, inputTokens: null, outputTokens: null, costUsd: null,
    requestBytes: 1, responseBytes: 1,
  };
  if (['timeout', 'network', 'invalid_response', 'model_mismatch', 'cancelled'].includes(fault)) {
    return { status: 'unavailable', reason: fault, metadata };
  }
  if (fault === 'unsupported_output') {
    return { status: 'unavailable', reason: 'invalid_response', metadata };
  }
  if (fault === 'http_429' || fault === 'http_500') {
    return {
      status: 'unavailable', reason: 'http',
      httpStatus: fault === 'http_429' ? 429 : 500, metadata,
    };
  }
  return {
    status: 'evaluated', decision: 'plan_unavailable',
    confidence: fault === 'abstain' ? 0.5 : 0.999,
    probabilities: { plan_unavailable: 0.999, uncertain: 0.001 },
    conditionChange: fault === 'conflicting_heads' ? 0.9 : 0.001,
    independentMeaning: 0.001,
    metadata,
  };
}

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0')).join('');
}

function safeUsage(value) {
  if (!value || typeof value !== 'object') return { prompt: null, completion: null };
  return {
    prompt: Number.isSafeInteger(value.prompt_tokens) && value.prompt_tokens >= 0
      ? value.prompt_tokens : null,
    completion: Number.isSafeInteger(value.completion_tokens) && value.completion_tokens >= 0
      ? value.completion_tokens : null,
  };
}

function candidate(item) {
  return {
    taskIndex: 0,
    constraintIndex: 0,
    taskTitle: item.state.currentAttachedTask.title,
    taskLocalId: 'evaluation-task',
    constraintLocalId: 'evaluation-constraint',
    sourceText: item.state.sourceText,
    dateExpression: item.state.interpretedTime.dateExpression,
    namedTimePeriod: item.state.interpretedTime.namedTimePeriod,
    startTime: item.state.interpretedTime.startTime,
    endTime: item.state.interpretedTime.endTime,
    constraintLevel: 'hard',
  };
}

async function runCase(item, env, requestSignal, lunaOnly) {
  const startedAt = Date.now();
  const context = {
    purpose: 'temporal_scope_repair',
    requestId: 'temporal-eval-' + item.id,
    inputRevision: 31,
    state: item.state,
  };
  const messages = createFocusedTemporalScopeRepairMessagesV5(candidate(item));
  let evaluation = null;
  let lunaCalled = false;
  let lunaStatus = null;
  let lunaUsage = { prompt: null, completion: null };
  let lunaLatencyMs = null;
  const realProvider = createOpenRouterDecisionProvider({
    apiKey: env.OPENROUTER_API_KEY,
    timeoutMs: TEMPORAL_SCOPE_REPAIR_JEV_TIMEOUT_MS,
    catalog: TEMPORAL_SCOPE_REPAIR_DECISION_CATALOG,
  });
  const provider = {
    async evaluate(state, signal) {
      evaluation = item.fault
        ? faultEvaluation(item.fault)
        : await realProvider.evaluate(state, signal);
      return evaluation;
    },
  };
  const fallback = async (signal) => {
    lunaCalled = true;
    const lunaStartedAt = Date.now();
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + String(env.OPENAI_API_KEY ?? '').trim(),
      },
      body: JSON.stringify({
        model: 'gpt-5.6-luna',
        messages,
        response_format: FOCUSED_TEMPORAL_SCOPE_REPAIR_RESPONSE_FORMAT_V5,
        max_completion_tokens: FOCUSED_TEMPORAL_SCOPE_REPAIR_MAX_COMPLETION_TOKENS,
      }),
    });
    lunaLatencyMs = Math.max(0, Date.now() - lunaStartedAt);
    lunaStatus = upstream.status;
    if (!upstream.ok) return Response.json({ error: 'Luna request failed.' }, { status: 502 });
    const payload = await upstream.json();
    const content = payload?.choices?.[0]?.message?.content?.trim();
    if (!content) return Response.json({ error: 'Luna response was empty.' }, { status: 502 });
    lunaUsage = safeUsage(payload.usage);
    return Response.json({ content, usage: payload.usage });
  };
  const response = await dispatchTemporalScopeRepair({
    context,
    env: lunaOnly ? { ...env, JEV_MODE: 'off' } : env,
    firebaseUid: 'temporal-evaluation',
    signal: requestSignal,
    fallback,
    respond: (decision) => Response.json({
      content: JSON.stringify(decision),
      decisionContext: { requestId: context.requestId, inputRevision: context.inputRevision },
    }),
    provider,
  });
  if (!response.ok) throw new Error('Temporal dispatch failed.');
  const proxyPayload = await response.json();
  const final = JSON.parse(String(proxyPayload.content ?? ''));
  const gate = evaluation ? gateTemporalScopeRepairDecision(evaluation) : null;
  const allowedResponseKeys = new Set(['content', 'decisionContext', 'usage']);
  const allowedDecisionKeys = new Set(['decision']);
  if (final.decision !== 'plan_unavailable' && final.decision !== 'uncertain') {
    throw new Error('Temporal decision was outside the closed set.');
  }
  return {
    caseId: item.id,
    group: item.group,
    split: item.split,
    caseClass: item.caseClass,
    labelSource: item.labelSource,
    expected: item.expected,
    route: lunaOnly ? 'luna_only' : 'jev_first',
    providerStatus: evaluation?.status ?? 'not_called',
    providerReason: evaluation?.status === 'unavailable' ? evaluation.reason : null,
    providerHttpStatus: evaluation?.status === 'unavailable' && evaluation.reason === 'http'
      ? evaluation.httpStatus ?? null : null,
    rawChoice: evaluation?.status === 'evaluated' ? evaluation.decision : null,
    confidence: evaluation?.status === 'evaluated' ? evaluation.confidence : null,
    selectedProbability: evaluation?.status === 'evaluated'
      ? evaluation.probabilities[evaluation.decision] : null,
    conditionChange: evaluation?.status === 'evaluated' ? evaluation.conditionChange : null,
    independentMeaning: evaluation?.status === 'evaluated' ? evaluation.independentMeaning : null,
    gate,
    lunaCalled,
    lunaStatus,
    finalDecision: final.decision,
    unexpectedResponseKeys: Object.keys(proxyPayload).filter((key) => !allowedResponseKeys.has(key)),
    unexpectedDecisionKeys: Object.keys(final).filter((key) => !allowedDecisionKeys.has(key)),
    totalLatencyMs: Math.max(0, Date.now() - startedAt),
    jevLatencyMs: evaluation?.metadata?.latencyMs ?? null,
    jevInputTokens: evaluation?.metadata?.inputTokens ?? null,
    jevOutputTokens: evaluation?.metadata?.outputTokens ?? null,
    jevCostUsd: evaluation?.metadata?.costUsd ?? null,
    lunaLatencyMs,
    lunaPromptTokens: lunaUsage.prompt,
    lunaCompletionTokens: lunaUsage.completion,
  };
}

export default {
  async fetch(request, env) {
    if (Date.now() > EXPIRES_AT) return new Response('Not found', { status: 404 });
    const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
    if (await digest(token) !== EXPECTED_DIGEST) return new Response('Not found', { status: 404 });
    validateTemporalScopeRepairCorpus();
    if (SPLIT === 'holdout') await assertTemporalScopeRepairHoldoutSeal();
    const cases = selectedCases();
    if (request.method === 'GET') {
      return Response.json({
        openRouter: Boolean(env.OPENROUTER_API_KEY?.trim()),
        openAi: Boolean(env.OPENAI_API_KEY?.trim()),
        caseCount: cases.length,
        fingerprints: await temporalScopeRepairPolicyFingerprints(),
      });
    }
    if (request.method !== 'POST') return new Response('Not found', { status: 404 });
    const body = await request.json();
    if (!body || typeof body !== 'object'
      || !Number.isSafeInteger(body.index)
      || body.index < 0 || body.index >= cases.length
      || typeof body.lunaOnly !== 'boolean'
      || Object.keys(body).some((key) => key !== 'index' && key !== 'lunaOnly')) {
      return new Response('Invalid request', { status: 400 });
    }
    try {
      return Response.json(await runCase(cases[body.index], env, request.signal, body.lunaOnly), {
        headers: { 'Cache-Control': 'no-store' },
      });
    } catch {
      return Response.json({ error: 'Temporal evaluation case failed.' }, { status: 500 });
    }
  },
};
`;
}

async function main() {
  const { worker: workerName, split, output } = parseArgs();
  try {
    await access(output);
    throw new Error(`Refusing to overwrite existing evidence output: ${output}`);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      // Expected: each evaluation run creates one new immutable output file.
    } else {
      throw error;
    }
  }
  const { unstable_dev } = await loadWrangler();
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const directory = await mkdtemp(join(tmpdir(), 'studyplanner-jev-temporal-'));
  const token = randomBytes(32).toString('hex');
  const digest = createHash('sha256').update(token).digest('hex');
  const entry = join(directory, 'temporal-eval.ts');
  const config = join(directory, 'wrangler.json');
  let worker;
  try {
    await writeFile(entry, createWorkerSource({
      split,
      digest,
      expiresAt: Date.now() + 15 * 60_000,
      dispatchPath: join(root, 'workers/ai-proxy/src/decision/temporalScopeRepairDispatch.ts'),
      providerPath: join(root, 'workers/ai-proxy/src/decision/openRouterDecisionProvider.ts'),
      policyPath: join(root, 'workers/ai-proxy/src/decision/temporalScopeRepairDecisionPolicy.ts'),
      featurePath: join(root, 'src/features/weeklyPlanning/semantic/weeklyPlanningFocusedTemporalScopeRepairV5.ts'),
      corpusPath: join(root, 'workers/ai-proxy/src/decision/evaluation/temporalScopeRepairCorpus.ts'),
      sealPath: join(root, 'workers/ai-proxy/src/decision/evaluation/temporalScopeRepairHoldoutSeal.ts'),
      fingerprintPath: join(root, 'workers/ai-proxy/src/decision/evaluation/temporalScopeRepairPolicyFingerprint.ts'),
    }));
    await writeFile(config, JSON.stringify({
      name: workerName,
      main: 'temporal-eval.ts',
      compatibility_date: '2026-04-10',
      vars: { JEV_MODE: 'canary', JEV_CANARY_PERCENT: '100' },
    }));
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
    assert.equal(ready.status, 200, 'Cloudflare temporal preview readiness failed.');
    const readiness = await ready.json();
    assert.equal(readiness.openRouter, true, 'OPENROUTER_API_KEY is unavailable.');
    assert.equal(readiness.openAi, true, 'OPENAI_API_KEY is unavailable.');
    assert.ok(Number.isSafeInteger(readiness.caseCount) && readiness.caseCount > 0);

    const records = [];
    const routes = split === 'holdout' ? [false, true] : [false];
    for (const lunaOnly of routes) {
      for (let index = 0; index < readiness.caseCount; index += 1) {
        const response = await worker.fetch('/case', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ index, lunaOnly }),
          signal: AbortSignal.timeout(95_000),
        });
        if (response.status !== 200) {
          throw new Error(
            `Temporal case index ${index} (${lunaOnly ? 'luna_only' : 'jev_first'}) failed with status ${response.status}.`,
          );
        }
        records.push(await response.json());
        if (records.length % 10 === 0) {
          console.info(JSON.stringify({ stage: 'cases', completed: records.length }));
        }
      }
    }
    const result = {
      schemaVersion: 'temporal-scope-repair-evidence-v1',
      generatedAt: new Date().toISOString(),
      split,
      fingerprints: readiness.fingerprints,
      summary: summarize(split, records),
      records,
    };
    await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    console.info(JSON.stringify({
      output,
      split,
      fingerprints: readiness.fingerprints,
      summary: result.summary,
    }, null, 2));
  } finally {
    try { await worker?.stop(); } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  const controlledMessage = error instanceof Error
    ? error.message.replace(/[\r\n]+/g, ' ').slice(0, 240)
    : 'unknown controlled failure';
  console.error(`Jev temporal Cloudflare evaluation failed: ${controlledMessage}. Raw provider data is intentionally suppressed.`);
  process.exitCode = 1;
});
