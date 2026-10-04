// Build an evaluation-only Worker that runs the real semantic normalizer in
// both arms. No renderer, scheduler, persistence, or production telemetry sink.
export function createPairedWorkerSource({ root, cases, digest, expiresAt, providerDispatchesPerTurn = 20 }) {
  const source = (path) => JSON.stringify(`${root}/${path}`);
  return `
import { createWeeklyPlanningSemanticNormalizerV5 } from ${source('src/features/weeklyPlanning/semantic/weeklyPlanningSemanticNormalizerV5.ts')};
import { dispatchFocusedContextual } from ${source('workers/ai-proxy/src/decision/focusedContextualDispatch.ts')};
import { createOpenRouterDecisionProvider } from ${source('workers/ai-proxy/src/decision/openRouterDecisionProvider.ts')};
import { CONTEXTUAL_DECISION_CATALOG, CONTEXTUAL_CATALOG_VERSION, CONTEXTUAL_GATE_VERSION, CONTEXTUAL_JEV_TIMEOUT_MS } from ${source('workers/ai-proxy/src/decision/contextualDecisionPolicy.ts')};
const CASES = ${JSON.stringify(cases)};
const EXPECTED_DIGEST = ${JSON.stringify(digest)};
const EXPIRES_AT = ${expiresAt};
const DISPATCH_BUDGET = ${providerDispatchesPerTurn};
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

export async function runTurn(item, env, signal, arm) {
  const started = Date.now();
  const dispatches = [];
  let evaluation = null;
  let directRole = null;
  const checkBudget = () => {
    if (dispatches.length >= DISPATCH_BUDGET) throw new Error('Preregistered dispatch budget exhausted before provider exposure.');
  };
  const decisionProvider = createOpenRouterDecisionProvider({
    apiKey: env.OPENROUTER_API_KEY, timeoutMs: CONTEXTUAL_JEV_TIMEOUT_MS,
    catalog: CONTEXTUAL_DECISION_CATALOG,
    fetch: async (url, init) => {
      checkBudget();
      const dispatch = { provider: 'jev', phase: 'focused', status: 'dispatched', inputTokens: null, outputTokens: null, costUsd: null };
      dispatches.push(dispatch);
      try { return await fetch(url, init); } catch (error) { dispatch.status = 'network_failure'; throw error; }
    },
  });
  const luna = async (request, requestSignal) => {
    if (!env.OPENAI_API_KEY?.trim() || requestSignal?.aborted) throw new Error('Luna pre-dispatch unavailable.');
    checkBudget();
    const schema = request.responseFormat?.json_schema?.name ?? 'unknown';
    const dispatch = { provider: 'luna', phase: schema, status: 'dispatched', inputTokens: null, outputTokens: null, costUsd: null };
    dispatches.push(dispatch); // exactly at the actual provider boundary, including failed calls
    try {
      const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', signal: requestSignal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.OPENAI_API_KEY.trim() },
        body: JSON.stringify({ model: 'gpt-5.6-luna', messages: request.messages,
          response_format: request.responseFormat, max_completion_tokens: request.maxCompletionTokens }),
      });
      if (!upstream.ok) { dispatch.status = 'http_' + upstream.status; throw new Error('Luna HTTP failure.'); }
      const payload = await upstream.json();
      dispatch.inputTokens = tokens(payload.usage?.prompt_tokens);
      dispatch.outputTokens = tokens(payload.usage?.completion_tokens);
      // No price estimate or missing cache-details arithmetic masquerades as actual cost.
      dispatch.costUsd = known(payload.usage?.cost);
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) { dispatch.status = 'invalid_response'; throw new Error('Luna response unavailable.'); }
      dispatch.status = 'success';
      return Response.json({ content });
    } catch (error) {
      if (dispatch.status === 'dispatched') dispatch.status = 'failed_after_dispatch';
      throw error;
    }
  };
  const client = {
    async createChatCompletion(request) {
      const context = request.decisionContext;
      let response;
      if (context?.purpose === 'focused_contextual_answer') {
        response = await dispatchFocusedContextual({ context,
          env: { OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
            JEV_MODE: arm === 'jevFirst' ? 'canary' : 'off', JEV_CANARY_PERCENT: '100' },
          firebaseUid: 'contextual-synthetic-evaluation', signal,
          fallback: (fallbackSignal) => luna(request, fallbackSignal ?? signal),
          respond: (decision) => {
            if (decision.decision === 'quantity_role_answer') directRole = decision.quantityRole;
            return Response.json({ content: JSON.stringify(decision),
              decisionContext: { requestId: context.requestId, inputRevision: context.inputRevision } });
          },
          provider: { async evaluate(state, providerSignal) {
            evaluation = await decisionProvider.evaluate(state, providerSignal);
            const dispatch = dispatches.filter((item) => item.provider === 'jev').at(-1);
            if (dispatch) Object.assign(dispatch, { status: evaluation.status,
              inputTokens: evaluation.metadata.inputTokens, outputTokens: evaluation.metadata.outputTokens,
              costUsd: evaluation.metadata.costUsd });
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
  const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize(inputFor(item, arm));
  const elapsedMs = Math.max(0, Date.now() - started);
  return { caseId: item.id, group: item.group, arm, questionCode: item.questionCode,
    catalogVersion: CONTEXTUAL_CATALOG_VERSION, gateVersion: CONTEXTUAL_GATE_VERSION,
    observationComplete: true, dispatches,
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
  };
}

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export default { async fetch(request, env) {
  if (Date.now() > EXPIRES_AT || await digest(request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '') !== EXPECTED_DIGEST) return new Response('Not found', { status: 404 });
  if (request.method === 'GET') return Response.json({ openRouter: Boolean(env.OPENROUTER_API_KEY?.trim()), openAi: Boolean(env.OPENAI_API_KEY?.trim()) });
  if (request.method !== 'POST') return new Response('Not found', { status: 404 });
  const body = await request.json();
  if (!body || typeof body !== 'object' || Object.keys(body).length !== 2
    || Object.keys(body).some((key) => key !== 'caseId' && key !== 'arm')
    || !['jevFirst', 'lunaOnly'].includes(body.arm)) return new Response('Invalid request', { status: 400 });
  const item = CASES.find((item) => item.id === body.caseId);
  if (!item) return new Response('Not found', { status: 404 });
  return Response.json(await runTurn(item, env, request.signal, body.arm), { headers: { 'Cache-Control': 'no-store' } });
} };
`;
}
