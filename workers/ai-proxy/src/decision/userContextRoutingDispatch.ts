import type {
  UserContextRoutingDecisionContext,
  UserContextRoutingDecisionResponse,
} from '../../../../shared/userContextRoutingDecision';
import type {
  AiRequestMetricPayload,
  AiRequestMetricStatus,
} from '../../../../shared/productObservabilityContract';
import { createAiRequestId, recordAiRequestMetricBestEffort } from '../aiRequestObservability';
import type { FirestoreTokenProvider } from '../firestoreServiceAccountClient';
import type { ProductObservabilityEnv } from '../productObservabilityStore';
import {
  markJevExecution,
  type JevExecutionMode,
  type LunaBaselineFailure,
} from './decisionExecutionMarker';
import type { DecisionEvaluation, DecisionProvider } from './decisionProvider';
import { createOpenRouterDecisionProvider } from './openRouterDecisionProvider';
import {
  gateUserContextRoutingDecision,
  USER_CONTEXT_ROUTING_CATALOG_VERSION,
  USER_CONTEXT_ROUTING_DECISION_CATALOG,
  USER_CONTEXT_ROUTING_GATE_VERSION,
  USER_CONTEXT_ROUTING_JEV_TIMEOUT_MS,
  USER_CONTEXT_ROUTING_REQUEST_TIMEOUT_MS,
  userContextRoutingCanarySelected,
  userContextRoutingDecisionMode,
  type UserContextRoutingDecision,
  type UserContextRoutingDecisionEnv,
} from './userContextRoutingPolicy';

class UserContextRoutingBaselineError extends Error {
  constructor(
    readonly mode: JevExecutionMode,
    readonly failure: LunaBaselineFailure,
    cause: unknown,
  ) {
    super('User-context routing Luna baseline failed.', { cause });
    this.name = 'UserContextRoutingBaselineError';
  }
}

export function resolveUserContextRoutingBaselineFailure(
  error: unknown,
): { mode: JevExecutionMode; failure: LunaBaselineFailure } | null {
  return error instanceof UserContextRoutingBaselineError
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
    throw new UserContextRoutingBaselineError(mode, failure(), error);
  }
}

function metricStatus(
  result: DecisionEvaluation<UserContextRoutingDecision>,
): AiRequestMetricStatus {
  if (result.status === 'evaluated') return 'success';
  switch (result.reason) {
    case 'timeout': return 'timeout';
    case 'cancelled': return 'cancelled';
    case 'network': return 'network_failure';
    case 'model_mismatch':
    case 'invalid_response': return 'invalid_response';
    default: return 'provider_error';
  }
}

async function baselineDomain(response: Response): Promise<string | null> {
  try {
    const payload = await response.clone().json() as { content?: string };
    const parsed = JSON.parse(payload.content ?? '') as Record<string, unknown>;
    return typeof parsed.targetDomain === 'string' ? parsed.targetDomain : null;
  } catch {
    return null;
  }
}

function responseForDecision(
  decision: Exclude<UserContextRoutingDecision, 'user_context' | 'uncertain'>,
): UserContextRoutingDecisionResponse {
  return { decision: 'external_owner', targetDomain: decision };
}

