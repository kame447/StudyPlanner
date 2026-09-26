import type { FocusedAuthorizationDecisionContext } from '../../../../../shared/focusedAuthorizationDecision';
import {
  dispatchFocusedAuthorization,
  resolveFocusedAuthorizationBaselineFailure,
} from '../focusedAuthorizationDispatch';
import { gateDecision, type DecisionGate } from '../decisionPolicy';
import type {
  AuthorizationDecision,
  DecisionEvaluation,
  DecisionProvider,
} from '../decisionProvider';
import { exactClopperPearsonUpperBound95 } from './focusedAuthorizationJevLunaComparison';
import type {
  LunaFocusedAuthorizationEvaluation,
  LunaFocusedAuthorizationEvaluator,
} from './focusedAuthorizationLunaEvaluation';

export type FocusedAuthorizationFirstRoute =
  | 'jev_accepted_create'
  | 'jev_accepted_fallback'
  | 'abstain_to_luna'
  | 'unavailable_to_luna'
  | 'stale_context_to_luna';

export interface FocusedAuthorizationFirstRouteCandidate {
  id: string;
  conversationGroupId: string;
  layer: string;
  split: 'tuning' | 'holdout';
  currentUserText: string;
  lastAssistantMessage: string | null;
  expected?: AuthorizationDecision;
  labelStatus: string;
}

export interface FocusedAuthorizationFirstRouteCaseResult {
  id: string;
  conversationGroupId: string;
  layer: string;
  split: 'tuning' | 'holdout';
  expected: AuthorizationDecision | null;
  labelStatus: string;
  route: FocusedAuthorizationFirstRoute;
  jev: {
    status: DecisionEvaluation['status'];
    gate: DecisionGate['status'];
    decision: AuthorizationDecision | null;
    reason: string | null;
    confidence: number | null;
    probabilities: Record<AuthorizationDecision, number> | null;
    conditionChange: number | null;
    independentMeaning: number | null;
    latencyMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
  };
  luna: {
    called: boolean;
    status: LunaFocusedAuthorizationEvaluation['status'] | null;
    decision: AuthorizationDecision | null;
    reason: string | null;
    latencyMs: number | null;
    promptTokens: number | null;
    completionTokens: number | null;
    costUsd: number | null;
  };
  final: {
    status: 'evaluated' | 'controlled_failure';
    decision: AuthorizationDecision | null;
    httpStatus: number;
    totalLatencyMs: number;
    continuesToGenericSemantic: boolean;
  };
  authority: {
    maximumEffect: 'unsaved_draft_request';
    approvalGranted: false;
    saveGranted: false;
  };
}

export interface FocusedAuthorizationFirstRouteSummary {
  caseCount: number;
  binaryLabeledCaseCount: number;
  labelStatusCounts: Record<string, number>;
  routes: Record<FocusedAuthorizationFirstRoute, number>;
  jevCoverage: { numerator: number; denominator: number; value: number | null };
  lunaCallReduction: { numerator: number; denominator: number; value: number | null };
  falseCreate: {
    occurrences: number;
    negativeSampleCount: number;
    oneSidedClopperPearsonUpper95: number | null;
  };
  jevAutoFalseCreate: {
    occurrences: number;
    negativeSampleCount: number;
    oneSidedClopperPearsonUpper95: number | null;
  };
  controlledFailureCount: number;
  finalAccuracy: { numerator: number; denominator: number; value: number | null };
  latencyMs: { p50: number | null; p95: number | null };
  usage: {
    jevInputTokens: NullableTotal;
    jevOutputTokens: NullableTotal;
    lunaPromptTokens: NullableTotal;
    lunaCompletionTokens: NullableTotal;
  };
  costUsd: NullableTotal;
}

interface NullableTotal {
  componentCount: number;
  reportedComponentCount: number;
  unknownComponentCount: number;
  knownSubtotal: number | null;
  completeTotal: number | null;
}

function ratio(numerator: number, denominator: number) {
  return { numerator, denominator, value: denominator === 0 ? null : numerator / denominator };
}

function percentile(values: readonly number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)] ?? null;
}

function nullableTotal(values: readonly (number | null)[]): NullableTotal {
  const known = values.filter((value): value is number => value !== null);
  const knownSubtotal = known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0);
  return {
    componentCount: values.length,
    reportedComponentCount: known.length,
    unknownComponentCount: values.length - known.length,
    knownSubtotal,
    completeTotal: known.length === values.length ? knownSubtotal ?? 0 : null,
  };
}

