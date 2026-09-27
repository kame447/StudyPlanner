import type {
  ProposalResponseDecision,
  ProposalResponseDecisionContent,
  ProposalResponseDecisionContext,
} from '../../../../shared/proposalResponseDecision';
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
  PROPOSAL_RESPONSE_CATALOG_VERSION,
  PROPOSAL_RESPONSE_DECISION_CATALOG,
  PROPOSAL_RESPONSE_GATE_VERSION,
  PROPOSAL_RESPONSE_JEV_TIMEOUT_MS,
  PROPOSAL_RESPONSE_REQUEST_TIMEOUT_MS,
  gateProposalResponseDecision,
  proposalResponseCanarySelected,
  proposalResponseDecisionMode,
  type ProposalResponseDecisionEnv,
} from './proposalResponseDecisionPolicy';

class ProposalResponseBaselineError extends Error {
  constructor(
    readonly mode: JevExecutionMode,
    readonly failure: LunaBaselineFailure,
    cause: unknown,
  ) {
    super('Proposal-response generic Luna baseline failed.', { cause });
    this.name = 'ProposalResponseBaselineError';
  }
}

export function resolveProposalResponseBaselineFailure(
  error: unknown,
): { mode: JevExecutionMode; failure: LunaBaselineFailure } | null {
  return error instanceof ProposalResponseBaselineError
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
    throw new ProposalResponseBaselineError(mode, failure(), error);
  }
}

function metricStatus(
  result: DecisionEvaluation<ProposalResponseDecision>,
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

const EMPTY_WHEN_PURE_REJECT = [
  'tasks',
  'relations',
  'availabilityDeclarations',
  'constraintSourceRequests',
  'uncertainties',
  'corrections',
] as const;

/**
 * Shadow comparison only: whether the generic Luna document is a pure rejection of
 * one proposal. Never used for routing or applied to state.
 */
export function proposalResponseBaselineFromDocument(
  content: string | undefined,
): ProposalResponseDecision | null {
  try {
    const parsed = JSON.parse(content ?? '') as Record<string, unknown>;
    const decisions = parsed.decisions;
    if (!Array.isArray(decisions)) return null;
    const pure = decisions.length === 1
      && typeof decisions[0] === 'object'
      && decisions[0] !== null
      && (decisions[0] as { decision?: unknown }).decision === 'reject'
      && (decisions[0] as { target?: { kind?: unknown } }).target?.kind === 'proposal'
      && parsed.planningWindow === null
      && EMPTY_WHEN_PURE_REJECT.every((key) =>
        Array.isArray(parsed[key]) && (parsed[key] as unknown[]).length === 0);
    return pure ? 'reject_only' : 'other';
  } catch {
    return null;
  }
}

async function baselineDecision(response: Response): Promise<ProposalResponseDecision | null> {
  try {
    const payload = await response.clone().json() as { content?: string };
    return proposalResponseBaselineFromDocument(payload.content);
  } catch {
    return null;
  }
}

export async function dispatchProposalResponse(params: {
  context: ProposalResponseDecisionContext;
  env: ProposalResponseDecisionEnv & ProductObservabilityEnv;
  firebaseUid: string;
  tokenProvider?: FirestoreTokenProvider;
  executionContext?: Pick<ExecutionContext, 'waitUntil'>;
  signal: AbortSignal;
  fallback: (signal?: AbortSignal) => Promise<Response>;
  respond: (content: ProposalResponseDecisionContent) => Response;
  provider?: DecisionProvider<
    ProposalResponseDecisionContext['state'],
    ProposalResponseDecision
  >;
}): Promise<Response> {
  const mode = proposalResponseDecisionMode(params.env);
  if (mode === 'off') return params.fallback();
  if (!params.provider && !params.env.OPENROUTER_API_KEY?.trim()) return params.fallback();
  const selected = mode === 'canary' && proposalResponseCanarySelected(params.env);
  if (mode === 'canary' && !selected) return params.fallback();
  if (mode === 'shadow' && !params.executionContext) return params.fallback();

  const provider = params.provider ?? createOpenRouterDecisionProvider<
    ProposalResponseDecisionContext['state'],
    ProposalResponseDecision
  >({
    apiKey: params.env.OPENROUTER_API_KEY,
    timeoutMs: PROPOSAL_RESPONSE_JEV_TIMEOUT_MS,
    catalog: PROPOSAL_RESPONSE_DECISION_CATALOG,
  });
  const requestId = createAiRequestId();
  const startedAtMs = Date.now();
  const record = async (
    evaluation: DecisionEvaluation<ProposalResponseDecision>,
    baseline: ProposalResponseDecision | null,
  ) => {
    const gate = gateProposalResponseDecision(evaluation);
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
      catalogVersion: PROPOSAL_RESPONSE_CATALOG_VERSION,
      gateVersion: PROPOSAL_RESPONSE_GATE_VERSION,
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
      purpose: 'weekly_planning_proposal_response',
      provider: metadata.provider,
      model: metadata.servedModel ?? metadata.requestedModel,
      latencyMs: metadata.latencyMs,
      inputTokens: metadata.inputTokens,
      outputTokens: metadata.outputTokens,
      proposalResponseChoice: evaluation.status === 'evaluated' ? evaluation.decision : null,
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
      purpose: 'weekly_planning_proposal_response',
      phase: 'initial',
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
  }, PROPOSAL_RESPONSE_REQUEST_TIMEOUT_MS);
  try {
    const evaluation = await provider.evaluate(params.context.state, controller.signal);
    const gate = gateProposalResponseDecision(evaluation);
    const metric = record(evaluation, null).catch(() => undefined);
    if (params.executionContext) params.executionContext.waitUntil(metric);
    else await metric;
    if (controller.signal.aborted) {
      throw new Error('Proposal-response request cancelled or timed out.');
    }
    if (gate.status === 'accepted') {
      return markJevExecution(params.respond({
        proposalResponse: {
          decision: gate.decision,
          requestId: params.context.requestId,
          inputRevision: params.context.inputRevision,
        },
      }), mode);
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
