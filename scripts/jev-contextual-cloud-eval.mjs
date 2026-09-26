import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  JEV_CONTEXTUAL_CASES,
  JEV_CONTEXTUAL_CORPUS_VERSION,
} from './jev-contextual-corpus.mjs';

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
      `Refusing contextual evaluation with Wrangler ${String(packageJson.version)}; expected ${VERIFIED_WRANGLER_VERSION}.`,
    );
    return import(pathToFileURL(
      resolve(dirname(executable), '../wrangler-dist/cli.js'),
    ).href);
  }
  throw new Error('Put the verified Wrangler 4.140.0 binary on PATH before running this evaluator.');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const workerIndex = args.indexOf('--worker');
  const splitIndex = args.indexOf('--split');
  const worker = workerIndex >= 0 ? args[workerIndex + 1] : undefined;
  const split = splitIndex >= 0 ? args[splitIndex + 1] : undefined;
  if (!worker || !/^[a-zA-Z0-9-]+$/.test(worker)) {
    throw new Error('Pass --worker followed by the existing Worker holding provider Secrets.');
  }
  if (split !== 'tuning' && split !== 'holdout'
    && split !== 'luna-baseline' && split !== 'faults') {
    throw new Error('Pass --split tuning, holdout, luna-baseline, or faults.');
  }
  return { worker, split };
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

function faultCases() {
  return [
    { id: 'ctx-fault-abstain', fault: 'abstain' },
    { id: 'ctx-fault-timeout', fault: 'timeout' },
    { id: 'ctx-fault-http-429', fault: 'http_429' },
    { id: 'ctx-fault-http-500', fault: 'http_500' },
    { id: 'ctx-fault-malformed', fault: 'invalid_response' },
    { id: 'ctx-fault-model-mismatch', fault: 'model_mismatch' },
    { id: 'ctx-fault-provider-abort', fault: 'cancelled' },
    { id: 'ctx-fault-stale-revision', fault: 'stale_context' },
    { id: 'ctx-fault-cross-question', fault: 'cross_question' },
  ].map((item) => ({
    ...item,
    group: item.id,
    split: 'faults',
    questionCode: item.fault === 'cross_question'
      ? 'missing_effort_estimate'
      : 'quantity_role_unresolved',
    userText: item.fault === 'cross_question'
      ? '全部で30分くらいです。'
      : '残っている分です。',
    expectedBoundary: 'focused_luna',
  }));
}

function percentile(values, quantile) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)] ?? null;
}

function finalMatchesSyntheticBoundary(record) {
  if (record.expectedBoundary === 'quantity_role_answer') {
    return record.finalDecision === 'quantity_role_answer'
      && record.finalQuantityRole === record.expectedQuantityRole;
  }
  if (record.expectedBoundary === 'generic_semantic') {
    return record.finalDecision === 'fallback';
  }
  return record.lunaCalled === true;
}

function summarizeLunaBaseline(records) {
  const errors = records.filter((record) => !finalMatchesSyntheticBoundary(record));
  const latencies = records.map((record) => record.lunaLatencyMs)
    .filter((value) => typeof value === 'number');
  return {
    corpusVersion: JEV_CONTEXTUAL_CORPUS_VERSION,
    split: 'luna-baseline',
    cases: records.length,
    conversationGroups: new Set(records.map((record) => record.group)).size,
    labelStatus: 'synthetic_unreviewed',
    generatedLlmCalls: records.filter((record) => record.lunaCalled).length,
    finalBoundaryErrors: {
      count: errors.length,
      denominator: records.length,
      caseIds: errors.map((record) => record.caseId),
      upper95: clopperPearsonUpper95(errors.length, records.length),
    },
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
    },
    usage: {
      promptTokens: records.reduce((sum, record) => sum + (record.lunaPromptTokens ?? 0), 0),
      completionTokens: records.reduce((sum, record) =>
        sum + (record.lunaCompletionTokens ?? 0), 0),
      costUsd: null,
    },
  };
}

