import type { FocusedAuthorizationDecisionContext } from '../../../../shared/focusedAuthorizationDecision';
import type { AiRequestMetricPayload, AiRequestMetricStatus } from '../../../../shared/productObservabilityContract';
import { createAiRequestId, recordAiRequestMetricBestEffort } from '../aiRequestObservability';
import type { ProductObservabilityEnv } from '../productObservabilityStore';
import type { FirestoreTokenProvider } from '../firestoreServiceAccountClient';
import { createOpenRouterDecisionProvider } from './openRouterDecisionProvider';
import type { DecisionEvaluation, DecisionProvider } from './decisionProvider';
import {
  markJevExecution,
  type JevExecutionMode,
  type LunaBaselineFailure,
} from './decisionExecutionMarker';
import {
  canarySelected, decisionMode, gateDecision, JEV_CATALOG_VERSION, JEV_GATE_VERSION,
  type DecisionGate,
  FOCUSED_REQUEST_TIMEOUT_MS, type DecisionEnv,
} from './decisionPolicy';

class FocusedAuthorizationBaselineError extends Error {
  constructor(
    readonly mode: JevExecutionMode,
    readonly failure: LunaBaselineFailure,
    cause: unknown,
  ) {
    // Keep the original error for Worker logs; telemetry reads only mode/failure.
    super('Focused authorization Luna baseline failed.', { cause });
    this.name = 'FocusedAuthorizationBaselineError';
  }
}

export function resolveFocusedAuthorizationBaselineFailure(
  error: unknown,
): { mode: JevExecutionMode; failure: LunaBaselineFailure } | null {
  return error instanceof FocusedAuthorizationBaselineError
    ? { mode: error.mode, failure: error.failure }
    : null;
}

async function fallbackWithFailureMarker(
  fallback: (signal?: AbortSignal) => Promise<Response>,
  mode: JevExecutionMode,
  failure: () => LunaBaselineFailure,
  signal?: AbortSignal,
): Promise<Response> {
  try {
    return await fallback(signal);
  } catch (error) {
    throw new FocusedAuthorizationBaselineError(mode, failure(), error);
  }
}

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
  /** Evaluation/test hook for a request whose machine revision changed in flight. */
  isContextCurrent?: () => boolean;
}): Promise<Response> {
  const mode = decisionMode(params.env);
  if (mode === 'off') return params.fallback();
  // The key requirement belongs to the default OpenRouter adapter, not the
  // DecisionProvider port. An injected future transport owns its configuration.
  if (!params.provider && !params.env.OPENROUTER_API_KEY?.trim()) return params.fallback();
  const selected = mode === 'canary' && canarySelected(params.env);
  if (mode === 'canary' && !selected) return params.fallback();
  // Without a Worker lifecycle there is no safe, bounded background shadow job.
  if (mode === 'shadow' && !params.executionContext) return params.fallback();

  const provider = params.provider ?? createOpenRouterDecisionProvider({ apiKey: params.env.OPENROUTER_API_KEY });
  const requestId = createAiRequestId();
  const startedAtMs = Date.now();
  const record = async (
    evaluation: DecisionEvaluation,
    baseline: string | null,
    gate: DecisionGate = gateDecision(evaluation),
  ) => {
    const metadata = evaluation.metadata;
    const decision: NonNullable<AiRequestMetricPayload['decision']> = {
      mode, outcome: mode === 'shadow' ? 'shadow' : gate.status === 'accepted' && gate.decision === 'create_plan' ? 'success' : 'fallback',
      gate: gate.status, reason: gate.status === 'accepted' ? null : gate.reason,
      requestedModel: metadata.requestedModel, catalogVersion: JEV_CATALOG_VERSION,
      gateVersion: JEV_GATE_VERSION, inputRevision: params.context.inputRevision,
      rawChoiceMatchesBaseline: baseline !== null && evaluation.status === 'evaluated'
        ? evaluation.decision === baseline : null,
      gatedRouteMatchesBaseline: baseline !== null && gate.status === 'accepted'
        ? gate.decision === baseline : null,
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
      correlation: { requestId: params.context.requestId, stateRevision: params.context.inputRevision },
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
    const baseline = fallbackWithFailureMarker(
      params.fallback,
      mode,
      () => 'network',
    ).then((response) => markJevExecution(response, mode));
    params.executionContext!.waitUntil(
      Promise.all([evaluation, baseline.then(baselineDecision, () => null)])
        .then(([result, decision]) => record(result, decision)).catch(() => undefined),
    );
    return baseline;
  }

  const controller = new AbortController();
  let cancelled = false;
  let timedOut = false;
  const cancel = () => {
    cancelled = true;
    controller.abort();
  };
  params.signal.addEventListener('abort', cancel, { once: true });
  if (params.signal.aborted) cancel();
  const timer = setTimeout(() => {
    if (controller.signal.aborted) return;
    timedOut = true;
    controller.abort();
  }, FOCUSED_REQUEST_TIMEOUT_MS);
  try {
    const evaluation = await provider.evaluate(params.context.state, controller.signal);
    const gate: DecisionGate = params.isContextCurrent?.() === false
      ? { status: 'unavailable', reason: 'stale_context' }
      : gateDecision(evaluation);
    const metric = record(evaluation, null, gate).catch(() => undefined);
    if (params.executionContext) params.executionContext.waitUntil(metric);
    else await metric;
    if (controller.signal.aborted) throw new Error('Focused authorization request cancelled or timed out.');
    if (gate.status === 'accepted') return markJevExecution(params.respond(gate.decision), mode);
    return markJevExecution(await fallbackWithFailureMarker(
      params.fallback,
      mode,
      () => timedOut ? 'timeout' : cancelled ? 'cancelled' : 'network',
      controller.signal,
    ), mode);
  } finally {
    clearTimeout(timer);
    params.signal.removeEventListener('abort', cancel);
  }
}
