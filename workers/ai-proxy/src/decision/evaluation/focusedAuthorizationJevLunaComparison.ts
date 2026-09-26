import type {
  AuthorizationDecision,
  DecisionEvaluation,
  DecisionProvider,
} from '../decisionProvider';
import { gateDecision } from '../decisionPolicy';
import {
  gateOutcomeForEvaluation,
  summarizeFocusedAuthorizationEvaluation,
  type ClassMetrics,
  type FocusedAuthorizationEvaluationSample,
  type GateOutcome,
  type RatioMetric,
} from './focusedAuthorizationEvaluationMetrics';
import {
  FOCUSED_AUTHORIZATION_EVALUATION_LAYERS,
  type FocusedAuthorizationEvaluationLayer,
  type FocusedAuthorizationEvaluationSplit,
  type FocusedAuthorizationSyntheticCandidate,
} from './focusedAuthorizationSyntheticCandidates';
import type {
  FocusedAuthorizationEvaluationContext,
  LunaFocusedAuthorizationEvaluation,
  LunaFocusedAuthorizationEvaluator,
} from './focusedAuthorizationLunaEvaluation';

export interface FocusedAuthorizationComparisonLabel {
  expected: AuthorizationDecision;
  labelStatus: string;
}

export type FocusedAuthorizationComparisonLabels = Readonly<
  Record<string, FocusedAuthorizationComparisonLabel>
>;

export interface NullableAggregate {
  componentCount: number;
  reportedComponentCount: number;
  unknownComponentCount: number;
  knownSubtotal: number | null;
  completeTotal: number | null;
}

export interface JevComparisonResult {
  rawChoice: AuthorizationDecision | null;
  probabilities: Record<AuthorizationDecision, number> | null;
  conditionChange: number | null;
  independentMeaning: number | null;
  gateOutcome: GateOutcome;
  unavailableReason: string | null;
  latencyMs: number;
  tokens: {
    prompt: number | null;
    completion: number | null;
  };
  costUsd: number | null;
  requestedModel: string;
  servedModel: string | null;
}

export interface LunaComparisonResult {
  decision: AuthorizationDecision | null;
  status: LunaFocusedAuthorizationEvaluation['status'];
  reason: string | null;
  latencyMs: number;
  tokens: {
    prompt: number | null;
    completion: number | null;
  };
  costUsd: number | null;
  requestedModel: string;
  servedModel: string | null;
}

export type FocusedAuthorizationFocusedBoundaryRoute =
  | 'jev_accepted'
  | 'luna_after_jev_abstain'
  | 'luna_after_jev_unavailable';

export interface FocusedAuthorizationFocusedBoundaryResult {
  route: FocusedAuthorizationFocusedBoundaryRoute;
  status: 'evaluated' | 'invalid' | 'unavailable';
  finalDecision: AuthorizationDecision | null;
  totalLatencyMs: number;
  totalCostUsd: NullableAggregate;
  continuesToGenericSemantic: boolean;
}

export interface FocusedAuthorizationJevLunaCaseResult {
  id: string;
  conversationGroupId: string;
  layer: FocusedAuthorizationEvaluationLayer;
  split: FocusedAuthorizationEvaluationSplit;
  reviewStatus: FocusedAuthorizationSyntheticCandidate['reviewStatus'];
  expected: AuthorizationDecision;
  labelStatus: string;
  jev: JevComparisonResult;
  luna: LunaComparisonResult;
  focusedBoundary: FocusedAuthorizationFocusedBoundaryResult;
}

export interface LatencySummary {
  sampleCount: number;
  p50: number | null;
  p95: number | null;
}

export interface FocusedAuthorizationSystemMetrics {
  caseCount: number;
  labelStatusCounts: Record<string, number>;
  byClass: Record<AuthorizationDecision, ClassMetrics>;
  coverage: RatioMetric;
  selectiveAccuracy: RatioMetric;
  falsePositiveCreatePlan: RatioMetric;
  falseNegativeCreatePlan: RatioMetric;
  abstainRate: RatioMetric;
  fallbackDecisionRate: RatioMetric;
  invalidRate: RatioMetric;
  unavailableRate: RatioMetric;
  latencyMs: LatencySummary;
  usage: {
    promptTokens: NullableAggregate;
    completionTokens: NullableAggregate;
  };
  costUsd: NullableAggregate;
}

export interface FocusedAuthorizationFocusedBoundaryMetrics
  extends FocusedAuthorizationSystemMetrics {
  continuesToGenericSemantic: RatioMetric;
}

