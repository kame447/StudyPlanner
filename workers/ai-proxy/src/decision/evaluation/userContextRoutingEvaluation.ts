import {
  isUserContextRoutingDecisionResponse,
  type UserContextRoutingDecisionContext,
} from '../../../../../shared/userContextRoutingDecision';
import {
  parseUserPlanningContextNaturalLanguageResultV2,
} from '../../../../../src/features/userPlanningContext/userPlanningContextNaturalLanguageV2';
import { estimateLunaTextUsageCostRange } from '../../aiUsagePricing';
import {
  dispatchUserContextRouting,
  resolveUserContextRoutingBaselineFailure,
} from '../userContextRoutingDispatch';
import {
  gateUserContextRoutingDecision,
  type UserContextRoutingDecision,
  type UserContextRoutingDecisionGate,
} from '../userContextRoutingPolicy';
import type { DecisionEvaluation, DecisionProvider } from '../decisionProvider';
import type {
  UserContextRoutingEvaluationCandidate,
  UserContextRoutingExpectedTarget,
} from './userContextRoutingCorpus';
import type {
  UserContextRoutingLunaEvaluation,
  UserContextRoutingLunaEvaluator,
} from './userContextRoutingLunaEvaluation';

export type UserContextRoutingFirstRoute =
  | 'jev_external_owner'
  | 'deferred_to_luna'
  | 'abstained_to_luna'
  | 'unavailable_to_luna';

export interface UserContextRoutingCaseResult {
  id: string;
  conversationGroupId: string;
  split: UserContextRoutingEvaluationCandidate['split'];
  evaluationClass: UserContextRoutingEvaluationCandidate['evaluationClass'];
  expectedRoute: UserContextRoutingEvaluationCandidate['expectedRoute'];
  expectedTargetDomain: UserContextRoutingExpectedTarget | null;
  labelStatus: UserContextRoutingEvaluationCandidate['labelStatus'];
  route: UserContextRoutingFirstRoute;
  jev: {
    status: DecisionEvaluation<UserContextRoutingDecision>['status'];
    decision: UserContextRoutingDecision | null;
    gate: UserContextRoutingDecisionGate['status'];
    reason: string | null;
    confidence: number | null;
    selectedProbability: number | null;
    multipleDomains: number | null;
    independentMeaning: number | null;
    latencyMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
  };
  luna: {
    called: boolean;
    status: UserContextRoutingLunaEvaluation['status'] | null;
    targetDomain: UserContextRoutingExpectedTarget | null;
    reason: string | null;
    latencyMs: number | null;
    promptTokens: number | null;
    completionTokens: number | null;
  };
  final: {
    status: 'evaluated' | 'controlled_failure';
    route: 'external_owner' | 'luna' | null;
    targetDomain: UserContextRoutingExpectedTarget | null;
    httpStatus: number;
    totalLatencyMs: number;
    labelAgreement: boolean;
    unexpectedOutputKeys: string[];
  };
  authority: {
    maximumEffect: 'fixed_owner_guide_or_existing_interpreter';
    approvalGranted: false;
    saveGrantedByJev: false;
    recordFieldsGeneratedByJev: false;
  };
}

export interface UserContextRoutingLunaBaselineResult {
  id: string;
  conversationGroupId: string;
  split: UserContextRoutingEvaluationCandidate['split'];
  evaluationClass: UserContextRoutingEvaluationCandidate['evaluationClass'];
  expectedRoute: UserContextRoutingEvaluationCandidate['expectedRoute'];
  expectedTargetDomain: UserContextRoutingExpectedTarget | null;
  labelStatus: UserContextRoutingEvaluationCandidate['labelStatus'];
  luna: {
    status: UserContextRoutingLunaEvaluation['status'];
    targetDomain: UserContextRoutingExpectedTarget | null;
    reason: string | null;
    latencyMs: number;
    promptTokens: number | null;
    completionTokens: number | null;
  };
  final: {
    status: 'evaluated' | 'controlled_failure';
    targetDomain: UserContextRoutingExpectedTarget | null;
    labelAgreement: boolean;
  };
}

