import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { access, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Issue #305 C9: paired Jev-first vs Luna-only evaluation of the proposal-response
// route. Runs the real client semantic normalizer inside a temporary remote Worker
// that uses the existing Worker's provider Secrets. Evidence is typed only; no
// corpus text, prompt, or provider output is written.

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
      `Refusing evaluation with Wrangler ${String(packageJson.version)}; expected ${VERIFIED_WRANGLER_VERSION}.`,
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
  if (total === 0) return null;
  if (errors >= total) return 1;
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

function errorRate(errors, denominator) {
  const groups = new Set(denominator.map((record) => record.group));
  const errorGroups = new Set(errors.map((record) => record.group));
  return {
    cases: errors.length,
    denominatorCases: denominator.length,
    upper95Cases: clopperPearsonUpper95(errors.length, denominator.length),
    groups: errorGroups.size,
    denominatorGroups: groups.size,
    upper95Groups: clopperPearsonUpper95(errorGroups.size, groups.size),
    caseIds: errors.map((record) => record.caseId),
  };
}

function cost(records) {
  const prompt = records.reduce((sum, record) => sum + record.lunaPromptTokens, 0);
  const completion = records.reduce((sum, record) => sum + record.lunaCompletionTokens, 0);
  const missingUsageCalls = records.reduce((sum, record) => sum + record.lunaMissingUsageCalls, 0);
  // Same Luna text rates as workers/ai-proxy/src/aiUsagePricing.ts; cache allocation is
  // unavailable from the upstream response, so the input side is a range.
  const lunaLowerUsd = (prompt * 0.02 + completion * 1.2) / 1_000_000;
  const lunaUpperUsd = (prompt * 0.25 + completion * 1.2) / 1_000_000;
  const jevCalled = records.filter((record) => record.providerStatus !== 'not_called');
  const jevKnown = jevCalled.every((record) => record.jevCostUsd !== null);
  const jevUsd = jevKnown ? jevCalled.reduce((sum, record) => sum + record.jevCostUsd, 0) : null;
  return {
    jev: { calls: jevCalled.length, reportedCostUsd: jevUsd },
    luna: {
      calls: records.reduce((sum, record) => sum + record.lunaCalls, 0),
      promptTokens: prompt,
      completionTokens: completion,
      missingUsageCalls,
      lowerUsd: lunaLowerUsd,
      upperUsd: lunaUpperUsd,
    },
    perTurnKnownRangeUsd: jevUsd === null || records.length === 0 ? null : {
      lower: (jevUsd + lunaLowerUsd) / records.length,
      upper: (jevUsd + lunaUpperUsd) / records.length,
    },
  };
}

function summarizeRoute(records) {
  const semantic = records.filter((record) => record.split !== 'faults');
  const negatives = semantic.filter((record) => record.expected === 'other');
  const positives = semantic.filter((record) => record.expected === 'reject_only');
  const byStratum = Object.fromEntries([...new Set(semantic.map((record) => record.stratum))]
    .map((stratum) => {
      const items = semantic.filter((record) => record.stratum === stratum);
      return [stratum, {
        cases: items.length,
        directJevAccepts: items.filter((record) => record.gate?.status === 'accepted').length,
        finalPureReject: items.filter((record) => record.finalShape === 'pure_reject').length,
        normalizerAccepted: items.filter((record) => record.normalizerStatus === 'accepted').length,
        lunaCalls: items.reduce((sum, record) => sum + record.lunaCalls, 0),
        latencyMs: {
          p50: percentile(items.map((record) => record.totalLatencyMs), 0.5),
          p95: percentile(items.map((record) => record.totalLatencyMs), 0.95),
        },
      }];
    }));
  return {
    route: records[0]?.route ?? null,
    cases: semantic.length,
    conversationGroups: new Set(semantic.map((record) => record.group)).size,
    labelStatus: 'Agreement with synthetic_unreviewed labels; not accuracy or gold.',
    directJevAccepts: records.filter((record) => record.gate?.status === 'accepted').length,
    directFalseReject: errorRate(
      negatives.filter((record) => record.gate?.status === 'accepted'),
      negatives,
    ),
    finalFalseReject: errorRate(
      negatives.filter((record) => record.finalShape === 'pure_reject'),
      negatives,
    ),
    positiveFinalPureReject: {
      cases: positives.filter((record) => record.finalShape === 'pure_reject').length,
      denominator: positives.length,
      misses: positives.filter((record) => record.finalShape !== 'pure_reject')
        .map((record) => record.caseId),
    },
    normalizerNonAccepted: semantic.filter((record) => record.normalizerStatus !== 'accepted')
      .map((record) => ({ caseId: record.caseId, status: record.normalizerStatus })),
    faultOutcomes: records.filter((record) => record.split === 'faults').map((record) => ({
      caseId: record.caseId,
      gate: record.gate?.status ?? null,
      lunaCalls: record.lunaCalls,
      normalizerStatus: record.normalizerStatus,
      finalShape: record.finalShape,
    })),
    providerReasons: Object.fromEntries([...new Set(records.map((record) =>
      record.providerReason).filter(Boolean))].map((reason) => [reason, records.filter((record) =>
      record.providerReason === reason).length])),
    containmentErrors: records.filter((record) => record.unexpectedDecisionKeys.length > 0)
      .map((record) => record.caseId),
    lunaCalls: records.reduce((sum, record) => sum + record.lunaCalls, 0),
    latencyMs: {
      p50: percentile(records.map((record) => record.totalLatencyMs), 0.5),
      p95: percentile(records.map((record) => record.totalLatencyMs), 0.95),
    },
    byStratum,
    usageAndCost: cost(records),
  };
}

function summarize(records) {
  const jevFirst = records.filter((record) => record.route === 'jev_first');
  const lunaOnly = records.filter((record) => record.route === 'luna_only');
  return {
    jevFirst: summarizeRoute(jevFirst),
    ...(lunaOnly.length > 0 ? { lunaOnly: summarizeRoute(lunaOnly) } : {}),
  };
}

function createWorkerSource(params) {
  return `
import { dispatchProposalResponse } from ${JSON.stringify(params.dispatchPath)};
import { createOpenRouterDecisionProvider } from ${JSON.stringify(params.providerPath)};
import {
  PROPOSAL_RESPONSE_DECISION_CATALOG,
  PROPOSAL_RESPONSE_JEV_TIMEOUT_MS,
  gateProposalResponseDecision,
} from ${JSON.stringify(params.policyPath)};
import {
  PROPOSAL_RESPONSE_CASES,
  validateProposalResponseCorpus,
} from ${JSON.stringify(params.corpusPath)};
import {
  assertProposalResponseCorpusSealed,
  assertProposalResponseHoldoutSeal,
} from ${JSON.stringify(params.sealPath)};
import { proposalResponsePolicyFingerprints } from ${JSON.stringify(params.fingerprintPath)};
import { createWeeklyPlanningSemanticNormalizerV5 } from ${JSON.stringify(params.normalizerPath)};

const SPLIT = ${JSON.stringify(params.split)};
const EXPIRES_AT = ${params.expiresAt};
const EXPECTED_DIGEST = ${JSON.stringify(params.digest)};
const PROPOSAL_ID = 'wpp_memory_evaluation';
const INPUT_REVISION = 8;

function faultCases() {
  const faults = [
    'abstain', 'conflicting_heads', 'timeout', 'network', 'http_429', 'http_500',
    'unsupported_output', 'invalid_response', 'model_mismatch', 'cancelled',
  ];
  return faults.map((fault) => ({
    id: 'fault-' + fault,
    group: 'fault-' + fault,
    split: 'faults',
    stratum: 'pure_reject',
    expected: 'reject_only',
    labelSource: 'fault_injection',
    fault,
    state: {
      currentUserText: '今回はその方法は使わないでおきます',
      presentedAssistantText: '英単語は、1回15〜30分に分けて何度か復習する分散学習がおすすめです。この進め方にしますか？',
      proposal: { kind: 'spaced_memory_practice', taskTitle: '英単語', sessionMinutes: { min: 15, max: 30 } },
    },
  }));
}

function selectedCases() {
  if (SPLIT === 'faults') return faultCases();
  return PROPOSAL_RESPONSE_CASES.filter((item) => item.split === SPLIT);
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
  if (fault === 'unsupported_output') return { status: 'unavailable', reason: 'invalid_response', metadata };
  if (fault === 'http_429' || fault === 'http_500') {
    return { status: 'unavailable', reason: 'http', httpStatus: fault === 'http_429' ? 429 : 500, metadata };
  }
  return {
    status: 'evaluated', decision: 'reject_only',
    confidence: fault === 'abstain' ? 0.5 : 0.999,
    probabilities: { reject_only: 0.999, other: 0.001 },
    conditionChange: fault === 'conflicting_heads' ? 0.9 : 0.001,
    independentMeaning: 0.001,
    metadata,
  };
}

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function safeUsage(value) {
  if (!value || typeof value !== 'object') return { prompt: null, completion: null };
  return {
    prompt: Number.isSafeInteger(value.prompt_tokens) && value.prompt_tokens >= 0 ? value.prompt_tokens : null,
    completion: Number.isSafeInteger(value.completion_tokens) && value.completion_tokens >= 0 ? value.completion_tokens : null,
  };
}

function publicStateSummary(item) {
  return {
    runtime: 'weekly-planning-stable-v5',
    graphRevision: 3,
    previousCompatibilityStatus: 'revision_pending',
    pendingQuestion: {
      actionId: PROPOSAL_ID,
      questionCode: 'learning_strategy_proposal',
      targetFactId: 'workload-evaluation',
      graphRevision: 3,
      effortMeasurement: null,
      estimateForWorkloadFactId: null,
      questionBasis: null,
    },
    learningStrategyProposals: [{
      publicId: PROPOSAL_ID,
      kind: 'spaced_memory_practice',
      taskPublicId: 'task-evaluation',
      workloadPublicId: 'workload-evaluation',
      scope: 'week',
      status: 'pending',
      suggestedSessionMinutes: item.state.proposal.sessionMinutes,
    }],
    groundingRecords: [],
    repairAgenda: [],
    planningWindows: [],
    tasks: [{ publicId: 'task-evaluation', category: 'study', title: item.state.proposal.taskTitle }],
    components: [],
    workloads: [{
      publicId: 'workload-evaluation', taskPublicId: 'task-evaluation', componentPublicId: null,
      quantityRole: 'target', amount: 100, unitCode: 'item', unitLabel: '個',
      rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
    }],
    relations: [],
    uncertainties: [],
    registeredMaterials: [],
    userPlanningContext: [],
    lastAssistantMessage: item.state.presentedAssistantText,
    calendarContext: { currentDate: '2026-09-28', timeZone: 'Asia/Tokyo' },
  };
}

function documentShape(document) {
  if (!document) return 'none';
  const decisions = Array.isArray(document.decisions) ? document.decisions : [];
  const others = ['tasks', 'relations', 'availabilityDeclarations', 'constraintSourceRequests',
    'uncertainties', 'corrections'].some((key) => Array.isArray(document[key]) && document[key].length > 0)
    || document.planningWindow !== null;
  const proposalDecisions = decisions.filter((decision) => decision?.target?.kind === 'proposal');
  if (decisions.length === 1 && proposalDecisions.length === 1
    && proposalDecisions[0].decision === 'reject'
    && proposalDecisions[0].target.publicId === PROPOSAL_ID && !others) return 'pure_reject';
  if (proposalDecisions.some((decision) => decision.decision === 'reject')) return 'reject_with_other';
  if (proposalDecisions.some((decision) => decision.decision === 'accept')) return others ? 'accept_with_other' : 'accept';
  return others ? 'other_meaning' : 'no_proposal_decision';
}

async function lunaChat(env, request, signal, meter) {
  meter.calls += 1;
  const startedAt = Date.now();
  const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    ...(signal ? { signal } : {}),
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + String(env.OPENAI_API_KEY ?? '').trim(),
    },
    body: JSON.stringify({
      model: 'gpt-5.6-luna',
      messages: request.messages,
      response_format: request.responseFormat,
      max_completion_tokens: request.maxCompletionTokens,
    }),
  });
  meter.latencyMs += Math.max(0, Date.now() - startedAt);
  if (!upstream.ok) {
    meter.failures.push('http_' + upstream.status);
    throw new Error('luna_http_' + upstream.status);
  }
  const payload = await upstream.json();
  const usage = safeUsage(payload.usage);
  if (usage.prompt === null || usage.completion === null) meter.missingUsage += 1;
  else { meter.prompt += usage.prompt; meter.completion += usage.completion; }
  const content = payload?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    meter.failures.push('empty');
    throw new Error('luna_empty');
  }
  return content;
}

async function runCase(item, env, requestSignal, route) {
  const meter = { calls: 0, latencyMs: 0, prompt: 0, completion: 0, missingUsage: 0, failures: [] };
  let evaluation = null;
  let dispatched = false;
  let unexpectedDecisionKeys = [];
  const realProvider = createOpenRouterDecisionProvider({
    apiKey: env.OPENROUTER_API_KEY,
    timeoutMs: PROPOSAL_RESPONSE_JEV_TIMEOUT_MS,
    catalog: PROPOSAL_RESPONSE_DECISION_CATALOG,
  });
  const provider = {
    async evaluate(state, signal) {
      evaluation = item.fault ? faultEvaluation(item.fault) : await realProvider.evaluate(state, signal);
      return evaluation;
    },
  };
  const client = {
    async createChatCompletion(request) {
      if (!request.decisionContext) return lunaChat(env, request, requestSignal, meter);
      dispatched = true;
      const { decisionContext, ...lunaRequest } = request;
      const response = await dispatchProposalResponse({
        context: decisionContext,
        env: route === 'jev_first' ? env : { ...env, JEV_MODE: 'off' },
        firebaseUid: 'proposal-response-evaluation',
        signal: requestSignal,
        fallback: async (signal) => Response.json({
          content: await lunaChat(env, lunaRequest, signal, meter),
        }),
        respond: (content) => Response.json({
          content: JSON.stringify(content),
          decisionContext: {
            requestId: decisionContext.requestId,
            inputRevision: decisionContext.inputRevision,
          },
        }),
        provider,
      });
      const payload = await response.json();
      if (!response.ok || typeof payload.content !== 'string') throw new Error('dispatch_failed');
      try {
        const parsed = JSON.parse(payload.content);
        if (parsed && typeof parsed === 'object' && 'proposalResponse' in parsed) {
          unexpectedDecisionKeys = Object.keys(parsed).filter((key) => key !== 'proposalResponse');
        }
      } catch { /* a generic document or malformed content is handled by the normalizer */ }
      return payload.content;
    },
  };
  const startedAt = Date.now();
  let result = null;
  let normalizerStatus = 'threw';
  try {
    result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: item.state.currentUserText,
      traceRequestId: 'proposal-response-eval-' + item.id,
      recentConversation: [
        { role: 'user', content: item.state.proposal.taskTitle + 'を100個覚えたいです' },
        { role: 'assistant', content: item.state.presentedAssistantText },
      ],
      publicStateSummary: publicStateSummary(item),
      proposalResponseCandidate: {
        proposalPublicId: PROPOSAL_ID,
        inputRevision: INPUT_REVISION,
        presentedAssistantText: item.state.presentedAssistantText,
        proposal: item.state.proposal,
      },
    });
    normalizerStatus = result.status;
  } catch {
    normalizerStatus = 'threw';
  }
  const totalLatencyMs = Math.max(0, Date.now() - startedAt);
  const gate = evaluation ? gateProposalResponseDecision(evaluation) : null;
  return {
    caseId: item.id,
    group: item.group,
    split: item.split,
    stratum: item.stratum,
    labelSource: item.labelSource,
    expected: item.expected,
    route,
    contextDispatched: dispatched,
    providerStatus: evaluation?.status ?? 'not_called',
    providerReason: evaluation?.status === 'unavailable' ? evaluation.reason : null,
    rawChoice: evaluation?.status === 'evaluated' ? evaluation.decision : null,
    confidence: evaluation?.status === 'evaluated' ? evaluation.confidence : null,
    selectedProbability: evaluation?.status === 'evaluated' ? evaluation.probabilities[evaluation.decision] : null,
    conditionChange: evaluation?.status === 'evaluated' ? evaluation.conditionChange : null,
    independentMeaning: evaluation?.status === 'evaluated' ? evaluation.independentMeaning : null,
    gate,
    normalizerStatus,
    finalShape: documentShape(result?.document ?? null),
    planningIntent: result?.document?.planningIntent ?? null,
    unexpectedDecisionKeys,
    totalLatencyMs,
    lunaCalls: meter.calls,
    lunaLatencyMs: meter.latencyMs,
    lunaFailures: meter.failures,
    lunaPromptTokens: meter.prompt,
    lunaCompletionTokens: meter.completion,
    lunaMissingUsageCalls: meter.missingUsage,
    jevLatencyMs: evaluation?.metadata?.latencyMs ?? null,
    jevCostUsd: evaluation?.metadata?.costUsd ?? null,
  };
}

export default {
  async fetch(request, env) {
    if (Date.now() > EXPIRES_AT) return new Response('Not found', { status: 404 });
    const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
    if (await digest(token) !== EXPECTED_DIGEST) return new Response('Not found', { status: 404 });
    validateProposalResponseCorpus();
    await assertProposalResponseCorpusSealed();
    if (SPLIT === 'holdout') await assertProposalResponseHoldoutSeal();
    const cases = selectedCases();
    if (request.method === 'GET') {
      return Response.json({
        openRouter: Boolean(env.OPENROUTER_API_KEY?.trim()),
        openAi: Boolean(env.OPENAI_API_KEY?.trim()),
        caseCount: cases.length,
        fingerprints: await proposalResponsePolicyFingerprints(),
      });
    }
    if (request.method !== 'POST') return new Response('Not found', { status: 404 });
    const body = await request.json();
    if (!body || typeof body !== 'object'
      || !Number.isSafeInteger(body.index) || body.index < 0 || body.index >= cases.length
      || !['jev_first', 'luna_only'].includes(body.route)
      || Object.keys(body).some((key) => key !== 'index' && key !== 'route')) {
      return new Response('Invalid request', { status: 400 });
    }
    try {
      return Response.json(await runCase(cases[body.index], env, request.signal, body.route), {
        headers: { 'Cache-Control': 'no-store' },
      });
    } catch {
      return Response.json({ error: 'Proposal-response evaluation case failed.' }, { status: 500 });
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
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const { unstable_dev } = await loadWrangler();
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const directory = await mkdtemp(join(tmpdir(), 'studyplanner-jev-proposal-'));
  const token = randomBytes(32).toString('hex');
  const digest = createHash('sha256').update(token).digest('hex');
  const entry = join(directory, 'proposal-eval.ts');
  const config = join(directory, 'wrangler.json');
  let worker;
  try {
    const decision = (name) => join(root, 'workers/ai-proxy/src/decision', name);
    await writeFile(entry, createWorkerSource({
      split,
      digest,
      expiresAt: Date.now() + 45 * 60_000,
      dispatchPath: decision('proposalResponseDispatch.ts'),
      providerPath: decision('openRouterDecisionProvider.ts'),
      policyPath: decision('proposalResponseDecisionPolicy.ts'),
      corpusPath: decision('evaluation/proposalResponseCorpus.ts'),
      sealPath: decision('evaluation/proposalResponseHoldoutSeal.ts'),
      fingerprintPath: decision('evaluation/proposalResponsePolicyFingerprint.ts'),
      normalizerPath: join(root, 'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerV5.ts'),
    }));
    await writeFile(config, JSON.stringify({
      name: workerName,
      main: 'proposal-eval.ts',
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
    const ready = await worker.fetch('/ready', { headers, signal: AbortSignal.timeout(45_000) });
    assert.equal(ready.status, 200, 'Cloudflare proposal-response preview readiness failed.');
    const readiness = await ready.json();
    assert.equal(readiness.openRouter, true, 'OPENROUTER_API_KEY is unavailable.');
    assert.equal(readiness.openAi, true, 'OPENAI_API_KEY is unavailable.');
    assert.ok(Number.isSafeInteger(readiness.caseCount) && readiness.caseCount > 0);

    const records = [];
    const routes = split === 'faults' ? ['jev_first'] : ['jev_first', 'luna_only'];
    for (const route of routes) {
      for (let index = 0; index < readiness.caseCount; index += 1) {
        const response = await worker.fetch('/case', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ index, route }),
          signal: AbortSignal.timeout(170_000),
        });
        if (response.status !== 200) {
          throw new Error(`Proposal case index ${index} (${route}) failed with status ${response.status}.`);
        }
        records.push(await response.json());
        if (records.length % 10 === 0) {
          console.info(JSON.stringify({ stage: 'cases', completed: records.length }));
        }
      }
    }
    const result = {
      schemaVersion: 'proposal-response-evidence-v1',
      generatedAt: new Date().toISOString(),
      split,
      fingerprints: readiness.fingerprints,
      summary: summarize(records),
      records,
    };
    await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    console.info(JSON.stringify({ output, split, fingerprints: readiness.fingerprints, summary: result.summary }, null, 2));
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
  console.error(`Jev proposal-response Cloudflare evaluation failed: ${controlledMessage}. Raw provider data is intentionally suppressed.`);
  process.exitCode = 1;
});