export interface JevLunaAgreementMetrics {
  basis: 'jev_gated_decision_vs_luna_decision';
  note: 'Agreement is not accuracy and is not compared with labels.';
  comparableCaseCount: number;
  nonComparableCaseCount: number;
  agreement: RatioMetric;
  discordantPairCounts: {
    jevCreatePlanLunaFallback: number;
    jevFallbackLunaCreatePlan: number;
  };
}

export interface FocusedAuthorizationComparisonMetrics {
  jev: FocusedAuthorizationSystemMetrics;
  luna: FocusedAuthorizationSystemMetrics;
  focusedBoundary: FocusedAuthorizationFocusedBoundaryMetrics;
  jevLunaAgreement: JevLunaAgreementMetrics;
}

export interface FocusedAuthorizationComparisonSegmentedMetrics {
  global: FocusedAuthorizationComparisonMetrics;
  bySplit: Record<FocusedAuthorizationEvaluationSplit, FocusedAuthorizationComparisonMetrics>;
  byLayer: Record<FocusedAuthorizationEvaluationLayer, FocusedAuthorizationComparisonMetrics>;
}

export interface FocusedAuthorizationJevLunaComparisonReport {
  scopeNote: 'Focused-boundary latency and cost exclude downstream generic-semantic execution after fallback.';
  labelStatuses: string[];
  cases: FocusedAuthorizationJevLunaCaseResult[];
  metrics: FocusedAuthorizationComparisonSegmentedMetrics;
}

type QualityStatus = 'evaluated' | 'abstained' | 'invalid' | 'unavailable';

interface QualitySample {
  expected: AuthorizationDecision;
  labelStatus: string;
  prediction: AuthorizationDecision | null;
  status: QualityStatus;
  latencyMs: number;
  promptTokenComponents: readonly (number | null)[];
  completionTokenComponents: readonly (number | null)[];
  costComponents: readonly (number | null)[];
}

interface CompletedCase {
  result: FocusedAuthorizationJevLunaCaseResult;
  jevEvaluation: DecisionEvaluation;
  lunaEvaluation: LunaFocusedAuthorizationEvaluation;
  jevQuality: QualitySample;
  lunaQuality: QualitySample;
  focusedBoundaryQuality: QualitySample;
}

function ratio(numerator: number, denominator: number): RatioMetric {
  return { numerator, denominator, value: denominator === 0 ? null : numerator / denominator };
}

function percentile(values: readonly number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)];
}

function nullableAggregate(values: readonly (number | null)[]): NullableAggregate {
  const known = values.filter((value): value is number => value !== null);
  const knownSubtotal = known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0);
  const unknownComponentCount = values.length - known.length;
  return {
    componentCount: values.length,
    reportedComponentCount: known.length,
    unknownComponentCount,
    knownSubtotal,
    completeTotal: values.length > 0 && unknownComponentCount === 0
      ? knownSubtotal ?? 0
      : null,
  };
}

function labelStatusCounts(samples: readonly QualitySample[]): Record<string, number> {
  return samples.reduce<Record<string, number>>((counts, sample) => {
    counts[sample.labelStatus] = (counts[sample.labelStatus] ?? 0) + 1;
    return counts;
  }, {});
}

