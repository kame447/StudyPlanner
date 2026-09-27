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
  const allPromptTokens = lunaWithUsage.reduce((sum, record) =>
    sum + record.lunaPromptTokens, 0) + records.reduce((sum, record) =>
    sum + (record.postNoOp?.genericPromptTokens ?? 0), 0);
  const allCompletionTokens = lunaWithUsage.reduce((sum, record) =>
    sum + record.lunaCompletionTokens, 0) + records.reduce((sum, record) =>
    sum + (record.postNoOp?.genericCompletionTokens ?? 0), 0);
  const genericMissingUsageCalls = records.reduce((sum, record) =>
    sum + (record.postNoOp?.genericMissingUsageCalls ?? 0), 0);
  // Same Luna text rates as workers/ai-proxy/src/aiUsagePricing.ts. Input
  // cache allocation is unavailable from this upstream response.
  const lunaLowerUsd = (allPromptTokens * 0.02 + allCompletionTokens * 1.2) / 1_000_000;
  const lunaUpperUsd = (allPromptTokens * 0.25 + allCompletionTokens * 1.2) / 1_000_000;
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
      promptTokens: allPromptTokens,
      completionTokens: allCompletionTokens,
      knownFocusedCalls: lunaWithUsage.length,
      genericCalls: records.reduce((sum, record) => sum + (record.postNoOp?.genericCalls ?? 0), 0),
      missingUsageCalls: missingUsageCalls + genericMissingUsageCalls,
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
  const temporal = semantic.filter((record) => record.expected === 'temporal_constraint_present');
  const directFalseAccepts = temporal.filter((record) => record.gate?.status === 'accepted');
  const finalMisses = temporal.filter((record) =>
    record.finalDecision === 'no_temporal_side_contribution');
  const temporalGroups = new Set(temporal.map((record) => record.group));
  const agreements = semantic.filter((record) => record.finalDecision === record.expected);
  const latencies = records.map((record) => record.totalLatencyMs);
  const errorRate = (errors) => ({
    cases: errors.length,
    denominatorCases: temporal.length,
    upper95Cases: clopperPearsonUpper95(errors.length, temporal.length),
    groups: new Set(errors.map((record) => record.group)).size,
    denominatorGroups: temporalGroups.size,
    upper95Groups: clopperPearsonUpper95(
      new Set(errors.map((record) => record.group)).size,
      temporalGroups.size,
    ),
    caseIds: errors.map((record) => record.caseId),
  });
  return {
    route: records[0]?.route ?? null,
    cases: semantic.length,
    conversationGroups: new Set(semantic.map((record) => record.group)).size,
    labelStatus: 'Agreement with synthetic_unreviewed labels; not accuracy or gold.',
    directJevAccepts: records.filter((record) =>
      record.route === 'jev_first' && !record.lunaCalled).length,
    lunaCalls: records.filter((record) => record.lunaCalled).length,
    genericLunaCalls: records.reduce((sum, record) =>
      sum + (record.postNoOp?.genericCalls ?? 0), 0),
    genericTemporalRecovery: {
      recovered: temporal.filter((record) => record.postNoOp?.temporalRecovered).length,
      denominator: temporal.length,
      misses: temporal.filter((record) => !record.postNoOp?.temporalRecovered)
        .map((record) => record.caseId),
    },
    directFalseNoTemporalAccept: errorRate(directFalseAccepts),
    finalFocusedTemporalMiss: errorRate(finalMisses),
    securityDirectAccepts: semantic.filter((record) =>
      record.caseClass === 'security' && record.gate?.status === 'accepted')
      .map((record) => record.caseId),
    syntheticLabelAgreement: { count: agreements.length, denominator: semantic.length },
    caseFailures: records.filter((record) => record.caseFailure !== null).map((record) => ({
      caseId: record.caseId,
      route: record.route,
      failure: record.caseFailure,
      lunaStatus: record.lunaStatus,
    })),
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
  const lunaLegacy320 = records.filter((record) => record.route === 'luna_only_legacy320');
  const jevSummary = summarizeRoute(jevFirst);
  const lunaSummary = summarizeRoute(lunaOnly);
  const legacySummary = summarizeRoute(lunaLegacy320);
  return {
    pairedCases: jevFirst.length,
    jevFirst: jevSummary,
    lunaOnly: lunaSummary,
    lunaOnlyLegacy320: legacySummary,
    pairedObservation: {
      jevFirstFocusedMisses: jevSummary.finalFocusedTemporalMiss.cases,
      lunaOnlyFocusedMisses: lunaSummary.finalFocusedTemporalMiss.cases,
      note: 'One paired run on synthetic_unreviewed labels; not accuracy or a broad no-degradation claim. Legacy budget failures are not credited to Jev.',
    },
  };
}