interface CountBound {
  occurrences: number;
  sampleCount: number;
  oneSidedClopperPearsonUpper95: number | null;
}

interface LatencySummary {
  sampleCount: number;
  p50: number | null;
  p95: number | null;
}

interface NullableTotal {
  componentCount: number;
  reportedComponentCount: number;
  unknownComponentCount: number;
  knownSubtotal: number | null;
  completeTotal: number | null;
}

function validCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function binomialCdf(successes: number, trials: number, probability: number): number {
  if (successes >= trials || probability === 0) return 1;
  if (successes < 0 || probability === 1) return 0;
  const logP = Math.log(probability);
  const logQ = Math.log1p(-probability);
  let logTerm = trials * logQ;
  let logTotal = logTerm;
  for (let index = 0; index < successes; index += 1) {
    logTerm += Math.log((trials - index) / (index + 1)) + logP - logQ;
    const high = Math.max(logTotal, logTerm);
    logTotal = high + Math.log(Math.exp(logTotal - high) + Math.exp(logTerm - high));
  }
  return Math.min(1, Math.max(0, Math.exp(logTotal)));
}

export function userContextRoutingClopperPearsonUpper95(
  occurrences: number,
  sampleCount: number,
): number | null {
  if (!validCount(occurrences) || !validCount(sampleCount) || occurrences > sampleCount) {
    throw new Error('Clopper-Pearson inputs must be non-negative integer counts.');
  }
  if (sampleCount === 0) return null;
  if (occurrences === sampleCount) return 1;
  let lower = 0;
  let upper = 1;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    if (binomialCdf(occurrences, sampleCount, midpoint) > 0.05) lower = midpoint;
    else upper = midpoint;
  }
  return (lower + upper) / 2;
}

function countBound(occurrences: number, sampleCount: number): CountBound {
  return {
    occurrences,
    sampleCount,
    oneSidedClopperPearsonUpper95:
      userContextRoutingClopperPearsonUpper95(occurrences, sampleCount),
  };
}

function percentile(values: readonly number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)] ?? null;
}