function summarizeQuality(samples: readonly QualitySample[]): FocusedAuthorizationSystemMetrics {
  const expectedCounts: Record<AuthorizationDecision, number> = { create_plan: 0, fallback: 0 };
  const predictedCounts: Record<AuthorizationDecision, number> = { create_plan: 0, fallback: 0 };
  const correctCounts: Record<AuthorizationDecision, number> = { create_plan: 0, fallback: 0 };
  let coveredCount = 0;
  let correctCount = 0;
  let falsePositiveCreatePlanCount = 0;
  let falseNegativeCreatePlanCount = 0;
  let abstainCount = 0;
  let fallbackDecisionCount = 0;
  let invalidCount = 0;
  let unavailableCount = 0;

  for (const sample of samples) {
    expectedCounts[sample.expected] += 1;
    if (sample.status === 'abstained') abstainCount += 1;
    if (sample.status === 'invalid') invalidCount += 1;
    if (sample.status === 'unavailable') unavailableCount += 1;
    if (sample.prediction === 'fallback') fallbackDecisionCount += 1;
    if (sample.prediction !== null) {
      coveredCount += 1;
      predictedCounts[sample.prediction] += 1;
      if (sample.prediction === sample.expected) {
        correctCount += 1;
        correctCounts[sample.prediction] += 1;
      }
    }
    if (sample.expected === 'fallback' && sample.prediction === 'create_plan') {
      falsePositiveCreatePlanCount += 1;
    }
    if (sample.expected === 'create_plan' && sample.prediction !== 'create_plan') {
      falseNegativeCreatePlanCount += 1;
    }
  }

  return {
    caseCount: samples.length,
    labelStatusCounts: labelStatusCounts(samples),
    byClass: {
      create_plan: {
        precision: ratio(correctCounts.create_plan, predictedCounts.create_plan),
        recall: ratio(correctCounts.create_plan, expectedCounts.create_plan),
      },
      fallback: {
        precision: ratio(correctCounts.fallback, predictedCounts.fallback),
        recall: ratio(correctCounts.fallback, expectedCounts.fallback),
      },
    },
    coverage: ratio(coveredCount, samples.length),
    selectiveAccuracy: ratio(correctCount, coveredCount),
    falsePositiveCreatePlan: ratio(falsePositiveCreatePlanCount, expectedCounts.fallback),
    falseNegativeCreatePlan: ratio(falseNegativeCreatePlanCount, expectedCounts.create_plan),
    abstainRate: ratio(abstainCount, samples.length),
    fallbackDecisionRate: ratio(fallbackDecisionCount, samples.length),
    invalidRate: ratio(invalidCount, samples.length),
    unavailableRate: ratio(unavailableCount, samples.length),
    latencyMs: {
      sampleCount: samples.length,
      p50: percentile(samples.map((sample) => sample.latencyMs), 0.5),
      p95: percentile(samples.map((sample) => sample.latencyMs), 0.95),
    },
    usage: {
      promptTokens: nullableAggregate(samples.flatMap((sample) => sample.promptTokenComponents)),
      completionTokens: nullableAggregate(samples.flatMap((sample) => sample.completionTokenComponents)),
    },
    costUsd: nullableAggregate(samples.flatMap((sample) => sample.costComponents)),
  };
}

function summarizeJev(cases: readonly CompletedCase[]): FocusedAuthorizationSystemMetrics {
  const generic = summarizeQuality(cases.map((value) => value.jevQuality));
  const samples: FocusedAuthorizationEvaluationSample[] = cases.map((value) => ({
    id: value.result.id,
    expected: value.result.expected,
    evaluation: value.jevEvaluation,
  }));
  const existing = summarizeFocusedAuthorizationEvaluation(samples);
  return {
    ...generic,
    byClass: existing.byClass,
    coverage: existing.coverage,
    selectiveAccuracy: existing.selectiveAccuracy,
    falsePositiveCreatePlan: existing.falseAutoCreatePlanRate,
    abstainRate: existing.abstentionRate,
    unavailableRate: existing.unavailableRate,
    latencyMs: {
      sampleCount: existing.latencyMs.allSamples.sampleCount,
      p50: existing.latencyMs.allSamples.p50,
      p95: existing.latencyMs.allSamples.p95,
    },
    costUsd: {
      componentCount: existing.evaluationEligibleCaseCount,
      reportedComponentCount: existing.reportedCostUsd.reportedCaseCount,
      unknownComponentCount: existing.reportedCostUsd.unknownCaseCount,
      knownSubtotal: existing.reportedCostUsd.knownSubtotal,
      completeTotal: existing.reportedCostUsd.completeTotal,
    },
  };
}

function summarizeAgreement(cases: readonly CompletedCase[]): JevLunaAgreementMetrics {
  let comparableCaseCount = 0;
  let agreementCount = 0;
  let jevCreatePlanLunaFallback = 0;
  let jevFallbackLunaCreatePlan = 0;
  for (const value of cases) {
    const gate = gateDecision(value.jevEvaluation);
    if (gate.status !== 'accepted' || value.lunaEvaluation.status !== 'evaluated') continue;
    comparableCaseCount += 1;
    if (gate.decision === value.lunaEvaluation.decision) {
      agreementCount += 1;
    } else if (gate.decision === 'create_plan') {
      jevCreatePlanLunaFallback += 1;
    } else {
      jevFallbackLunaCreatePlan += 1;
    }
  }
  return {
    basis: 'jev_gated_decision_vs_luna_decision',
    note: 'Agreement is not accuracy and is not compared with labels.',
    comparableCaseCount,
    nonComparableCaseCount: cases.length - comparableCaseCount,
    agreement: ratio(agreementCount, comparableCaseCount),
    discordantPairCounts: { jevCreatePlanLunaFallback, jevFallbackLunaCreatePlan },
  };
}

function summarizeFocusedBoundary(
  cases: readonly CompletedCase[],
): FocusedAuthorizationFocusedBoundaryMetrics {
  const quality = summarizeQuality(cases.map((value) => value.focusedBoundaryQuality));
  const genericCount = cases.filter(
    (value) => value.result.focusedBoundary.continuesToGenericSemantic,
  ).length;
  return {
    ...quality,
    continuesToGenericSemantic: ratio(genericCount, cases.length),
  };
}