function parseDecision(response: Response): Promise<AuthorizationDecision | null> {
  return response.clone().json().then((body: unknown) => {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
    const content = (body as { content?: unknown }).content;
    if (typeof content !== 'string') return null;
    try {
      const decision = (JSON.parse(content) as { decision?: unknown }).decision;
      return decision === 'create_plan' || decision === 'fallback' ? decision : null;
    } catch {
      return null;
    }
  }, () => null);
}

function routeFor(gate: DecisionGate, contextCurrent: boolean): FocusedAuthorizationFirstRoute {
  if (!contextCurrent) return 'stale_context_to_luna';
  if (gate.status === 'abstained') return 'abstain_to_luna';
  if (gate.status === 'unavailable') return 'unavailable_to_luna';
  return gate.decision === 'create_plan' ? 'jev_accepted_create' : 'jev_accepted_fallback';
}

function lunaFailureResponse(evaluation: LunaFocusedAuthorizationEvaluation): Response {
  return Response.json({ error: 'Focused authorization provider failed.' }, { status: 502 });
}

export async function evaluateFocusedAuthorizationFirstRouteCase(params: {
  candidate: FocusedAuthorizationFirstRouteCandidate;
  provider: DecisionProvider;
  luna: LunaFocusedAuthorizationEvaluator;
  contextCurrent?: boolean;
  signal?: AbortSignal;
}): Promise<FocusedAuthorizationFirstRouteCaseResult> {
  const startedAt = Date.now();
  const contextCurrent = params.contextCurrent ?? true;
  let jevEvaluation: DecisionEvaluation | null = null;
  let lunaEvaluation: LunaFocusedAuthorizationEvaluation | null = null;
  let lunaCalls = 0;
  const background: Promise<unknown>[] = [];
  const provider: DecisionProvider = {
    async evaluate(state, signal) {
      jevEvaluation = await params.provider.evaluate(state, signal);
      return jevEvaluation;
    },
  };
  const context: FocusedAuthorizationDecisionContext = {
    purpose: 'focused_authorization',
    requestId: `jev-first-eval:${params.candidate.id}`,
    inputRevision: 1,
    previousStatus: 'needs_scope',
    hasTasks: true,
    hasPendingQuestion: false,
    state: {
      currentUserText: params.candidate.currentUserText,
      lastAssistantMessage: params.candidate.lastAssistantMessage,
    },
  };
  let response: Response;
  try {
    response = await dispatchFocusedAuthorization({
      context,
      env: { JEV_MODE: 'canary', JEV_CANARY_PERCENT: '100' },
      firebaseUid: 'jev-first-evaluation',
      executionContext: { waitUntil: (promise) => background.push(promise) },
      signal: params.signal ?? new AbortController().signal,
      fallback: async (signal) => {
        lunaCalls += 1;
        lunaEvaluation = await params.luna.evaluate(context.state, signal);
        if (lunaEvaluation.status !== 'evaluated') return lunaFailureResponse(lunaEvaluation);
        return Response.json({
          content: JSON.stringify({ decision: lunaEvaluation.decision }),
          usage: {
            prompt_tokens: lunaEvaluation.metadata.promptTokens,
            completion_tokens: lunaEvaluation.metadata.completionTokens,
          },
        });
      },
      respond: (decision) => Response.json({ content: JSON.stringify({ decision }) }),
      provider,
      isContextCurrent: () => contextCurrent,
    });
  } catch (error) {
    const failure = resolveFocusedAuthorizationBaselineFailure(error);
    response = Response.json({ error: failure?.failure ?? 'controlled_failure' }, { status: 502 });
  }
  await Promise.allSettled(background);
  if (!jevEvaluation) throw new Error('Jev-first evaluation completed without a provider result.');

  const naturalGate = gateDecision(jevEvaluation);
  const effectiveGate: DecisionGate = contextCurrent
    ? naturalGate
    : { status: 'unavailable', reason: 'stale_context' };
  const finalDecision = await parseDecision(response);
  const luna = lunaEvaluation as LunaFocusedAuthorizationEvaluation | null;
  return {
    id: params.candidate.id,
    conversationGroupId: params.candidate.conversationGroupId,
    layer: params.candidate.layer,
    split: params.candidate.split,
    expected: params.candidate.expected ?? null,
    labelStatus: params.candidate.labelStatus,
    route: routeFor(effectiveGate, contextCurrent),
    jev: {
      status: jevEvaluation.status,
      gate: effectiveGate.status,
      decision: jevEvaluation.status === 'evaluated' ? jevEvaluation.decision : null,
      reason: effectiveGate.status === 'accepted' ? null : effectiveGate.reason,
      confidence: jevEvaluation.status === 'evaluated' ? jevEvaluation.confidence : null,
      probabilities: jevEvaluation.status === 'evaluated' ? jevEvaluation.probabilities : null,
      conditionChange: jevEvaluation.status === 'evaluated' ? jevEvaluation.conditionChange : null,
      independentMeaning: jevEvaluation.status === 'evaluated' ? jevEvaluation.independentMeaning : null,
      latencyMs: jevEvaluation.metadata.latencyMs,
      inputTokens: jevEvaluation.metadata.inputTokens,
      outputTokens: jevEvaluation.metadata.outputTokens,
      costUsd: jevEvaluation.metadata.costUsd,
    },
    luna: {
      called: lunaCalls > 0,
      status: luna?.status ?? null,
      decision: luna?.status === 'evaluated' ? luna.decision : null,
      reason: luna && luna.status !== 'evaluated' ? luna.reason : null,
      latencyMs: luna?.metadata.latencyMs ?? null,
      promptTokens: luna?.metadata.promptTokens ?? null,
      completionTokens: luna?.metadata.completionTokens ?? null,
      costUsd: luna?.metadata.costUsd ?? null,
    },
    final: {
      status: finalDecision === null ? 'controlled_failure' : 'evaluated',
      decision: finalDecision,
      httpStatus: response.status,
      totalLatencyMs: Math.max(0, Date.now() - startedAt),
      continuesToGenericSemantic: finalDecision !== 'create_plan',
    },
    authority: {
      maximumEffect: 'unsaved_draft_request',
      approvalGranted: false,
      saveGranted: false,
    },
  };
}