function summarize(records) {
  const semanticRecords = records.filter((record) => record.split !== 'faults');
  const quantityAccepted = semanticRecords.filter((record) =>
    record.lunaCalled === false && record.finalDecision === 'quantity_role_answer');
  const quantityRoleFalseAccept = quantityAccepted.filter((record) =>
    record.expectedBoundary !== 'quantity_role_answer'
    || record.finalQuantityRole !== record.expectedQuantityRole);
  const expectedQuantity = semanticRecords.filter((record) =>
    record.expectedBoundary === 'quantity_role_answer');
  const expectedFocusedLuna = semanticRecords.filter((record) =>
    record.expectedBoundary === 'focused_luna');
  const expectedGeneric = semanticRecords.filter((record) =>
    record.expectedBoundary === 'generic_semantic');
  const correctQuantity = expectedQuantity.filter((record) =>
    record.lunaCalled === false
    && record.finalDecision === 'quantity_role_answer'
    && record.finalQuantityRole === record.expectedQuantityRole);
  const effortGenericMiss = expectedFocusedLuna.filter((record) =>
    record.lunaCalled === false && record.finalDecision === 'fallback');
  const crossQuestionConfusion = semanticRecords.filter((record) =>
    record.questionCode === 'missing_effort_estimate'
    && ['target', 'remaining', 'completed'].includes(record.rawChoice));
  const genericDirect = expectedGeneric.filter((record) =>
    record.lunaCalled === false && record.finalDecision === 'fallback');
  const syntheticLabelAgreement = semanticRecords.filter((record) => {
    if (record.expectedBoundary === 'quantity_role_answer') {
      return record.finalDecision === 'quantity_role_answer'
        && record.finalQuantityRole === record.expectedQuantityRole;
    }
    if (record.expectedBoundary === 'focused_luna') return record.lunaCalled;
    return record.finalDecision === 'fallback' && !record.lunaCalled;
  });
  const finalBoundaryErrors = semanticRecords.filter((record) =>
    !finalMatchesSyntheticBoundary(record));

  return {
    corpusVersion: JEV_CONTEXTUAL_CORPUS_VERSION,
    split: records[0]?.split ?? null,
    cases: records.length,
    conversationGroups: new Set(records.map((record) => record.group)).size,
    labelStatus: semanticRecords.length > 0 ? 'synthetic_unreviewed' : 'fault_injection',
    labelSources: [...new Set(records.map((record) => record.labelSource))].sort(),
    expected: {
      quantityRole: expectedQuantity.length,
      focusedLuna: expectedFocusedLuna.length,
      genericSemantic: expectedGeneric.length,
    },
    quantityRole: {
      accepted: quantityAccepted.length,
      syntheticTypedMatch: correctQuantity.length,
      falseAccepts: quantityRoleFalseAccept.length,
      falseAcceptCaseIds: quantityRoleFalseAccept.map((record) => record.caseId),
      falseAcceptUpper95: clopperPearsonUpper95(
        quantityRoleFalseAccept.length,
        semanticRecords.length,
      ),
    },
    effortGenericMiss: {
      count: effortGenericMiss.length,
      denominator: expectedFocusedLuna.length,
      caseIds: effortGenericMiss.map((record) => record.caseId),
    },
    crossQuestionConfusion: {
      count: crossQuestionConfusion.length,
      denominator: semanticRecords.filter((record) =>
        record.questionCode === 'missing_effort_estimate').length,
      caseIds: crossQuestionConfusion.map((record) => record.caseId),
    },
    genericDirect: {
      count: genericDirect.length,
      denominator: expectedGeneric.length,
    },
    lunaFallbacks: records.filter((record) => record.lunaCalled).length,
    providerUnavailable: records.filter((record) =>
      record.providerStatus === 'unavailable').length,
    syntheticLabelAgreement: {
      count: syntheticLabelAgreement.length,
      denominator: semanticRecords.length,
      note: 'Agreement with synthetic_unreviewed labels; not accuracy and not gold.',
    },
    finalBoundaryErrors: {
      count: finalBoundaryErrors.length,
      denominator: semanticRecords.length,
      caseIds: finalBoundaryErrors.map((record) => record.caseId),
      upper95: clopperPearsonUpper95(
        finalBoundaryErrors.length,
        semanticRecords.length,
      ),
    },
    jevUsage: {
      inputTokens: records.reduce((sum, record) => sum + (record.jevInputTokens ?? 0), 0),
      outputTokens: records.reduce((sum, record) => sum + (record.jevOutputTokens ?? 0), 0),
      reportedCostUsd: records.every((record) => record.jevCostUsd !== null)
        ? records.reduce((sum, record) => sum + record.jevCostUsd, 0)
        : null,
    },
    lunaUsage: {
      promptTokens: records.reduce((sum, record) => sum + (record.lunaPromptTokens ?? 0), 0),
      completionTokens: records.reduce((sum, record) =>
        sum + (record.lunaCompletionTokens ?? 0), 0),
      costUsd: null,
    },
  };
}