function summarizeComparison(cases: readonly CompletedCase[]): FocusedAuthorizationComparisonMetrics {
  return {
    jev: summarizeJev(cases),
    luna: summarizeQuality(cases.map((value) => value.lunaQuality)),
    focusedBoundary: summarizeFocusedBoundary(cases),
    jevLunaAgreement: summarizeAgreement(cases),
  };
}

function jevStatus(evaluation: DecisionEvaluation): QualityStatus {
  if (evaluation.status === 'unavailable') return 'unavailable';
  return gateDecision(evaluation).status === 'abstained' ? 'abstained' : 'evaluated';
}

function jevPrediction(evaluation: DecisionEvaluation): AuthorizationDecision | null {
  const gate = gateDecision(evaluation);
  return gate.status === 'accepted' ? gate.decision : null;
}

function lunaStatus(evaluation: LunaFocusedAuthorizationEvaluation): QualityStatus {
  return evaluation.status;
}

function validatedInputs(
  candidates: readonly FocusedAuthorizationSyntheticCandidate[],
  labels: FocusedAuthorizationComparisonLabels,
): void {
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (ids.has(candidate.id)) throw new Error(`Duplicate comparison candidate id: ${candidate.id}`);
    ids.add(candidate.id);
    const label = labels[candidate.id];
    if (!label
      || (label.expected !== 'create_plan' && label.expected !== 'fallback')
      || !label.labelStatus.trim()) {
      throw new Error(`Missing or invalid comparison label: ${candidate.id}`);
    }
  }
}

function focusedBoundaryResult(
  jev: DecisionEvaluation,
  luna: LunaFocusedAuthorizationEvaluation,
): FocusedAuthorizationFocusedBoundaryResult {
  const gate = gateDecision(jev);
  if (gate.status === 'accepted') {
    return {
      route: 'jev_accepted',
      status: 'evaluated',
      finalDecision: gate.decision,
      totalLatencyMs: jev.metadata.latencyMs,
      totalCostUsd: nullableAggregate([jev.metadata.costUsd]),
      continuesToGenericSemantic: gate.decision === 'fallback',
    };
  }
  return {
    route: gate.status === 'abstained'
      ? 'luna_after_jev_abstain'
      : 'luna_after_jev_unavailable',
    status: luna.status,
    finalDecision: luna.status === 'evaluated' ? luna.decision : null,
    totalLatencyMs: jev.metadata.latencyMs + luna.metadata.latencyMs,
    totalCostUsd: nullableAggregate([jev.metadata.costUsd, luna.metadata.costUsd]),
    continuesToGenericSemantic: luna.status !== 'evaluated' || luna.decision === 'fallback',
  };
}

