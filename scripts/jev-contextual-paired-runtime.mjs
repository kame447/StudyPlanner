// Build an evaluation-only Worker that runs the real semantic normalizer in
// both arms. No renderer, scheduler, persistence, or production telemetry sink.
// With preSend (Unit 0 r2), every provider fetch is preceded by a conservative
// reservation check baked into the deployed source: a request whose byte-bound
// input or requested output exceeds the preregistered maxima, or that would
// exceed the per-turn attempt cap, is never sent. Each attempt also records a
// symmetric transport outcome for the infrastructure stop rule.
// With dataModule (r2), the case data, token digest and expiry come from a
// separate generated module, so the runtime code bytes are identical for the
// development smoke, every holdout segment and the dry-run.
export function createPairedWorkerSource({ root, cases, digest, expiresAt, providerDispatchesPerTurn = 20, preSend = null,
  dataModule = null }) {
  const source = (path) => JSON.stringify(`${root}/${path}`);
  return `
import { createWeeklyPlanningSemanticNormalizerV5 } from ${source('src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerV5.ts')};
import { dispatchFocusedContextual } from ${source('workers/ai-proxy/src/decision/focusedContextualDispatch.ts')};
import { createOpenRouterDecisionProvider } from ${source('workers/ai-proxy/src/decision/openRouterDecisionProvider.ts')};
import { CONTEXTUAL_DECISION_CATALOG, CONTEXTUAL_CATALOG_VERSION, CONTEXTUAL_GATE_VERSION, CONTEXTUAL_JEV_TIMEOUT_MS, gateContextualDecision } from ${source('workers/ai-proxy/src/decision/contextualDecisionPolicy.ts')};
import { emptyDispatchDiagnostics, providerRequestId, readProviderError, typedJevDiagnostic } from ${source('scripts/jev-contextual-eval-diagnostics.mjs')};
${dataModule ? `import { CASES, EXPECTED_DIGEST, EXPIRES_AT } from ${JSON.stringify(dataModule)};` : `const CASES = ${JSON.stringify(cases)};
const EXPECTED_DIGEST = ${JSON.stringify(digest)};
const EXPIRES_AT = ${expiresAt};`}
const DISPATCH_BUDGET = ${providerDispatchesPerTurn};
const PRE_SEND = ${JSON.stringify(preSend)};
const known = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const tokens = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const total = (values) => values.some((value) => value === null) ? null : values.reduce((sum, value) => sum + value, 0);

function inputFor(item, arm) {
  const progress = item.progressBasis === true;
  const workload = { publicId: 'workload-question', taskPublicId: 'task-synthetic',
    componentPublicId: null, quantityRole: progress ? 'completed' : 'unknown',
    amount: item.targetAmount, unitCode: item.unitCode, unitLabel: item.unitLabel, rangeStart: null,
    rangeEnd: null, perOccurrence: false, periodExpression: null };
  return {
    userText: item.userText, traceRequestId: 'ctx-paired-' + item.id + '-' + arm,
    publicStateSummary: {
      graphRevision: 31, previousCompatibilityStatus: 'revision_pending',
      pendingQuestion: { actionId: null, questionCode: item.questionCode,
        targetFactId: 'workload-question', graphRevision: 31,
        effortMeasurement: item.questionCode === 'missing_effort_estimate' ? 'total_duration' : null,
        estimateForWorkloadFactId: progress ? 'workload-estimate' : null,
        questionBasis: progress ? 'completed_workload_total' : null },
      workloads: progress ? [workload, { ...workload, publicId: 'workload-estimate', quantityRole: 'remaining', amount: 5 }] : [workload],
      tasks: [{ publicId: 'task-synthetic', category: 'study', title: item.taskTitle }],
      components: [], relations: [],
    },
  };
}

export async function runTurn(item, env, signal, arm, options = {}) {
  const started = Date.now();
  const dispatches = [];
  const diagnosticReads = [];
  let evaluation = null;
  let directRole = null;
  // The harness passes the hard budget still unreserved (USD 5 − settled −
  // open reservations); a send whose reservation would exceed it is refused.
  const budgetRemainingUsd = PRE_SEND && typeof options.budgetRemainingUsd === 'number'
    && Number.isFinite(options.budgetRemainingUsd) && options.budgetRemainingUsd >= 0 ? options.budgetRemainingUsd : 0;
  const preSend = PRE_SEND ? { reserveUsdPerCall: PRE_SEND.maxReservePerCallUsd, budgetRemainingUsd, reservedUsd: 0, reservations: [], refusedSends: 0,
    maxInputTokenBound: null, maxRequestedOutputTokens: null, unaccountedFetchesRefused: 0 } : null;
  // Physical provider sends happen only through the two accounted wrappers.
  // In r2 mode any other fetch during the turn is refused and reported, so an
  // internal fallback/retry/background path cannot escape the reservation.
  const rawFetch = globalThis.fetch;
  // Run-wide stop state (§17/§18/§18a) carried in from the harness ledger and
  // evaluated after every physical provider result: the first crossing is
  // latched, so a later success can never dilute it, and no further send
  // happens in this turn. Configuration and tariff failures latch too.
  const runState = { attempts: 0, infrastructureFailures: 0, consecutiveInfrastructureFailures: 0 };
  if (PRE_SEND) {
    const given = options.runState ?? {};
    for (const key of Object.keys(runState)) {
      if (Number.isSafeInteger(given[key]) && given[key] >= 0) runState[key] = given[key];
    }
  }
  let stopLatched = PRE_SEND && options.runState === undefined ? 'run_state_missing' : null;
  const latch = (reason) => { if (stopLatched === null) stopLatched = reason; };
  // Per response: an amount the provider reported, or the usage upper bound
  // under the frozen rates, above this call's reservation means the hard cap
  // is no longer provable, so the run stop is latched before any further send.
  // Missing usage cannot be bounded and simply keeps the reservation (ledger).
  const checkChargeWithinReservation = (dispatch) => {
    const reserve = preSend.reservations[dispatches.indexOf(dispatch)];
    const rates = PRE_SEND[dispatch.provider];
    const reported = typeof dispatch.costUsd === 'number' && Number.isFinite(dispatch.costUsd) ? dispatch.costUsd : null;
    const complete = Number.isSafeInteger(dispatch.inputTokens) && dispatch.inputTokens >= 0
      && Number.isSafeInteger(dispatch.outputTokens) && dispatch.outputTokens >= 0;
    const bound = complete ? dispatch.inputTokens * rates.inputUsdPerMillionTokens / 1e6
      + dispatch.outputTokens * rates.outputUsdPerMillionTokens / 1e6 : null;
    if (!(reserve > 0) || reported !== null && reported > reserve + 1e-12 || bound !== null && bound > reserve + 1e-12) {
      latch('pricing_contract_violated');
    }
  };
  const recordAttempt = (dispatch) => {
    if (!preSend) return;
    checkChargeWithinReservation(dispatch);
    const status = dispatch.httpStatus;
    const kind = dispatch.outcome === 'response' ? 'ok' : dispatch.outcome === 'invalid_response' ? 'invalid'
      : dispatch.outcome === 'network_failure' || dispatch.outcome === 'timeout' ? 'infra'
        : dispatch.outcome === 'http_failure' && (status >= 500 || status === 429 || status === 408) ? 'infra' : 'config';
    runState.attempts += 1;
    if (kind === 'infra') { runState.infrastructureFailures += 1; runState.consecutiveInfrastructureFailures += 1; }
    else runState.consecutiveInfrastructureFailures = 0;
    if (kind === 'config') latch('configuration_failure');
    const rule = PRE_SEND.stopRule;
    if (runState.attempts >= rule.minimumAttempts) {
      if (runState.infrastructureFailures / runState.attempts > rule.maxProviderFailureRate) latch('provider_failure_rate_exceeded');
    } else if (runState.consecutiveInfrastructureFailures >= rule.earlyConsecutiveInfrastructureFailures) {
      latch('consecutive_infrastructure_failures');
    }
  };
  const refuse = (message) => { if (preSend) preSend.refusedSends += 1; throw new Error(message); };
  const checkBudget = (provider, body, requestedOutputTokens, url) => {
    if (dispatches.length >= DISPATCH_BUDGET) refuse('Preregistered dispatch budget exhausted before provider exposure.');
    if (!preSend) return;
    if (stopLatched !== null) refuse('Run stop latched (' + stopLatched + '); no further provider exposure.');
    if (typeof body !== 'string') refuse('Unbounded request body refused before provider exposure.');
    const rates = PRE_SEND[provider];
    if (String(url) !== rates.endpoint) refuse('Endpoint differs from the pinned pricing contract.');
    let parsed = null;
    try { parsed = JSON.parse(body); } catch { refuse('Unparseable request body refused before provider exposure.'); }
    if (parsed?.model !== rates.model) refuse('Request model differs from the pinned pricing contract.');
    // Omitting service_tier means "auto" (project setting), so Luna must ask
    // for "default" (standard tariff) explicitly; Jev has no tier parameter.
    if (provider === 'luna' ? parsed?.service_tier !== 'default' : parsed && Object.hasOwn(parsed, 'service_tier')) {
      refuse('Service tier request outside the pinned tariff.');
    }
    // Byte-level BPE tokens cover at least one byte, so UTF-8 bytes plus the
    // preregistered framing overhead bound the provider's input tokens.
    const inputBound = new TextEncoder().encode(body).length + rates.inputTokenOverheadPerCall;
    if (inputBound > rates.maxInputTokensPerCall) refuse('Input bound exceeds the preregistered reservation.');
    let outputTerm = 0;
    if (provider === 'luna') {
      if (!Number.isSafeInteger(requestedOutputTokens) || requestedOutputTokens <= 0
        || requestedOutputTokens > rates.maxOutputTokensPerCall) refuse('Output limit exceeds the preregistered reservation.');
      outputTerm = requestedOutputTokens * rates.outputUsdPerMillionTokens / 1e6;
    } else if (requestedOutputTokens !== undefined) refuse('Jev pricing contract has no output limit.');
    const reserve = rates.perCallMarginUsd + inputBound * rates.inputUsdPerMillionTokens / 1e6 + outputTerm;
    if (!(reserve > 0) || reserve > PRE_SEND.maxReservePerCallUsd + 1e-12) refuse('Call reservation outside the preregistered bound.');
    if (preSend.reservedUsd + reserve > budgetRemainingUsd + 1e-12) refuse('Hard budget would be exceeded; not sent.');
    preSend.maxInputTokenBound = Math.max(preSend.maxInputTokenBound ?? 0, inputBound);
    if (provider === 'luna') preSend.maxRequestedOutputTokens = Math.max(preSend.maxRequestedOutputTokens ?? 0, requestedOutputTokens);
    preSend.reservations.push(reserve); // the send follows immediately, so one reservation per attempt
    preSend.reservedUsd += reserve;
  };
  const abortOutcome = (error) => error?.name === 'AbortError' || error?.name === 'TimeoutError' ? 'timeout' : 'network_failure';
  const newDispatch = (provider, phase) => ({ provider, phase, status: 'dispatched', inputTokens: null, outputTokens: null, costUsd: null,
    evalDiagnostics: emptyDispatchDiagnostics(provider),
    ...(preSend ? { outcome: null, httpStatus: null, servedModel: null, serviceTier: null } : {}) });
  const observeHeaders = (dispatch, response, sentAt) => {
    dispatch.evalDiagnostics.elapsedToHeadersMs = Math.max(0, Date.now() - sentAt);
    dispatch.evalDiagnostics.requestId = providerRequestId(response.headers, dispatch.provider);
    if (!response.ok) {
      // Read a clone without awaiting it in the response/gate/stop path. A
      // stalled diagnostic read cannot delay the provider's original response.
      try {
        diagnosticReads.push(readProviderError(response.clone()).then((error) => {
          dispatch.evalDiagnostics.providerError = error;
        }).catch(() => {
          dispatch.evalDiagnostics.providerError = { type: 'unknown', code: 'unknown', param: 'unknown', bodyStatus: 'read_failure' };
        }));
      } catch {
        dispatch.evalDiagnostics.providerError = { type: 'unknown', code: 'unknown', param: 'unknown', bodyStatus: 'read_failure' };
      }
    }
  };
  const jevOutcome = (evaluation) => {
    if (evaluation.status === 'evaluated') return ['response', null];
    const reason = evaluation.reason;
    if (reason === 'http') return ['http_failure', evaluation.httpStatus ?? null];
    if (reason === 'timeout' || reason === 'cancelled') return ['timeout', null];
    if (reason === 'network') return ['network_failure', null];
    if (reason === 'model_mismatch') return ['model_mismatch', null];
    return ['invalid_response', null];
  };
  const decisionProvider = createOpenRouterDecisionProvider({
    apiKey: env.OPENROUTER_API_KEY, timeoutMs: CONTEXTUAL_JEV_TIMEOUT_MS,
    catalog: CONTEXTUAL_DECISION_CATALOG,
    fetch: async (url, init) => {
      checkBudget('jev', init?.body, undefined, url);
      const dispatch = newDispatch('jev', 'focused');
      dispatches.push(dispatch);
      const sentAt = Date.now();
      try {
        const response = await rawFetch(url, init);
        observeHeaders(dispatch, response, sentAt);
        return response;
      } catch (error) {
        dispatch.status = 'network_failure';
        if (preSend) dispatch.outcome = abortOutcome(error);
        throw error;
      }
    },
  });
  const luna = async (request, requestSignal) => {
    if (!env.OPENAI_API_KEY?.trim() || requestSignal?.aborted) throw new Error('Luna pre-dispatch unavailable.');
    const lunaUrl = 'https://api.openai.com/v1/chat/completions';
    // r2 pins the standard tariff in both arms; the v1 body is unchanged.
    const body = JSON.stringify({ model: 'gpt-5.6-luna', messages: request.messages,
      response_format: request.responseFormat, max_completion_tokens: request.maxCompletionTokens,
      ...(PRE_SEND ? { service_tier: 'default' } : {}) });
    checkBudget('luna', body, request.maxCompletionTokens, lunaUrl);
    const schema = request.responseFormat?.json_schema?.name ?? 'unknown';
    const dispatch = newDispatch('luna', schema);
    dispatches.push(dispatch); // exactly at the actual provider boundary, including failed calls
    try {
      let upstream;
      const sentAt = Date.now();
      try {
        upstream = await rawFetch(lunaUrl, {
          method: 'POST', signal: requestSignal,
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.OPENAI_API_KEY.trim() },
          body,
        });
        observeHeaders(dispatch, upstream, sentAt);
      } catch (error) {
        if (preSend) dispatch.outcome = abortOutcome(error);
        throw error;
      }
      if (!upstream.ok) {
        dispatch.status = 'http_' + upstream.status;
        if (preSend) Object.assign(dispatch, { outcome: 'http_failure', httpStatus: upstream.status });
        throw new Error('Luna HTTP failure.');
      }
      if (preSend) dispatch.outcome = 'invalid_response'; // until a usable body is proven
      let payload;
      try { payload = await upstream.json(); } catch (error) {
        if (preSend && requestSignal?.aborted) dispatch.outcome = 'timeout';
        throw error;
      }
      if (preSend) {
        Object.assign(dispatch, { servedModel: typeof payload?.model === 'string' ? payload.model : null,
          serviceTier: typeof payload?.service_tier === 'string' ? payload.service_tier : null });
        // A served condition that is absent or outside the pinned tariff is
        // never assumed standard: the served ID must be in the frozen list.
        if (dispatch.serviceTier !== 'default' || !PRE_SEND.luna.servedModels.includes(dispatch.servedModel)) {
          latch('pricing_contract_violated');
        }
      }
      dispatch.inputTokens = tokens(payload.usage?.prompt_tokens);
      dispatch.outputTokens = tokens(payload.usage?.completion_tokens);
      // No price estimate or missing cache-details arithmetic masquerades as actual cost.
      dispatch.costUsd = known(payload.usage?.cost);
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) { dispatch.status = 'invalid_response'; throw new Error('Luna response unavailable.'); }
      dispatch.status = 'success';
      if (preSend) dispatch.outcome = 'response';
      return Response.json({ content });
    } catch (error) {
      if (dispatch.status === 'dispatched') dispatch.status = 'failed_after_dispatch';
      throw error;
    } finally {
      if (preSend && dispatch.outcome === null) dispatch.outcome = 'network_failure'; // failed after the send, cause unknown
      recordAttempt(dispatch);
    }
  };
  const client = {
    async createChatCompletion(request) {
      const context = request.decisionContext;
      let response;
      if (context?.purpose === 'focused_contextual_answer') {
        response = await dispatchFocusedContextual({ context,
          env: { OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
            JEV_MODE: arm === 'jevFirst' ? 'canary' : 'off', JEV_CANARY_PERCENT: '100',
            JEV_FOCUSED_CONTEXTUAL_ANSWER_MODE: arm === 'jevFirst' ? 'canary' : 'off',
            JEV_FOCUSED_CONTEXTUAL_ANSWER_CANARY_PERCENT: '100' },
          firebaseUid: 'contextual-synthetic-evaluation', signal,
          fallback: (fallbackSignal) => luna(request, fallbackSignal ?? signal),
          respond: (decision) => {
            if (decision.decision === 'quantity_role_answer') directRole = decision.quantityRole;
            return Response.json({ content: JSON.stringify(decision),
              decisionContext: { requestId: context.requestId, inputRevision: context.inputRevision } });
          },
          provider: { async evaluate(state, providerSignal) {
            const before = dispatches.length;
            evaluation = await decisionProvider.evaluate(state, providerSignal);
            // Attribute the result only to an attempt this evaluation actually
            // sent; a send refused before exposure must not relabel an older one.
            const dispatch = PRE_SEND ? dispatches.slice(before).find((item) => item.provider === 'jev')
              : dispatches.filter((item) => item.provider === 'jev').at(-1);
            if (dispatch) Object.assign(dispatch, { status: evaluation.status,
              inputTokens: evaluation.metadata.inputTokens, outputTokens: evaluation.metadata.outputTokens,
              costUsd: evaluation.metadata.costUsd, ...(preSend ? { servedModel: evaluation.metadata.servedModel ?? null } : {}) });
            if (dispatch) dispatch.evalDiagnostics.jev = typedJevDiagnostic(evaluation,
              gateContextualDecision(evaluation, state.questionCode), CONTEXTUAL_GATE_VERSION);
            if (dispatch && preSend) {
              const [outcome, httpStatus] = jevOutcome(evaluation);
              Object.assign(dispatch, { outcome, httpStatus });
              recordAttempt(dispatch);
              if (outcome === 'response' && !PRE_SEND.jev.servedModels.includes(dispatch.servedModel)) latch('pricing_contract_violated');
            }
            return evaluation;
          } },
        });
      } else response = await luna(request, signal);
      if (!response.ok) throw new Error('Semantic proxy rejection.');
      const payload = await response.json();
      if (payload.decisionContext && (payload.decisionContext.requestId !== context?.requestId
        || payload.decisionContext.inputRevision !== context?.inputRevision)) throw new Error('Stale semantic response.');
      return payload.content;
    },
  };
  if (preSend) globalThis.fetch = async () => {
    preSend.unaccountedFetchesRefused += 1;
    throw new Error('Unaccounted provider exposure refused.');
  };
  let result;
  let elapsedMs;
  try { result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize(inputFor(item, arm)); }
  finally {
    if (preSend) globalThis.fetch = rawFetch;
    elapsedMs = Math.max(0, Date.now() - started);
    // Settle on every exit, including throw/abort, before a caller can persist
    // records. This is outside semantic timing and all send/stop/latch decisions.
    await Promise.allSettled(diagnosticReads);
  }
  return { caseId: item.id, group: item.group, arm, questionCode: item.questionCode,
    catalogVersion: CONTEXTUAL_CATALOG_VERSION, gateVersion: CONTEXTUAL_GATE_VERSION,
    observationComplete: !preSend || preSend.unaccountedFetchesRefused === 0, dispatches,
    lunaDispatches: dispatches.filter((item) => item.provider === 'luna').length,
    elapsedMs, inputTokens: total(dispatches.map((item) => item.inputTokens)),
    outputTokens: total(dispatches.map((item) => item.outputTokens)),
    actualCostUsd: total(dispatches.map((item) => item.costUsd)),
    directRoleAccepted: directRole !== null && result.status === 'accepted',
    selectedRole: directRole, jointCorrect: null,
    semanticResult: { status: result.status, document: result.document,
      contextualDirective: result.contextualDirective ?? null,
      validationErrors: result.diagnostics.validationErrors },
    labelSource: item.labelSource,
    providerStatus: evaluation?.status ?? null,
    ...(preSend ? { preSend: { ...preSend, stopLatched, runStateAfter: { ...runState } } } : {}),
  };
}

// Readiness proves the runtime lets the turn replace and restore the global
// fetch, before any case is run or any provider is exposed.
function fetchGuardAvailable() {
  const original = globalThis.fetch;
  try {
    const probe = async () => { throw new Error('probe'); };
    globalThis.fetch = probe;
    const replaced = globalThis.fetch === probe;
    globalThis.fetch = original;
    return replaced && globalThis.fetch === original;
  } catch { return false; } finally { if (globalThis.fetch !== original) globalThis.fetch = original; }
}

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export default { async fetch(request, env) {
  if (Date.now() > EXPIRES_AT || await digest(request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '') !== EXPECTED_DIGEST) return new Response('Not found', { status: 404 });
  if (request.method === 'GET') {
    if (!PRE_SEND) return Response.json({ openRouter: Boolean(env.OPENROUTER_API_KEY?.trim()), openAi: Boolean(env.OPENAI_API_KEY?.trim()) });
    // Readiness evaluates no case; any fetch attempted meanwhile is refused and
    // counted, so the zero provider sends are checked mechanically.
    const original = globalThis.fetch;
    let attempts = 0;
    const fetchGuard = fetchGuardAvailable();
    if (fetchGuard) globalThis.fetch = async () => { attempts += 1; throw new Error('No provider exposure during readiness.'); };
    try {
      return Response.json({ openRouter: Boolean(env.OPENROUTER_API_KEY?.trim()), openAi: Boolean(env.OPENAI_API_KEY?.trim()),
        fetchGuard, providerAttemptsDuringReadiness: attempts, cases: CASES.length });
    } finally { globalThis.fetch = original; }
  }
  if (request.method !== 'POST') return new Response('Not found', { status: 404 });
  const body = await request.json();
  const keys = PRE_SEND ? ['caseId', 'arm', 'budgetRemainingUsd', 'runState'] : ['caseId', 'arm'];
  if (!body || typeof body !== 'object' || Object.keys(body).length !== keys.length
    || Object.keys(body).some((key) => !keys.includes(key))
    || !['jevFirst', 'lunaOnly'].includes(body.arm)
    || PRE_SEND && !(typeof body.budgetRemainingUsd === 'number' && Number.isFinite(body.budgetRemainingUsd)
      && body.budgetRemainingUsd >= 0)) return new Response('Invalid request', { status: 400 });
  const item = CASES.find((item) => item.id === body.caseId);
  if (!item) return new Response('Not found', { status: 404 });
  return Response.json(await runTurn(item, env, request.signal, body.arm, { budgetRemainingUsd: body.budgetRemainingUsd, runState: body.runState }),
    { headers: { 'Cache-Control': 'no-store' } });
} };
`;
}