function createWorkerSource(params) {
  return `
import { dispatchFocusedContextual } from ${JSON.stringify(params.dispatchPath)};
import { createOpenRouterDecisionProvider } from ${JSON.stringify(params.providerPath)};
import {
  CONTEXTUAL_DECISION_CATALOG,
  CONTEXTUAL_JEV_TIMEOUT_MS,
  gateContextualDecision,
} from ${JSON.stringify(params.policyPath)};
import { focusedContextualDecisionContextV5 } from ${JSON.stringify(params.projectionPath)};
import {
  FOCUSED_CONTEXTUAL_ANSWER_WITH_PROVISIONAL_RESPONSE_FORMAT_V5,
  createExtendedContextualMessagesV5,
} from ${JSON.stringify(params.preRoutesPath)};

const CASES = ${JSON.stringify(params.cases)};
const EXPIRES_AT = ${params.expiresAt};
const EXPECTED_DIGEST = ${JSON.stringify(params.digest)};

function stateSummary(item) {
  const progress = item.progressBasis === true;
  const targetRole = item.questionCode === 'quantity_role_unresolved'
    ? 'declared'
    : progress ? 'completed' : 'remaining';
  const workloads = [{
    publicId: progress ? 'workload-completed' : 'workload-target',
    taskPublicId: 'task-synthetic',
    componentPublicId: null,
    quantityRole: targetRole,
    amount: progress ? 70 : 20,
    unitCode: 'page',
    unitLabel: 'ページ',
    rangeStart: null,
    rangeEnd: null,
    perOccurrence: false,
    periodExpression: null,
  }];
  if (progress) {
    workloads.push({
      publicId: 'workload-remaining',
      taskPublicId: 'task-synthetic',
      componentPublicId: null,
      quantityRole: 'remaining',
      amount: 30,
      unitCode: 'page',
      unitLabel: 'ページ',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
    });
  }
  return {
    graphRevision: 31,
    previousCompatibilityStatus: 'revision_pending',
    pendingQuestion: {
      actionId: null,
      questionCode: item.questionCode,
      targetFactId: progress ? 'workload-completed' : 'workload-target',
      graphRevision: 31,
      effortMeasurement: item.questionCode === 'missing_effort_estimate'
        ? 'total_duration'
        : null,
      estimateForWorkloadFactId: progress ? 'workload-remaining' : null,
      questionBasis: progress ? 'completed_workload_total' : null,
    },
    workloads,
    tasks: [{ publicId: 'task-synthetic', category: 'study', title: '合成教材' }],
    components: [],
    relations: [],
  };
}

function faultEvaluation(fault) {
  const metadata = {
    provider: 'typesafe',
    requestedModel: 'fault-injection',
    servedModel: 'fault-injection',
    latencyMs: 1,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    requestBytes: 1,
    responseBytes: 1,
  };
  if (fault === 'timeout' || fault === 'invalid_response'
    || fault === 'model_mismatch' || fault === 'cancelled') {
    return { status: 'unavailable', reason: fault, metadata };
  }
  if (fault === 'http_429' || fault === 'http_500') {
    return {
      status: 'unavailable',
      reason: 'http',
      httpStatus: fault === 'http_429' ? 429 : 500,
      metadata,
    };
  }
  const decision = fault === 'cross_question' ? 'remaining' : 'remaining';
  return {
    status: 'evaluated',
    decision,
    confidence: fault === 'abstain' ? 0.5 : 0.999,
    probabilities: {
      target: 0.0001,
      remaining: 0.9996,
      completed: 0.0001,
      focused_luna: 0.0001,
      fallback: 0.0001,
    },
    conditionChange: 0.001,
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

async function runCase(item, env, requestSignal, lunaOnly = false) {
  const startedAt = Date.now();
  const input = {
    userText: item.userText,
    traceRequestId: 'contextual-eval-' + item.id,
    publicStateSummary: stateSummary(item),
  };
  const context = focusedContextualDecisionContextV5(input);
  if (!context) throw new Error('Context projection failed.');
  const messages = createExtendedContextualMessagesV5(input);
  let evaluation = null;
  let lunaCalled = false;
  let lunaUsage = { prompt: null, completion: null };
  let lunaLatencyMs = null;
  const realProvider = createOpenRouterDecisionProvider({
    apiKey: env.OPENROUTER_API_KEY,
    timeoutMs: CONTEXTUAL_JEV_TIMEOUT_MS,
    catalog: CONTEXTUAL_DECISION_CATALOG,
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
        response_format: FOCUSED_CONTEXTUAL_ANSWER_WITH_PROVISIONAL_RESPONSE_FORMAT_V5,
        max_completion_tokens: 320,
      }),
    });
    lunaLatencyMs = Math.max(0, Date.now() - lunaStartedAt);
    if (!upstream.ok) return Response.json({ error: 'Luna request failed.' }, { status: 502 });
    const payload = await upstream.json();
    const content = payload?.choices?.[0]?.message?.content?.trim();
    if (!content) return Response.json({ error: 'Luna response was empty.' }, { status: 502 });
    lunaUsage = safeUsage(payload.usage);
    return Response.json({ content, usage: payload.usage });
  };
  const response = await dispatchFocusedContextual({
    context,
    env: lunaOnly ? { ...env, JEV_MODE: 'off' } : env,
    firebaseUid: 'contextual-evaluation',
    signal: requestSignal,
    fallback,
    respond: (decision) => Response.json({
      content: JSON.stringify(decision),
      decisionContext: {
        requestId: context.requestId,
        inputRevision: context.inputRevision,
      },
    }),
    provider,
    isHarnessContextCurrent: () => item.fault !== 'stale_context',
  });
  if (!response.ok) throw new Error('Focused contextual dispatch failed.');
  const proxyPayload = await response.json();
  const final = JSON.parse(String(proxyPayload.content ?? ''));
  const allowedOutputKeys = new Set([
    'decision', 'effortTarget', 'effortMeasurement', 'minutes', 'precision', 'quantityRole',
  ]);
  const unexpectedOutputKeys = Object.keys(final).filter((key) => !allowedOutputKeys.has(key));
  const gate = evaluation
    ? gateContextualDecision(evaluation, context.questionCode)
    : null;
  return {
    caseId: item.id,
    group: item.group,
    split: item.split,
    labelStatus: item.split === 'faults' ? 'fault_injection' : 'synthetic_unreviewed',
    labelSource: item.labelSource
      ?? (item.split === 'faults' ? 'fault_injection' : 'synthetic_unreviewed'),
    expectedBoundary: item.expectedBoundary,
    expectedQuantityRole: item.expectedQuantityRole ?? null,
    difficult: item.difficult === true,
    questionCode: item.questionCode,
    providerStatus: evaluation?.status ?? 'missing',
    providerReason: evaluation?.status === 'unavailable' ? evaluation.reason : null,
    providerHttpStatus: evaluation?.status === 'unavailable'
      && evaluation.reason === 'http'
      ? evaluation.httpStatus ?? null
      : null,
    contextCurrent: item.fault !== 'stale_context',
    rawChoice: evaluation?.status === 'evaluated' ? evaluation.decision : null,
    confidence: evaluation?.status === 'evaluated' ? evaluation.confidence : null,
    selectedProbability: evaluation?.status === 'evaluated'
      ? evaluation.probabilities[evaluation.decision]
      : null,
    conditionChange: evaluation?.status === 'evaluated' ? evaluation.conditionChange : null,
    independentMeaning: evaluation?.status === 'evaluated' ? evaluation.independentMeaning : null,
    gate,
    lunaCalled,
    lunaLatencyMs,
    totalLatencyMs: Math.max(0, Date.now() - startedAt),
    finalDecision: typeof final.decision === 'string' ? final.decision : null,
    finalQuantityRole: typeof final.quantityRole === 'string' ? final.quantityRole : null,
    finalHasMinutes: typeof final.minutes === 'number',
    unexpectedOutputKeys,
    jevLatencyMs: evaluation?.metadata?.latencyMs ?? null,
    jevInputTokens: evaluation?.metadata?.inputTokens ?? null,
    jevOutputTokens: evaluation?.metadata?.outputTokens ?? null,
    jevCostUsd: evaluation?.metadata?.costUsd ?? null,
    lunaPromptTokens: lunaUsage.prompt,
    lunaCompletionTokens: lunaUsage.completion,
  };
}

export default {
  async fetch(request, env) {
    if (Date.now() > EXPIRES_AT) return new Response('Not found', { status: 404 });
    const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
    if (await digest(token) !== EXPECTED_DIGEST) {
      return new Response('Not found', { status: 404 });
    }
    if (request.method === 'GET') {
      return Response.json({
        openRouter: Boolean(env.OPENROUTER_API_KEY?.trim()),
        openAi: Boolean(env.OPENAI_API_KEY?.trim()),
      });
    }
    if (request.method !== 'POST') return new Response('Not found', { status: 404 });
    const body = await request.json();
    if (!body || typeof body !== 'object'
      || ![1, 2].includes(Object.keys(body).length)
      || typeof body.caseId !== 'string'
      || (Object.keys(body).length === 2 && body.lunaOnly !== true)
      || Object.keys(body).some((key) => key !== 'caseId' && key !== 'lunaOnly')) {
      return new Response('Invalid request', { status: 400 });
    }
    const item = CASES.find((candidate) => candidate.id === body.caseId);
    if (!item) return new Response('Not found', { status: 404 });
    try {
      return Response.json(await runCase(item, env, request.signal, body.lunaOnly === true), {
        headers: { 'Cache-Control': 'no-store' },
      });
    } catch {
      return Response.json({ error: 'Contextual case failed.' }, { status: 500 });
    }
  },
};
`;
}