export async function compareFocusedAuthorizationCandidates(
  candidates: readonly FocusedAuthorizationSyntheticCandidate[],
  labels: FocusedAuthorizationComparisonLabels,
  providers: {
    jev: DecisionProvider;
    luna: LunaFocusedAuthorizationEvaluator;
  },
  onCase?: (result: FocusedAuthorizationJevLunaCaseResult) => void,
): Promise<FocusedAuthorizationJevLunaComparisonReport> {
  validatedInputs(candidates, labels);
  const completed: CompletedCase[] = [];
  for (const candidate of candidates) {
    const label = labels[candidate.id];
    const context: FocusedAuthorizationEvaluationContext = {
      currentUserText: candidate.currentUserText,
      lastAssistantMessage: candidate.lastAssistantMessage,
    };
    const [jevEvaluation, lunaEvaluation] = await Promise.all([
      providers.jev.evaluate(context),
      providers.luna.evaluate(context),
    ]);
    const final = focusedBoundaryResult(jevEvaluation, lunaEvaluation);
    const jevResult: JevComparisonResult = {
      rawChoice: jevEvaluation.status === 'evaluated' ? jevEvaluation.decision : null,
      probabilities: jevEvaluation.status === 'evaluated' ? jevEvaluation.probabilities : null,
      conditionChange: jevEvaluation.status === 'evaluated' ? jevEvaluation.conditionChange : null,
      independentMeaning: jevEvaluation.status === 'evaluated' ? jevEvaluation.independentMeaning : null,
      gateOutcome: gateOutcomeForEvaluation(jevEvaluation),
      unavailableReason: jevEvaluation.status === 'unavailable' ? jevEvaluation.reason : null,
      latencyMs: jevEvaluation.metadata.latencyMs,
      tokens: {
        prompt: jevEvaluation.metadata.inputTokens,
        completion: jevEvaluation.metadata.outputTokens,
      },
      costUsd: jevEvaluation.metadata.costUsd,
      requestedModel: jevEvaluation.metadata.requestedModel,
      servedModel: jevEvaluation.metadata.servedModel,
    };
    const lunaResult: LunaComparisonResult = {
      decision: lunaEvaluation.status === 'evaluated' ? lunaEvaluation.decision : null,
      status: lunaEvaluation.status,
      reason: lunaEvaluation.status === 'evaluated' ? null : lunaEvaluation.reason,
      latencyMs: lunaEvaluation.metadata.latencyMs,
      tokens: {
        prompt: lunaEvaluation.metadata.promptTokens,
        completion: lunaEvaluation.metadata.completionTokens,
      },
      costUsd: lunaEvaluation.metadata.costUsd,
      requestedModel: lunaEvaluation.metadata.requestedModel,
      servedModel: lunaEvaluation.metadata.servedModel,
    };
    const result: FocusedAuthorizationJevLunaCaseResult = {
      id: candidate.id,
      conversationGroupId: candidate.conversationGroupId,
      layer: candidate.layer,
      split: candidate.split,
      reviewStatus: candidate.reviewStatus,
      expected: label.expected,
      labelStatus: label.labelStatus,
      jev: jevResult,
      luna: lunaResult,
      focusedBoundary: final,
    };
    const lunaPrediction = lunaEvaluation.status === 'evaluated' ? lunaEvaluation.decision : null;
    const focusedBoundaryTokenComponents = final.route === 'jev_accepted'
      ? [jevEvaluation.metadata.inputTokens]
      : [jevEvaluation.metadata.inputTokens, lunaEvaluation.metadata.promptTokens];
    const focusedBoundaryCompletionComponents = final.route === 'jev_accepted'
      ? [jevEvaluation.metadata.outputTokens]
      : [jevEvaluation.metadata.outputTokens, lunaEvaluation.metadata.completionTokens];
    completed.push({
      result,
      jevEvaluation,
      lunaEvaluation,
      jevQuality: {
        expected: label.expected,
        labelStatus: label.labelStatus,
        prediction: jevPrediction(jevEvaluation),
        status: jevStatus(jevEvaluation),
        latencyMs: jevEvaluation.metadata.latencyMs,
        promptTokenComponents: [jevEvaluation.metadata.inputTokens],
        completionTokenComponents: [jevEvaluation.metadata.outputTokens],
        costComponents: [jevEvaluation.metadata.costUsd],
      },
      lunaQuality: {
        expected: label.expected,
        labelStatus: label.labelStatus,
        prediction: lunaPrediction,
        status: lunaStatus(lunaEvaluation),
        latencyMs: lunaEvaluation.metadata.latencyMs,
        promptTokenComponents: [lunaEvaluation.metadata.promptTokens],
        completionTokenComponents: [lunaEvaluation.metadata.completionTokens],
        costComponents: [lunaEvaluation.metadata.costUsd],
      },
      focusedBoundaryQuality: {
        expected: label.expected,
        labelStatus: label.labelStatus,
        prediction: final.finalDecision,
        status: final.status,
        latencyMs: final.totalLatencyMs,
        promptTokenComponents: focusedBoundaryTokenComponents,
        completionTokenComponents: focusedBoundaryCompletionComponents,
        costComponents: final.route === 'jev_accepted'
          ? [jevEvaluation.metadata.costUsd]
          : [jevEvaluation.metadata.costUsd, lunaEvaluation.metadata.costUsd],
      },
    });
    onCase?.(result);
  }

  const segment = (predicate: (value: CompletedCase) => boolean) =>
    summarizeComparison(completed.filter(predicate));
  return {
    scopeNote: 'Focused-boundary latency and cost exclude downstream generic-semantic execution after fallback.',
    labelStatuses: [...new Set(completed.map((value) => value.result.labelStatus))].sort(),
    cases: completed.map((value) => value.result),
    metrics: {
      global: summarizeComparison(completed),
      bySplit: {
        tuning: segment((value) => value.result.split === 'tuning'),
        holdout: segment((value) => value.result.split === 'holdout'),
      },
      byLayer: Object.fromEntries(
        FOCUSED_AUTHORIZATION_EVALUATION_LAYERS.map((layer) => [
          layer,
          segment((value) => value.result.layer === layer),
        ]),
      ) as unknown as Record<FocusedAuthorizationEvaluationLayer, FocusedAuthorizationComparisonMetrics>,
    },
  };
}