function createWorkerSource(params) {
  return `
import { dispatchTemporalSideContribution } from ${JSON.stringify(params.dispatchPath)};
import { createOpenRouterDecisionProvider } from ${JSON.stringify(params.providerPath)};
import {
  TEMPORAL_SIDE_CONTRIBUTION_DECISION_CATALOG,
  TEMPORAL_SIDE_CONTRIBUTION_JEV_TIMEOUT_MS,
  gateTemporalSideContributionDecision,
} from ${JSON.stringify(params.policyPath)};
import {
  FOCUSED_TASK_TEMPORAL_SIDE_CONTRIBUTION_MAX_COMPLETION_TOKENS,
  FOCUSED_TASK_TEMPORAL_SIDE_CONTRIBUTION_RESPONSE_FORMAT_V5,
  createFocusedTaskTemporalSideContributionMessagesV5,
  parseFocusedTaskTemporalSideContributionDecisionV5,
} from ${JSON.stringify(params.featurePath)};
import {
  TEMPORAL_SIDE_CONTRIBUTION_CASES,
  validateTemporalSideContributionCorpus,
} from ${JSON.stringify(params.corpusPath)};
import { assertTemporalSideContributionHoldoutSeal } from ${JSON.stringify(params.sealPath)};
import { temporalSideContributionPolicyFingerprints } from ${JSON.stringify(params.fingerprintPath)};
import { isCanonicalDateExpressionSyntax } from ${JSON.stringify(params.calendarPath)};
import { SEMANTIC_NAMED_TIME_PERIODS_V5 } from ${JSON.stringify(params.semanticDocumentPath)};
import { WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5 } from ${JSON.stringify(params.semanticDocumentPath)};
import { createWeeklyPlanningSemanticNormalizerV5 } from ${JSON.stringify(params.normalizerPath)};

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
    expected: 'temporal_constraint_present',
    labelSource: 'fault_injection',
    fault,
    state: {
      currentUserText: 'この数学は火曜18時以降に進めたいです。',
      knownTask: { title: '数学の問題集', category: 'study' },
      pendingQuestion: { questionCode: 'missing_schedulable_work' },
    },
  }));
}

function selectedCases() {
  if (SPLIT === 'faults') return faultCases();
  return TEMPORAL_SIDE_CONTRIBUTION_CASES.filter((item) => item.split === SPLIT);
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
    status: 'evaluated', decision: 'no_temporal_side_contribution',
    confidence: fault === 'abstain' ? 0.5 : 0.999,
    probabilities: {
      temporal_constraint_present: 0.001,
      no_temporal_side_contribution: 0.999,
      uncertain: 0,
      other: 0,
    },
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

function schemaViolations(value) {
  const schema = FOCUSED_TASK_TEMPORAL_SIDE_CONTRIBUTION_RESPONSE_FORMAT_V5.json_schema.schema;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['object'];
  const matches = (item, rule) => {
    if (Array.isArray(rule.anyOf)) return rule.anyOf.some((branch) => matches(item, branch));
    if (rule.type === 'null') return item === null;
    if (rule.type === 'string') return typeof item === 'string'
      && (!rule.enum || rule.enum.includes(item))
      && (!rule.pattern || new RegExp(rule.pattern).test(item));
    return false;
  };
  return [
    ...schema.required.filter((key) => !(key in value)).map((key) => 'missing_' + key),
    ...Object.keys(value).filter((key) => !(key in schema.properties)).map((key) =>
      'extra_' + key),
    ...Object.entries(schema.properties).filter(([key, rule]) =>
      key in value && !matches(value[key], rule)).map(([key]) => 'invalid_' + key),
  ];
}

function parserRejectReasons(value) {
  if (!value || typeof value !== 'object') return ['not_object'];
  if (value.decision === 'temporal_constraint') {
    const reasons = [];
    if (typeof value.dateExpression === 'string'
      && !isCanonicalDateExpressionSyntax(value.dateExpression)) reasons.push('date_noncanonical');
    if (typeof value.namedTimePeriod === 'string'
      && !SEMANTIC_NAMED_TIME_PERIODS_V5.includes(value.namedTimePeriod)
      && !(value.namedTimePeriod.startsWith('custom:')
        && value.namedTimePeriod.length > 'custom:'.length)) reasons.push('period_noncanonical');
    return reasons.length ? reasons : ['other_parser_rejection'];
  }
  if (value.decision === 'fallback') {
    return Object.entries(value).some(([key, item]) => key !== 'decision' && item !== null)
      ? ['fallback_fields_not_null'] : ['other_parser_rejection'];
  }
  return ['unsupported_decision'];
}

async function postNoOpOutcome(item, focusedResponse, focusedPayload, env) {
  const publicStateSummary = {
    graphRevision: 31,
    pendingQuestion: {
      questionCode: item.state.pendingQuestion.questionCode,
      targetFactId: 'evaluation-task', graphRevision: 31,
    },
    tasks: [{
      publicId: 'evaluation-task',
      category: item.state.knownTask.category,
      title: item.state.knownTask.title,
    }],
    components: [], workloads: [],
  };
  const initialNoOp = {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan', planningWindow: null,
    tasks: [{
      localId: 'evaluation-task-local', existingPublicId: 'evaluation-task',
      decompositionStatus: 'atomic', category: item.state.knownTask.category,
      title: item.state.knownTask.title, study: null, workloads: [],
      effortEstimates: [], temporalConstraints: [], recurrence: [],
      durableContextSignals: [], sourceText: item.state.currentUserText,
    }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [],
    userContextFacts: [], uncertainties: [], corrections: [], decisions: [],
  };
  let calls = 0;
  let genericCalls = 0;
  let genericStatus = null;
  let genericPromptTokens = 0;
  let genericCompletionTokens = 0;
  let genericMissingUsageCalls = 0;
  const startedAt = Date.now();
  const client = {
    async createChatCompletion(request) {
      calls += 1;
      if (calls === 1) return JSON.stringify(initialNoOp);
      if (calls === 2) {
        if (!focusedResponse.ok || typeof focusedPayload.content !== 'string'
          || !focusedPayload.content.trim()) throw new Error('focused_provider_failure');
        return focusedPayload.content;
      }
      genericCalls += 1;
      const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + String(env.OPENAI_API_KEY ?? '').trim(),
        },
        body: JSON.stringify({
          model: 'gpt-5.6-luna', messages: request.messages,
          response_format: request.responseFormat,
          max_completion_tokens: request.maxCompletionTokens,
        }),
      });
      genericStatus = upstream.status;
      if (!upstream.ok) throw new Error('generic_http_' + upstream.status);
      const payload = await upstream.json();
      const usage = safeUsage(payload.usage);
      if (usage.prompt === null || usage.completion === null) genericMissingUsageCalls += 1;
      else {
        genericPromptTokens += usage.prompt;
        genericCompletionTokens += usage.completion;
      }
      const content = payload?.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error('generic_empty_content');
      return content;
    },
  };
  try {
    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: item.state.currentUserText,
      traceRequestId: 'temporal-side-eval-' + item.id,
      publicStateSummary,
    });
    return {
      normalizerStatus: result.status,
      temporalRecovered: Boolean(result.document?.tasks.some((task) =>
        task.temporalConstraints.length > 0)),
      genericCalls, genericStatus,
      genericPromptTokens, genericCompletionTokens, genericMissingUsageCalls,
      latencyMs: Math.max(0, Date.now() - startedAt),
    };
  } catch {
    return {
      normalizerStatus: 'threw', temporalRecovered: false,
      genericCalls, genericStatus,
      genericPromptTokens, genericCompletionTokens, genericMissingUsageCalls,
      latencyMs: Math.max(0, Date.now() - startedAt),
    };
  }
}

async function runCase(item, env, requestSignal, route) {
  const startedAt = Date.now();
  const context = {
    purpose: 'temporal_side_contribution',
    requestId: 'temporal-side-eval-' + item.id,
    inputRevision: 31,
    state: item.state,
  };
  const messages = createFocusedTaskTemporalSideContributionMessagesV5({
    userText: item.state.currentUserText,
    publicStateSummary: {
      graphRevision: 31,
      pendingQuestion: {
        questionCode: item.state.pendingQuestion.questionCode,
        targetFactId: 'evaluation-task',
      },
      tasks: [{
        publicId: 'evaluation-task',
        title: item.state.knownTask.title,
        category: item.state.knownTask.category,
      }],
    },
  });
  const lunaOnly = route !== 'jev_first';
  const lunaMaxCompletionTokens = route === 'luna_only_legacy320'
    ? 320 : FOCUSED_TASK_TEMPORAL_SIDE_CONTRIBUTION_MAX_COMPLETION_TOKENS;
  let evaluation = null;
  let lunaCalled = false;
  let lunaStatus = null;
  let lunaUsage = { prompt: null, completion: null };
  let lunaLatencyMs = null;
  let lunaFinishReason = null;
  let lunaContentPresent = null;
  const realProvider = createOpenRouterDecisionProvider({
    apiKey: env.OPENROUTER_API_KEY,
    timeoutMs: TEMPORAL_SIDE_CONTRIBUTION_JEV_TIMEOUT_MS,
    catalog: TEMPORAL_SIDE_CONTRIBUTION_DECISION_CATALOG,
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
        response_format: FOCUSED_TASK_TEMPORAL_SIDE_CONTRIBUTION_RESPONSE_FORMAT_V5,
        max_completion_tokens: lunaMaxCompletionTokens,
      }),
    });
    lunaLatencyMs = Math.max(0, Date.now() - lunaStartedAt);
    lunaStatus = upstream.status;
    if (!upstream.ok) return Response.json({ error: 'Luna request failed.' }, { status: 502 });
    const payload = await upstream.json();
    lunaUsage = safeUsage(payload.usage);
    lunaFinishReason = typeof payload?.choices?.[0]?.finish_reason === 'string'
      ? payload.choices[0].finish_reason : null;
    const content = payload?.choices?.[0]?.message?.content?.trim();
    lunaContentPresent = Boolean(content);
    if (!content) return Response.json({ error: 'Luna response was empty.' }, { status: 502 });
    return Response.json({ content, usage: payload.usage });
  };
  const response = await dispatchTemporalSideContribution({
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
  const proxyPayload = await response.json().catch(() => ({}));
  let final = null;
  try {
    const parsed = JSON.parse(String(proxyPayload.content ?? ''));
    if (parsed && typeof parsed === 'object') final = parsed;
  } catch {
    // Preserve only the typed failure below; never surface provider text.
  }
  const gate = evaluation ? gateTemporalSideContributionDecision(evaluation) : null;
  const allowedResponseKeys = new Set(['content', 'decisionContext', 'usage']);
  const allowedDecisionKeys = new Set([
    'decision', 'kind', 'constraintLevel', 'dateExpression', 'namedTimePeriod',
    'startTime', 'endTime', 'precision',
  ]);
  const parsedFocused = parseFocusedTaskTemporalSideContributionDecisionV5(
    String(proxyPayload.content ?? ''),
  );
  const finalDecision = final?.decision === 'no_temporal_side_contribution'
    && Object.keys(final).length === 1
    ? 'no_temporal_side_contribution'
    : parsedFocused?.decision === 'temporal_constraint'
      ? 'temporal_constraint_present'
      : parsedFocused?.decision === 'fallback'
        ? 'no_temporal_side_contribution'
        : null;
  const caseFailure = !response.ok
    ? 'dispatch_http_' + response.status
    : finalDecision === null ? 'invalid_final_decision' : null;
  const focusedLatencyMs = Math.max(0, Date.now() - startedAt);
  const postNoOp = await postNoOpOutcome(item, response, proxyPayload, env);
  return {
    caseId: item.id,
    group: item.group,
    split: item.split,
    caseClass: item.caseClass,
    labelSource: item.labelSource,
    expected: item.expected,
    route,
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
    caseFailure,
    postNoOp,
    lunaCalled,
    lunaMaxCompletionTokens,
    lunaStatus,
    lunaFinishReason,
    lunaContentPresent,
    lunaSchemaViolations: lunaCalled && final ? schemaViolations(final) : [],
    lunaParserAccepted: lunaCalled ? parsedFocused !== null : null,
    lunaParserRejectReasons: lunaCalled && final && parsedFocused === null
      ? parserRejectReasons(final) : [],
    lunaDecisionTag: lunaCalled && final
      ? ['temporal_constraint', 'fallback'].includes(final.decision)
        ? final.decision : 'other'
      : null,
    finalDecision,
    unexpectedResponseKeys: Object.keys(proxyPayload).filter((key) => !allowedResponseKeys.has(key)),
    unexpectedDecisionKeys: final
      ? Object.keys(final).filter((key) => !allowedDecisionKeys.has(key))
      : ['invalid_decision_payload'],
    focusedLatencyMs,
    totalLatencyMs: focusedLatencyMs + postNoOp.latencyMs,
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
    validateTemporalSideContributionCorpus();
    if (SPLIT === 'holdout') await assertTemporalSideContributionHoldoutSeal();
    const cases = selectedCases();
    if (request.method === 'GET') {
      return Response.json({
        openRouter: Boolean(env.OPENROUTER_API_KEY?.trim()),
        openAi: Boolean(env.OPENAI_API_KEY?.trim()),
        caseCount: cases.length,
        fingerprints: await temporalSideContributionPolicyFingerprints(),
      });
    }
    if (request.method !== 'POST') return new Response('Not found', { status: 404 });
    const body = await request.json();
    if (!body || typeof body !== 'object'
      || !Number.isSafeInteger(body.index)
      || body.index < 0 || body.index >= cases.length
      || !['jev_first', 'luna_only', 'luna_only_legacy320'].includes(body.route)
      || Object.keys(body).some((key) => key !== 'index' && key !== 'route')) {
      return new Response('Invalid request', { status: 400 });
    }
    try {
      return Response.json(await runCase(cases[body.index], env, request.signal, body.route), {
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
      expiresAt: Date.now() + 30 * 60_000,
      dispatchPath: join(root, 'workers/ai-proxy/src/decision/temporalSideContributionDispatch.ts'),
      providerPath: join(root, 'workers/ai-proxy/src/decision/openRouterDecisionProvider.ts'),
      policyPath: join(root, 'workers/ai-proxy/src/decision/temporalSideContributionDecisionPolicy.ts'),
      featurePath: join(root, 'src/features/weeklyPlanning/semantic/weeklyPlanningFocusedTaskTemporalSideContributionV5.ts'),
      corpusPath: join(root, 'workers/ai-proxy/src/decision/evaluation/temporalSideContributionCorpus.ts'),
      sealPath: join(root, 'workers/ai-proxy/src/decision/evaluation/temporalSideContributionHoldoutSeal.ts'),
      fingerprintPath: join(root, 'workers/ai-proxy/src/decision/evaluation/temporalSideContributionPolicyFingerprint.ts'),
      calendarPath: join(root, 'src/features/weeklyPlanning/semantic/weeklyPlanningCalendarResolver.ts'),
      semanticDocumentPath: join(root, 'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticDocumentV5.ts'),
      normalizerPath: join(root, 'src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerV5.ts'),
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
    const routes = split === 'holdout'
      ? ['jev_first', 'luna_only', 'luna_only_legacy320']
      : ['jev_first'];
    for (const route of routes) {
      for (let index = 0; index < readiness.caseCount; index += 1) {
        const response = await worker.fetch('/case', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ index, route }),
          signal: AbortSignal.timeout(95_000),
        });
        if (response.status !== 200) {
          throw new Error(
            `Temporal case index ${index} (${route}) failed with status ${response.status}.`,
          );
        }
        records.push(await response.json());
        if (records.length % 10 === 0) {
          console.info(JSON.stringify({ stage: 'cases', completed: records.length }));
        }
      }
    }
    const result = {
      schemaVersion: 'temporal-side-contribution-evidence-v1',
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
