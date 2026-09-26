import type { FocusedAuthorizationDecisionContext } from '../../../../shared/focusedAuthorizationDecision';
import type { AiRequestMetricPayload, AiRequestMetricStatus } from '../../../../shared/productObservabilityContract';
import { createAiRequestId, recordAiRequestMetricBestEffort } from '../aiRequestObservability';
import type { ProductObservabilityEnv } from '../productObservabilityStore';
import type { FirestoreTokenProvider } from '../firestoreServiceAccountClient';
import { createOpenRouterDecisionProvider } from './openRouterDecisionProvider';
import type { DecisionEvaluation, DecisionProvider } from './decisionProvider';
import {
  canarySelected, decisionMode, gateDecision, JEV_CATALOG_VERSION, JEV_GATE_VERSION,
  FOCUSED_REQUEST_TIMEOUT_MS, type DecisionEnv,
} from './decisionPolicy';

function metricStatus(result: DecisionEvaluation): AiRequestMetricStatus {
  if (result.status === 'evaluated') return 'success';
  switch (result.reason) {
    case 'timeout': return 'timeout';
    case 'cancelled': return 'cancelled';
    case 'network': return 'network_failure';
    case 'model_mismatch': case 'invalid_response': return 'invalid_response';
    default: return 'provider_error';
  }
}

async function baselineDecision(response: Response): Promise<string | null> {
  try {
    const payload = await response.clone().json() as { content?: string };
    const decision = JSON.parse(payload.content ?? '').decision;
    return decision === 'create_plan' || decision === 'fallback' ? decision : null;
  } catch { return null; }
}

export async function dispatchFocusedAuthorization(params: {
  context: FocusedAuthorizationDecisionContext;
  env: DecisionEnv & ProductObservabilityEnv;
  firebaseUid: string;
  tokenProvider?: FirestoreTokenProvider;
  executionContext?: Pick<ExecutionContext, 'waitUntil'>;
  signal: AbortSignal;
  fallback: (signal?: AbortSignal) => Promise<Response>;
  respond: (decision: 'create_plan' | 'fallback') => Response;
  provider?: DecisionProvider;
}): Promise<Response> {
  const mode = decisionMode(params.env);
  if (mode === 'off') return params.fallback();
  if (!params.env.OPENROUTER_API_KEY?.trim()) return params.fallback();
  const selected = mode === 'canary' && canarySelected(params.env);
  if (mode === 'canary' && !selected) return params.fallback();
  // Without a Worker lifecycle there is no safe, bounded background shadow job.
  if (mode === 'shadow' && !params.executionContext) return params.fallback();

  const provider = params.provider ?? createOpenRouterDecisionProvider({ apiKey: params.env.OPENROUTER_API_KEY });
  const requestId = createAiRequestId();
  const startedAtMs = Date.now();
  const record = async (evaluation: DecisionEvaluation, baseline: string | null) => {
    const gate = gateDecision(evaluation);
    const metadata = evaluation.metadata;
    const decision: NonNullable<AiRequestMetricPayload['decision']> = {
      mode, outcome: mode === 'shadow' ? 'shadow' : gate.status === 'accepted' && gate.decision === 'create_plan' ? 'success' : 'fallback',
      gate: gate.status, reason: gate.status === 'accepted' ? null : gate.reason,
      requestedModel: metadata.requestedModel, catalogVersion: JEV_CATALOG_VERSION,
      gateVersion: JEV_GATE_VERSION, inputRevision: params.context.inputRevision,
      comparisonMatches: baseline !== null && evaluation.status === 'evaluated'
        ? evaluation.decision === baseline : null,
      reportedCostUsd: metadata.costUsd,
      choice: evaluation.status === 'evaluated' ? evaluation.decision : null,
      confidence: evaluation.status === 'evaluated' ? evaluation.confidence : null,
      createPlanProbability: evaluation.status === 'evaluated' ? evaluation.probabilities.create_plan : null,
      fallbackProbability: evaluation.status === 'evaluated' ? evaluation.probabilities.fallback : null,
      conditionChangeProbability: evaluation.status === 'evaluated' ? evaluation.conditionChange : null,
      independentMeaningProbability: evaluation.status === 'evaluated' ? evaluation.independentMeaning : null,
    };
    // Explicit allowlist: no request/response body, user text, key or exception text.
    console.info('[AI Decision]', {
      provider: metadata.provider, model: metadata.servedModel ?? metadata.requestedModel,
      latencyMs: metadata.latencyMs, inputTokens: metadata.inputTokens,
      outputTokens: metadata.outputTokens, ...decision,
    });
    await recordAiRequestMetricBestEffort({
      env: params.env, firestoreTokenProvider: params.tokenProvider, firebaseUid: params.firebaseUid,
      requestId, occurredAt: new Date(startedAtMs).toISOString(), appVersion: 'unknown',
      operationKind: 'decision', purpose: 'weekly_planning_focused_authorization', phase: 'single',
      provider: metadata.provider, model: metadata.servedModel ?? metadata.requestedModel,
      status: metricStatus(evaluation), requestBytes: metadata.requestBytes, responseBytes: metadata.responseBytes,
      usage: {
        promptTokens: metadata.inputTokens, completionTokens: metadata.outputTokens,
        totalTokens: metadata.inputTokens !== null && metadata.outputTokens !== null
          ? metadata.inputTokens + metadata.outputTokens : null,
        cachedTokens: null, cacheWriteTokens: null,
      },
      startedAtMs, nowMs: startedAtMs + metadata.latencyMs, decision,
    });
  };

  if (mode === 'shadow') {
    const evaluation = provider.evaluate(params.context.state);
    const baseline = params.fallback();
    params.executionContext!.waitUntil(
      Promise.all([evaluation, baseline.then(baselineDecision, () => null)])
        .then(([result, decision]) => record(result, decision)).catch(() => undefined),
    );
    return baseline;
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  params.signal.addEventListener('abort', abort, { once: true });
  if (params.signal.aborted) abort();
  const timer = setTimeout(abort, FOCUSED_REQUEST_TIMEOUT_MS);
  try {
    const evaluation = await provider.evaluate(params.context.state, controller.signal);
    const gate = gateDecision(evaluation);
    const metric = record(evaluation, null).catch(() => undefined);
    if (params.executionContext) params.executionContext.waitUntil(metric);
    else await metric;
    if (controller.signal.aborted) throw new Error('Focused authorization request cancelled or timed out.');
    if (gate.status === 'accepted') return params.respond(gate.decision);
    return await params.fallback(controller.signal);
  } finally {
    clearTimeout(timer);
    params.signal.removeEventListener('abort', abort);
  }
}