export function summarizeFocusedAuthorizationFirstRoute(
  cases: readonly FocusedAuthorizationFirstRouteCaseResult[],
): FocusedAuthorizationFirstRouteSummary {
  const binary = cases.filter((value): value is FocusedAuthorizationFirstRouteCaseResult & {
    expected: AuthorizationDecision;
  } => value.expected === 'create_plan' || value.expected === 'fallback');
  const negative = binary.filter((value) => value.expected === 'fallback');
  const falseCreate = negative.filter((value) => value.final.decision === 'create_plan').length;
  const jevAutoFalseCreate = negative.filter((value) => value.route === 'jev_accepted_create').length;
  const accepted = cases.filter((value) => value.route.startsWith('jev_accepted_')).length;
  const correct = binary.filter((value) => value.final.decision === value.expected).length;
  const labelStatusCounts = cases.reduce<Record<string, number>>((counts, value) => {
    counts[value.labelStatus] = (counts[value.labelStatus] ?? 0) + 1;
    return counts;
  }, {});
  const routes = cases.reduce<Record<FocusedAuthorizationFirstRoute, number>>((counts, value) => {
    counts[value.route] += 1;
    return counts;
  }, {
    jev_accepted_create: 0,
    jev_accepted_fallback: 0,
    abstain_to_luna: 0,
    unavailable_to_luna: 0,
    stale_context_to_luna: 0,
  });
  return {
    caseCount: cases.length,
    binaryLabeledCaseCount: binary.length,
    labelStatusCounts,
    routes,
    jevCoverage: ratio(accepted, cases.length),
    lunaCallReduction: ratio(cases.filter((value) => !value.luna.called).length, cases.length),
    falseCreate: {
      occurrences: falseCreate,
      negativeSampleCount: negative.length,
      oneSidedClopperPearsonUpper95: exactClopperPearsonUpperBound95(falseCreate, negative.length),
    },
    jevAutoFalseCreate: {
      occurrences: jevAutoFalseCreate,
      negativeSampleCount: negative.length,
      oneSidedClopperPearsonUpper95: exactClopperPearsonUpperBound95(jevAutoFalseCreate, negative.length),
    },
    controlledFailureCount: cases.filter((value) => value.final.status === 'controlled_failure').length,
    finalAccuracy: ratio(correct, binary.length),
    latencyMs: {
      p50: percentile(cases.map((value) => value.final.totalLatencyMs), 0.5),
      p95: percentile(cases.map((value) => value.final.totalLatencyMs), 0.95),
    },
    usage: {
      jevInputTokens: nullableTotal(cases.map((value) => value.jev.inputTokens)),
      jevOutputTokens: nullableTotal(cases.map((value) => value.jev.outputTokens)),
      lunaPromptTokens: nullableTotal(cases.filter((value) => value.luna.called).map((value) => value.luna.promptTokens)),
      lunaCompletionTokens: nullableTotal(cases.filter((value) => value.luna.called).map((value) => value.luna.completionTokens)),
    },
    costUsd: nullableTotal(cases.flatMap((value) => [
      value.jev.costUsd,
      ...(value.luna.called ? [value.luna.costUsd] : []),
    ])),
  };
}