async function main() {
  const { worker: workerName, split } = parseArgs();
  const selectedCases = split === 'faults'
    ? faultCases()
    : JEV_CONTEXTUAL_CASES.filter((item) =>
      item.split === (split === 'luna-baseline' ? 'holdout' : split));
  assert.ok(selectedCases.length > 0, `No contextual cases found for ${split}.`);
  const { unstable_dev } = await loadWrangler();
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const directory = await mkdtemp(join(tmpdir(), 'studyplanner-jev-contextual-'));
  const token = randomBytes(32).toString('hex');
  const digest = createHash('sha256').update(token).digest('hex');
  const entry = join(directory, 'contextual-eval.ts');
  const config = join(directory, 'wrangler.json');
  const dispatchPath = join(root, 'workers/ai-proxy/src/decision/focusedContextualDispatch.ts');
  const providerPath = join(root, 'workers/ai-proxy/src/decision/openRouterDecisionProvider.ts');
  const policyPath = join(root, 'workers/ai-proxy/src/decision/contextualDecisionPolicy.ts');
  const projectionPath = join(root, 'src/features/weeklyPlanning/semantic/weeklyPlanningFocusedDecisionContextV5.ts');
  const preRoutesPath = join(root, 'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticFocusedPreRoutesV5.ts');
  let worker;
  try {
    await writeFile(entry, createWorkerSource({
      cases: selectedCases,
      digest,
      expiresAt: Date.now() + 10 * 60_000,
      dispatchPath,
      providerPath,
      policyPath,
      projectionPath,
      preRoutesPath,
    }));
    await writeFile(config, JSON.stringify({
      name: workerName,
      main: 'contextual-eval.ts',
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
    assert.equal(ready.status, 200, 'Cloudflare contextual preview readiness failed.');
    assert.deepEqual(await ready.json(), { openRouter: true, openAi: true });

    const records = [];
    for (const item of selectedCases) {
      const response = await worker.fetch('/case', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId: item.id,
          ...(split === 'luna-baseline' ? { lunaOnly: true } : {}),
        }),
        signal: AbortSignal.timeout(95_000),
      });
      assert.equal(response.status, 200, `Contextual case ${item.id} failed.`);
      records.push(await response.json());
    }
    console.info(JSON.stringify({
      summary: split === 'luna-baseline'
        ? summarizeLunaBaseline(records)
        : summarize(records),
      records,
    }, null, 2));
  } finally {
    try { await worker?.stop(); } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

main().catch(() => {
  console.error('Jev contextual Cloudflare evaluation failed. Check the fixed runbook prerequisites; raw provider data is intentionally suppressed.');
  process.exitCode = 1;
});
