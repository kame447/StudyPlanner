import type {
  TemporalSideContributionDecisionContext,
  TemporalSideContributionDecisionResponse,
} from '../../../../shared/temporalSideContributionDecision';
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
  TEMPORAL_SIDE_CONTRIBUTION_CATALOG_VERSION,
  TEMPORAL_SIDE_CONTRIBUTION_DECISION_CATALOG,
  TEMPORAL_SIDE_CONTRIBUTION_GATE_VERSION,
  TEMPORAL_SIDE_CONTRIBUTION_JEV_TIMEOUT_MS,
  TEMPORAL_SIDE_CONTRIBUTION_REQUEST_TIMEOUT_MS,
  gateTemporalSideContributionDecision,
  temporalSideContributionCanarySelected,
  temporalSideContributionDecisionMode,
  type TemporalSideContributionChoice,
  type TemporalSideContributionDecisionEnv,
} from './temporalSideContributionDecisionPolicy';

class TemporalSideContributionBaselineError extends Error {
  constructor(
    readonly mode: JevExecutionMode,
    readonly failure: LunaBaselineFailure,
    cause: unknown,
  ) {
    super('Temporal-side contribution Luna baseline failed.', { cause });
    this.name = 'TemporalSideContributionBaselineError';
  }
}

export function resolveTemporalSideContributionBaselineFailure(
  error: unknown,
): { mode: JevExecutionMode; failure: LunaBaselineFailure } | null {
  return error instanceof TemporalSideContributionBaselineError
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
    throw new TemporalSideContributionBaselineError(mode, failure(), error);
  }
}

function metricStatus(
  result: DecisionEvaluation<TemporalSideContributionChoice>,
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

async function baselineDecision(
  response: Response,
): Promise<'temporal_constraint_present' | 'no_temporal_side_contribution' | null> {
  try {
    const payload = await response.clone().json() as { content?: string };
    const parsed = JSON.parse(payload.content ?? '') as Record<string, unknown>;
    if (parsed.decision === 'temporal_constraint') return 'temporal_constraint_present';
    if (parsed.decision === 'fallback') return 'no_temporal_side_contribution';
    return null;
  } catch {
    return null;
  }
}

export async function dispatchTemporalSideContribution(params: {
  context: TemporalSideContributionDecisionContext;
  env: TemporalSideContributionDecisionEnv & ProductObservabilityEnv;
  firebaseUid: string;
  tokenProvider?: FirestoreTokenProvider;
  executionContext?: Pick<ExecutionContext, 'waitUntil'>;
  signal: AbortSignal;
  fallback: (signal?: AbortSignal) => Promise<Response>;
  respond: (decision: TemporalSideContributionDecisionResponse) => Response;
  provider?: DecisionProvider<
    TemporalSideContributionDecisionContext['state'],
    TemporalSideContributionChoice
  >;
}): Promise<Response> {
  const mode = temporalSideContributionDecisionMode(params.env);
  if (mode === 'off') return params.fallback();
  if (!params.provider && !params.env.OPENROUTER_API_KEY?.trim()) return params.fallback();
  const selected = mode === 'canary' && temporalSideContributionCanarySelected(params.env);
  if (mode === 'canary' && !selected) return params.fallback();
  if (mode === 'shadow' && !params.executionContext) return params.fallback();

  const provider = params.provider ?? createOpenRouterDecisionProvider<
    TemporalSideContributionDecisionContext['state'],
    TemporalSideContributionChoice
  >({
    apiKey: params.env.OPENROUTER_API_KEY,
    timeoutMs: TEMPORAL_SIDE_CONTRIBUTION_JEV_TIMEOUT_MS,
    catalog: TEMPORAL_SIDE_CONTRIBUTION_DECISION_CATALOG,
  });
  const requestId = createAiRequestId();
  const startedAtMs = Date.now();
  const record = async (
    evaluation: DecisionEvaluation<TemporalSideContributionChoice>,
    baseline: 'temporal_constraint_present' | 'no_temporal_side_contribution' | null,
  ) => {
    const gate = gateTemporalSideContributionDecision(evaluation);
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
      catalogVersion: TEMPORAL_SIDE_CONTRIBUTION_CATALOG_VERSION,
      gateVersion: TEMPORAL_SIDE_CONTRIBUTION_GATE_VERSION,
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
      purpose: 'weekly_planning_temporal_side_contribution',
      provider: metadata.provider,
      model: metadata.servedModel ?? metadata.requestedModel,
      latencyMs: metadata.latencyMs,
      inputTokens: metadata.inputTokens,
      outputTokens: metadata.outputTokens,
      temporalSideChoice: evaluation.status === 'evaluated' ? evaluation.decision : null,
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
      purpose: 'weekly_planning_temporal_side_contribution',
      phase: 'normalization',
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
      Promise.all([evaluation, baseline.then(baselineDecision, () => null)])
        .then(([result, lunaDecision]) => record(result, lunaDecision))
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
  }, TEMPORAL_SIDE_CONTRIBUTION_REQUEST_TIMEOUT_MS);
  try {
    const evaluation = await provider.evaluate(params.context.state, controller.signal);
    const gate = gateTemporalSideContributionDecision(evaluation);
    const metric = record(evaluation, null).catch(() => undefined);
    if (params.executionContext) params.executionContext.waitUntil(metric);
    else await metric;
    if (controller.signal.aborted) {
      throw new Error('Temporal-side contribution request cancelled or timed out.');
    }
    if (gate.status === 'accepted') {
      return markJevExecution(params.respond({ decision: gate.decision }), mode);
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