export async function dispatchUserContextRouting(params: {
  context: UserContextRoutingDecisionContext;
  env: UserContextRoutingDecisionEnv & ProductObservabilityEnv;
  firebaseUid: string;
  tokenProvider?: FirestoreTokenProvider;
  executionContext?: Pick<ExecutionContext, 'waitUntil'>;
  signal: AbortSignal;
  fallback: (signal?: AbortSignal) => Promise<Response>;
  respond: (decision: UserContextRoutingDecisionResponse) => Response;
  provider?: DecisionProvider<
    UserContextRoutingDecisionContext['state'],
    UserContextRoutingDecision
  >;
}): Promise<Response> {
  const mode = userContextRoutingDecisionMode(params.env);
  if (mode === 'off') return params.fallback();
  if (!params.provider && !params.env.OPENROUTER_API_KEY?.trim()) return params.fallback();
  const selected = mode === 'canary' && userContextRoutingCanarySelected(params.env);
  if (mode === 'canary' && !selected) return params.fallback();
  if (mode === 'shadow' && !params.executionContext) return params.fallback();

  const provider = params.provider ?? createOpenRouterDecisionProvider<
    UserContextRoutingDecisionContext['state'],
    UserContextRoutingDecision
  >({
    apiKey: params.env.OPENROUTER_API_KEY,
    timeoutMs: USER_CONTEXT_ROUTING_JEV_TIMEOUT_MS,
    catalog: USER_CONTEXT_ROUTING_DECISION_CATALOG,
  });
  const requestId = createAiRequestId();
  const startedAtMs = Date.now();
  const record = async (
    evaluation: DecisionEvaluation<UserContextRoutingDecision>,
    baseline: string | null,
  ) => {
    const gate = gateUserContextRoutingDecision(evaluation);
    const metadata = evaluation.metadata;
    const rawChoiceMatchesBaseline = evaluation.status === 'evaluated' && baseline !== null
      ? evaluation.decision === baseline
      : null;
    const gatedRouteMatchesBaseline = gate.status === 'accepted' && baseline !== null
      ? gate.decision === baseline
      : null;
    const decision: NonNullable<AiRequestMetricPayload['decision']> = {
      mode,
      outcome: mode === 'shadow'
        ? 'shadow'
        : gate.status === 'accepted' ? 'success' : 'fallback',
      gate: gate.status === 'accepted'
        ? 'accepted'
        : gate.status === 'unavailable' ? 'unavailable' : 'abstained',
      reason: gate.status === 'accepted' ? null : gate.reason,
      requestedModel: metadata.requestedModel,
      catalogVersion: USER_CONTEXT_ROUTING_CATALOG_VERSION,
      gateVersion: USER_CONTEXT_ROUTING_GATE_VERSION,
      inputRevision: params.context.inputRevision,
      rawChoiceMatchesBaseline,
      gatedRouteMatchesBaseline,
      reportedCostUsd: metadata.costUsd,
      choice: null,
      confidence: evaluation.status === 'evaluated' ? evaluation.confidence : null,
      createPlanProbability: null,
      fallbackProbability: null,
      conditionChangeProbability: evaluation.status === 'evaluated'
        ? evaluation.conditionChange
        : null,
      independentMeaningProbability: evaluation.status === 'evaluated'
        ? evaluation.independentMeaning
        : null,
    };
    console.info('[AI Decision]', {
      purpose: 'user_context_routing',
      provider: metadata.provider,
      model: metadata.servedModel ?? metadata.requestedModel,
      latencyMs: metadata.latencyMs,
      inputTokens: metadata.inputTokens,
      outputTokens: metadata.outputTokens,
      routingChoice: evaluation.status === 'evaluated' ? evaluation.decision : null,
      ...decision,
    });
    await recordAiRequestMetricBestEffort({
      env: params.env,
      firestoreTokenProvider: params.tokenProvider,
      firebaseUid: params.firebaseUid,
      requestId,
      occurredAt: new Date(startedAtMs).toISOString(),
      appVersion: 'unknown',
      correlation: {
        requestId: params.context.requestId,
        stateRevision: params.context.inputRevision,
      },
      operationKind: 'decision',
      purpose: 'user_context_routing',
      phase: 'single',
      provider: metadata.provider,
      model: metadata.servedModel ?? metadata.requestedModel,
      status: metricStatus(evaluation),
      requestBytes: metadata.requestBytes,
      responseBytes: metadata.responseBytes,
      usage: {
        promptTokens: metadata.inputTokens,
        completionTokens: metadata.outputTokens,
        totalTokens: metadata.inputTokens !== null && metadata.outputTokens !== null
          ? metadata.inputTokens + metadata.outputTokens
          : null,
        cachedTokens: null,
        cacheWriteTokens: null,
      },
      startedAtMs,
      nowMs: startedAtMs + metadata.latencyMs,
      decision,
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
      Promise.all([evaluation, baseline.then(baselineDomain, () => null)])
        .then(([result, domain]) => record(result, domain))
        .catch(() => undefined),
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
  }, USER_CONTEXT_ROUTING_REQUEST_TIMEOUT_MS);
  try {
    const evaluation = await provider.evaluate(params.context.state, controller.signal);
    const gate = gateUserContextRoutingDecision(evaluation);
    const metric = record(evaluation, null).catch(() => undefined);
    if (params.executionContext) params.executionContext.waitUntil(metric);
    else await metric;
    if (controller.signal.aborted) {
      throw new Error('User-context routing request cancelled or timed out.');
    }
    if (gate.status === 'accepted') {
      return markJevExecution(params.respond(responseForDecision(gate.decision)), mode);
    }
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