function latencySummary(values: readonly number[]): LatencySummary {
  return {
    sampleCount: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
  };
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

function groupErrorBound<T extends { conversationGroupId: string }>(
  eligible: readonly T[],
  isError: (value: T) => boolean,
): CountBound {
  const groups = new Map<string, T[]>();
  for (const value of eligible) {
    const group = groups.get(value.conversationGroupId) ?? [];
    group.push(value);
    groups.set(value.conversationGroupId, group);
  }
  const errors = [...groups.values()].filter((values) => values.some(isError)).length;
  return countBound(errors, groups.size);
}

function finalAgrees(params: {
  expectedRoute: UserContextRoutingEvaluationCandidate['expectedRoute'];
  expectedTargetDomain: UserContextRoutingExpectedTarget | null;
  lunaCalled: boolean;
  finalStatus: 'evaluated' | 'controlled_failure';
  finalTargetDomain: UserContextRoutingExpectedTarget | null;
}): boolean {
  if (params.finalStatus !== 'evaluated') return false;
  if (params.expectedTargetDomain !== null) {
    return params.finalTargetDomain === params.expectedTargetDomain;
  }
  return params.expectedRoute === 'luna' && params.lunaCalled;
}

function routeFor(gate: UserContextRoutingDecisionGate): UserContextRoutingFirstRoute {
  if (gate.status === 'accepted') return 'jev_external_owner';
  if (gate.status === 'deferred') return 'deferred_to_luna';
  if (gate.status === 'abstained') return 'abstained_to_luna';
  return 'unavailable_to_luna';
}

function parseFinal(response: Response): Promise<{
  status: 'evaluated' | 'controlled_failure';
  route: 'external_owner' | 'luna' | null;
  targetDomain: UserContextRoutingExpectedTarget | null;
  unexpectedOutputKeys: string[];
}> {
  return response.clone().json().then((body: unknown) => {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return {
        status: 'controlled_failure' as const,
        route: null,
        targetDomain: null,
        unexpectedOutputKeys: [],
      };
    }
    const content = (body as { content?: unknown }).content;
    if (typeof content !== 'string') {
      return {
        status: 'controlled_failure' as const,
        route: null,
        targetDomain: null,
        unexpectedOutputKeys: [],
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(content) as unknown;
    } catch {
      return {
        status: 'controlled_failure' as const,
        route: null,
        targetDomain: null,
        unexpectedOutputKeys: [],
      };
    }
    if (isUserContextRoutingDecisionResponse(parsed)) {
      return {
        status: 'evaluated' as const,
        route: 'external_owner' as const,
        targetDomain: parsed.targetDomain,
        unexpectedOutputKeys: Object.keys(parsed).filter((key) =>
          key !== 'decision' && key !== 'targetDomain'),
      };
    }
    try {
      const interpretation = parseUserPlanningContextNaturalLanguageResultV2(parsed);
      const allowed = new Set([
        'targetDomain', 'kind', 'label', 'value', 'dateExpression', 'displayText', 'reason',
      ]);
      return {
        status: 'evaluated' as const,
        route: 'luna' as const,
        targetDomain: interpretation.targetDomain,
        unexpectedOutputKeys: typeof parsed === 'object' && parsed !== null
          ? Object.keys(parsed).filter((key) => !allowed.has(key))
          : [],
      };
    } catch {
      return {
        status: 'controlled_failure' as const,
        route: null,
        targetDomain: null,
        unexpectedOutputKeys: [],
      };
    }
  }, () => ({
    status: 'controlled_failure' as const,
    route: null,
    targetDomain: null,
    unexpectedOutputKeys: [],
  }));
}

function lunaReason(evaluation: UserContextRoutingLunaEvaluation | null): string | null {
  return evaluation && evaluation.status !== 'evaluated' ? evaluation.reason : null;
}

export async function evaluateUserContextRoutingCase(params: {
  candidate: UserContextRoutingEvaluationCandidate;
  provider: DecisionProvider<
    UserContextRoutingDecisionContext['state'],
    UserContextRoutingDecision
  >;
  luna: UserContextRoutingLunaEvaluator;
  signal?: AbortSignal;
}): Promise<UserContextRoutingCaseResult> {
  const startedAt = Date.now();
  let jevEvaluation: DecisionEvaluation<UserContextRoutingDecision> | null = null;
  let lunaEvaluation: UserContextRoutingLunaEvaluation | null = null;
  let lunaCalls = 0;
  const context: UserContextRoutingDecisionContext = {
    purpose: 'user_context_routing',
    requestId: `user-context-routing-eval:${params.candidate.id}`,
    inputRevision: 0,
    state: { currentUserText: params.candidate.currentUserText },
  };
  const provider: DecisionProvider<
    UserContextRoutingDecisionContext['state'],
    UserContextRoutingDecision
  > = {
    async evaluate(state, signal) {
      jevEvaluation = await params.provider.evaluate(state, signal);
      return jevEvaluation;
    },
  };
  let response: Response;
  try {
    response = await dispatchUserContextRouting({
      context,
      env: { JEV_MODE: 'canary', JEV_CANARY_PERCENT: '100' },
      firebaseUid: 'user-context-routing-evaluation',
      signal: params.signal ?? new AbortController().signal,
      fallback: async (signal) => {
        lunaCalls += 1;
        lunaEvaluation = await params.luna.evaluate(params.candidate.currentUserText, signal);
        if (lunaEvaluation.status !== 'evaluated') {
          return Response.json({ error: 'User-context Luna interpreter failed.' }, { status: 502 });
        }
        return Response.json({
          content: lunaEvaluation.content,
          usage: {
            prompt_tokens: lunaEvaluation.metadata.promptTokens,
            completion_tokens: lunaEvaluation.metadata.completionTokens,
          },
        });
      },
      respond: (decision) => Response.json({ content: JSON.stringify(decision) }),
      provider,
    });
  } catch (error) {
    const failure = resolveUserContextRoutingBaselineFailure(error);
    response = Response.json({ error: failure?.failure ?? 'controlled_failure' }, { status: 502 });
  }
  const jev = jevEvaluation as DecisionEvaluation<UserContextRoutingDecision> | null;
  if (!jev) throw new Error('User-context evaluation completed without a Jev result.');
  const gate = gateUserContextRoutingDecision(jev);
  const final = await parseFinal(response);
  const luna = lunaEvaluation as UserContextRoutingLunaEvaluation | null;
  return {
    id: params.candidate.id,
    conversationGroupId: params.candidate.conversationGroupId,
    split: params.candidate.split,
    evaluationClass: params.candidate.evaluationClass,
    expectedRoute: params.candidate.expectedRoute,
    expectedTargetDomain: params.candidate.expectedTargetDomain,
    labelStatus: params.candidate.labelStatus,
    route: routeFor(gate),
    jev: {
      status: jev.status,
      decision: jev.status === 'evaluated' ? jev.decision : null,
      gate: gate.status,
      reason: gate.status === 'accepted' ? null : gate.reason,
      confidence: jev.status === 'evaluated' ? jev.confidence : null,
      selectedProbability: jev.status === 'evaluated'
        ? jev.probabilities[jev.decision]
        : null,
      multipleDomains: jev.status === 'evaluated' ? jev.conditionChange : null,
      independentMeaning: jev.status === 'evaluated' ? jev.independentMeaning : null,
      latencyMs: jev.metadata.latencyMs,
      inputTokens: jev.metadata.inputTokens,
      outputTokens: jev.metadata.outputTokens,
      costUsd: jev.metadata.costUsd,
    },
    luna: {
      called: lunaCalls > 0,
      status: luna?.status ?? null,
      targetDomain: luna?.status === 'evaluated'
        ? luna.interpretation.targetDomain
        : null,
      reason: lunaReason(luna),
      latencyMs: luna?.metadata.latencyMs ?? null,
      promptTokens: luna?.metadata.promptTokens ?? null,
      completionTokens: luna?.metadata.completionTokens ?? null,
    },
    final: {
      ...final,
      httpStatus: response.status,
      totalLatencyMs: Math.max(0, Date.now() - startedAt),
      labelAgreement: finalAgrees({
        expectedRoute: params.candidate.expectedRoute,
        expectedTargetDomain: params.candidate.expectedTargetDomain,
        lunaCalled: lunaCalls > 0,
        finalStatus: final.status,
        finalTargetDomain: final.targetDomain,
      }),
    },
    authority: {
      maximumEffect: 'fixed_owner_guide_or_existing_interpreter',
      approvalGranted: false,
      saveGrantedByJev: false,
      recordFieldsGeneratedByJev: false,
    },
  };
}

export async function evaluateUserContextRoutingLunaBaseline(params: {
  candidate: UserContextRoutingEvaluationCandidate;
  luna: UserContextRoutingLunaEvaluator;
  signal?: AbortSignal;
}): Promise<UserContextRoutingLunaBaselineResult> {
  const evaluation = await params.luna.evaluate(
    params.candidate.currentUserText,
    params.signal,
  );
  const evaluated = evaluation.status === 'evaluated';
  const targetDomain = evaluated ? evaluation.interpretation.targetDomain : null;
  return {
    id: params.candidate.id,
    conversationGroupId: params.candidate.conversationGroupId,
    split: params.candidate.split,
    evaluationClass: params.candidate.evaluationClass,
    expectedRoute: params.candidate.expectedRoute,
    expectedTargetDomain: params.candidate.expectedTargetDomain,
    labelStatus: params.candidate.labelStatus,
    luna: {
      status: evaluation.status,
      targetDomain,
      reason: evaluation.status === 'evaluated' ? null : evaluation.reason,
      latencyMs: evaluation.metadata.latencyMs,
      promptTokens: evaluation.metadata.promptTokens,
      completionTokens: evaluation.metadata.completionTokens,
    },
    final: {
      status: evaluated ? 'evaluated' : 'controlled_failure',
      targetDomain,
      labelAgreement: finalAgrees({
        expectedRoute: params.candidate.expectedRoute,
        expectedTargetDomain: params.candidate.expectedTargetDomain,
        lunaCalled: true,
        finalStatus: evaluated ? 'evaluated' : 'controlled_failure',
        finalTargetDomain: targetDomain,
      }),
    },
  };
}

export function summarizeUserContextRouting(
  cases: readonly UserContextRoutingCaseResult[],
) {
  const negative = cases.filter((value) => value.expectedRoute === 'luna');
  const falseAccept = (value: UserContextRoutingCaseResult) =>
    value.route === 'jev_external_owner';
  const pureUserContext = negative.filter((value) =>
    value.evaluationClass === 'user_context_negative');
  const security = negative.filter((value) =>
    value.evaluationClass === 'security_negative');
  const external = cases.filter((value) => value.expectedRoute === 'external_owner');
  const wrongExternalGuide = external.filter((value) =>
    value.route === 'jev_external_owner'
    && value.final.targetDomain !== value.expectedTargetDomain);
  const finalErrors = cases.filter((value) => !value.final.labelAgreement);
  const lunaPromptTokens = nullableTotal(cases
    .filter((value) => value.luna.called)
    .map((value) => value.luna.promptTokens));
  const lunaCompletionTokens = nullableTotal(cases
    .filter((value) => value.luna.called)
    .map((value) => value.luna.completionTokens));
  const lunaCostRange = estimateLunaTextUsageCostRange({
    promptTokens: lunaPromptTokens.completeTotal,
    completionTokens: lunaCompletionTokens.completeTotal,
  });
  return {
    caseCount: cases.length,
    conversationGroupCount: new Set(cases.map((value) => value.conversationGroupId)).size,
    labelStatusCounts: Object.fromEntries([...new Set(cases.map((value) => value.labelStatus))]
      .sort()
      .map((status) => [status, cases.filter((value) => value.labelStatus === status).length])),
    routeCounts: Object.fromEntries([
      'jev_external_owner', 'deferred_to_luna', 'abstained_to_luna', 'unavailable_to_luna',
    ].map((route) => [route, cases.filter((value) => value.route === route).length])),
    generativeLlmCalls: cases.filter((value) => value.luna.called).length,
    savedGenerativeLlmCalls: cases.filter((value) => !value.luna.called).length,
    primaryFalseAccept: {
      caseLevel: countBound(negative.filter(falseAccept).length, negative.length),
      conversationGroupLevel: groupErrorBound(negative, falseAccept),
    },
    pureUserContextFalseAccept: {
      caseLevel: countBound(pureUserContext.filter(falseAccept).length, pureUserContext.length),
      conversationGroupLevel: groupErrorBound(pureUserContext, falseAccept),
    },
    securityFalseAccept: {
      caseLevel: countBound(security.filter(falseAccept).length, security.length),
      conversationGroupLevel: groupErrorBound(security, falseAccept),
    },
    wrongExternalGuide: countBound(wrongExternalGuide.length, external.length),
    externalMissedReduction: countBound(
      external.filter((value) => value.luna.called).length,
      external.length,
    ),
    provisionalLabelDisagreement: {
      caseLevel: countBound(finalErrors.length, cases.length),
      conversationGroupLevel: groupErrorBound(cases, (value) =>
        !value.final.labelAgreement),
      note: 'Agreement with synthetic_unreviewed or opus-5.5-limited-judge labels; not accuracy and not human gold.',
    },
    controlledFailureCount: cases.filter((value) =>
      value.final.status === 'controlled_failure').length,
    unexpectedOutputKeyCaseCount: cases.filter((value) =>
      value.final.unexpectedOutputKeys.length > 0).length,
    latencyMs: latencySummary(cases.map((value) => value.final.totalLatencyMs)),
    usage: {
      jevInputTokens: nullableTotal(cases.map((value) => value.jev.inputTokens)),
      jevOutputTokens: nullableTotal(cases.map((value) => value.jev.outputTokens)),
      lunaPromptTokens,
      lunaCompletionTokens,
    },
    cost: {
      jevReportedUsd: nullableTotal(cases.map((value) => value.jev.costUsd)),
      lunaPricingVersion: lunaCostRange.pricingVersion,
      lunaMinimumCostMicros: lunaCostRange.minimumCostMicros,
      lunaMaximumCostMicros: lunaCostRange.maximumCostMicros,
    },
  };
}

export function summarizeUserContextRoutingLunaBaseline(
  cases: readonly UserContextRoutingLunaBaselineResult[],
) {
  const errors = cases.filter((value) => !value.final.labelAgreement);
  const promptTokens = nullableTotal(cases.map((value) => value.luna.promptTokens));
  const completionTokens = nullableTotal(cases.map((value) => value.luna.completionTokens));
  const costRange = estimateLunaTextUsageCostRange({
    promptTokens: promptTokens.completeTotal,
    completionTokens: completionTokens.completeTotal,
  });
  return {
    caseCount: cases.length,
    conversationGroupCount: new Set(cases.map((value) => value.conversationGroupId)).size,
    generativeLlmCalls: cases.length,
    provisionalLabelDisagreement: {
      caseLevel: countBound(errors.length, cases.length),
      conversationGroupLevel: groupErrorBound(cases, (value) =>
        !value.final.labelAgreement),
      note: 'Agreement with synthetic_unreviewed or opus-5.5-limited-judge labels; not accuracy and not human gold.',
    },
    controlledFailureCount: cases.filter((value) =>
      value.final.status === 'controlled_failure').length,
    latencyMs: latencySummary(cases.map((value) => value.luna.latencyMs)),
    usage: { promptTokens, completionTokens },
    cost: {
      pricingVersion: costRange.pricingVersion,
      minimumCostMicros: costRange.minimumCostMicros,
      maximumCostMicros: costRange.maximumCostMicros,
    },
  };
}

export function compareUserContextRoutingPaired(
  firstRoute: readonly UserContextRoutingCaseResult[],
  lunaOnly: readonly UserContextRoutingLunaBaselineResult[],
) {
  const baselineById = new Map(lunaOnly.map((value) => [value.id, value]));
  const pairs = firstRoute.map((value) => {
    const baseline = baselineById.get(value.id);
    if (!baseline) throw new Error(`Missing Luna baseline case: ${value.id}`);
    return { firstRoute: value, baseline };
  });
  return {
    pairCount: pairs.length,
    firstRouteDisagreementCount: pairs.filter((pair) =>
      !pair.firstRoute.final.labelAgreement).length,
    lunaOnlyDisagreementCount: pairs.filter((pair) =>
      !pair.baseline.final.labelAgreement).length,
    lunaCorrectFirstRouteWrong: pairs.filter((pair) =>
      pair.baseline.final.labelAgreement && !pair.firstRoute.final.labelAgreement).length,
    firstRouteCorrectLunaWrong: pairs.filter((pair) =>
      pair.firstRoute.final.labelAgreement && !pair.baseline.final.labelAgreement).length,
    firstRouteGenerativeLlmCalls: pairs.filter((pair) =>
      pair.firstRoute.luna.called).length,
    lunaOnlyGenerativeLlmCalls: pairs.length,
    note: 'Paired agreement uses provisional labels; it is not accuracy and repeated cases in one conversation group are not independent.',
  };
}
