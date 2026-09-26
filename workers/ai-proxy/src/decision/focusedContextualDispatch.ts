import type {
  FocusedContextualDecisionContext,
  FocusedContextualDecisionResponse,
} from '../../../../shared/focusedContextualDecision';
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
import {
  CONTEXTUAL_CATALOG_VERSION,
  CONTEXTUAL_DECISION_CATALOG,
  CONTEXTUAL_GATE_VERSION,
  CONTEXTUAL_JEV_TIMEOUT_MS,
  CONTEXTUAL_REQUEST_TIMEOUT_MS,
  contextualCanarySelected,
  contextualDecisionMode,
  gateContextualDecision,
  type ContextualDecision,
  type ContextualDecisionEnv,
} from './contextualDecisionPolicy';
import { createOpenRouterDecisionProvider } from './openRouterDecisionProvider';

class FocusedContextualBaselineError extends Error {
  constructor(
    readonly mode: JevExecutionMode,
    readonly failure: LunaBaselineFailure,
    cause: unknown,
  ) {
    super('Focused contextual Luna baseline failed.', { cause });
    this.name = 'FocusedContextualBaselineError';
  }
}

export function resolveFocusedContextualBaselineFailure(
  error: unknown,
): { mode: JevExecutionMode; failure: LunaBaselineFailure } | null {
  return error instanceof FocusedContextualBaselineError
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
    throw new FocusedContextualBaselineError(mode, failure(), error);
  }
}

function metricStatus(
  result: DecisionEvaluation<ContextualDecision>,
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

type BaselineDecision = {
  decision: 'effort_answer' | 'quantity_role_answer' | 'provisional_timebox' | 'fallback';
  quantityRole: 'target' | 'remaining' | 'completed' | null;
};

async function baselineDecision(response: Response): Promise<BaselineDecision | null> {
  try {
    const payload = await response.clone().json() as { content?: string };
    const parsed = JSON.parse(payload.content ?? '') as Record<string, unknown>;
    if (parsed.decision === 'quantity_role_answer'
      && (parsed.quantityRole === 'target'
        || parsed.quantityRole === 'remaining'
        || parsed.quantityRole === 'completed')) {
      return { decision: parsed.decision, quantityRole: parsed.quantityRole };
    }
    if (parsed.decision === 'effort_answer'
      || parsed.decision === 'provisional_timebox'
      || parsed.decision === 'fallback') {
      return { decision: parsed.decision, quantityRole: null };
    }
    return null;
  } catch {
    return null;
  }
}

function choiceMatchesBaseline(
  choice: ContextualDecision,
  baseline: BaselineDecision | null,
): boolean | null {
  if (!baseline) return null;
  if (choice === 'fallback') return baseline.decision === 'fallback';
  if (choice === 'focused_luna') return null;
  return baseline.decision === 'quantity_role_answer' && baseline.quantityRole === choice;
}

function responseForDecision(
  decision: 'target' | 'remaining' | 'completed' | 'fallback',
): FocusedContextualDecisionResponse {
  if (decision === 'fallback') {
    return {
      decision,
      effortTarget: null,
      effortMeasurement: null,
      minutes: null,
      precision: null,
      quantityRole: null,
    };
  }
  return {
    decision: 'quantity_role_answer',
    effortTarget: null,
    effortMeasurement: null,
    minutes: null,
    precision: null,
    quantityRole: decision,
  };
}

export async function dispatchFocusedContextual(params: {
  context: FocusedContextualDecisionContext;
  env: ContextualDecisionEnv & ProductObservabilityEnv;
  firebaseUid: string;
  tokenProvider?: FirestoreTokenProvider;
  executionContext?: Pick<ExecutionContext, 'waitUntil'>;
  signal: AbortSignal;
  fallback: (signal?: AbortSignal) => Promise<Response>;
  respond: (decision: FocusedContextualDecisionResponse) => Response;
  provider?: DecisionProvider<FocusedContextualDecisionContext['state'], ContextualDecision>;
  isContextCurrent?: () => boolean;
}): Promise<Response> {
  const mode = contextualDecisionMode(params.env);
  if (mode === 'off') return params.fallback();
  if (!params.provider && !params.env.OPENROUTER_API_KEY?.trim()) return params.fallback();
  const selected = mode === 'canary' && contextualCanarySelected(params.env);
  if (mode === 'canary' && !selected) return params.fallback();
  if (mode === 'shadow' && !params.executionContext) return params.fallback();

  const provider = params.provider ?? createOpenRouterDecisionProvider<
    FocusedContextualDecisionContext['state'],
    ContextualDecision
  >({
    apiKey: params.env.OPENROUTER_API_KEY,
    timeoutMs: CONTEXTUAL_JEV_TIMEOUT_MS,
    catalog: CONTEXTUAL_DECISION_CATALOG,
  });
  const requestId = createAiRequestId();
  const startedAtMs = Date.now();
  const record = async (
    evaluation: DecisionEvaluation<ContextualDecision>,
    baseline: BaselineDecision | null,
  ) => {
    const gate = gateContextualDecision(evaluation, params.context.questionCode);
    const metadata = evaluation.metadata;
    const rawChoiceMatchesBaseline = evaluation.status === 'evaluated'
      ? choiceMatchesBaseline(evaluation.decision, baseline)
      : null;
    const gatedRouteMatchesBaseline = gate.status === 'accepted'
      ? choiceMatchesBaseline(gate.decision, baseline)
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
      catalogVersion: CONTEXTUAL_CATALOG_VERSION,
      gateVersion: CONTEXTUAL_GATE_VERSION,
      inputRevision: params.context.inputRevision,
      rawChoiceMatchesBaseline,
      gatedRouteMatchesBaseline,
      reportedCostUsd: metadata.costUsd,
      // The shared v1 decision telemetry schema has authorization-specific choice
      // columns. Contextual choice stays in the typed log below; purpose/version
      // distinguish the persisted row without placing user text in telemetry.
      choice: null,
      confidence: evaluation.status === 'evaluated' ? evaluation.confidence : null,
      createPlanProbability: null,
      fallbackProbability: null,
      conditionChangeProbability: evaluation.status === 'evaluated'
        ? evaluation.conditionChange : null,
      independentMeaningProbability: evaluation.status === 'evaluated'
        ? evaluation.independentMeaning : null,
    };
    console.info('[AI Decision]', {
      purpose: 'weekly_planning_focused_contextual_answer',
      provider: metadata.provider,
      model: metadata.servedModel ?? metadata.requestedModel,
      latencyMs: metadata.latencyMs,
      inputTokens: metadata.inputTokens,
      outputTokens: metadata.outputTokens,
      contextualChoice: evaluation.status === 'evaluated' ? evaluation.decision : null,
      questionCode: params.context.questionCode,
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
      purpose: 'weekly_planning_focused_contextual_answer',
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
  }, CONTEXTUAL_REQUEST_TIMEOUT_MS);
  try {
    const evaluation = await provider.evaluate(params.context.state, controller.signal);
    const gate = gateContextualDecision(evaluation, params.context.questionCode);
    const metric = record(evaluation, null).catch(() => undefined);
    if (params.executionContext) params.executionContext.waitUntil(metric);
    else await metric;
    if (controller.signal.aborted) {
      throw new Error('Focused contextual request cancelled or timed out.');
    }
    if (params.isContextCurrent?.() === false) {
      return markJevExecution(await fallbackWithFailureMarker(
        params.fallback,
        mode,
        () => 'network',
        controller.signal,
      ), mode);
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
