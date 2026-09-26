import type {
  AuthorizationDecision,
  DecisionEvaluation,
  DecisionProvider,
} from '../decisionProvider';
import { isFocusedAuthorizationDecisionContext } from '../../../../../shared/focusedAuthorizationDecision';
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
  gateOutcome: GateOutcome | 'rejected_before_provider';
  unavailableReason: string | null;
  latencyMs: number | null;
  tokens: {
    prompt: number | null;
    completion: number | null;
  };
  costUsd: number | null;
  requestedModel: string | null;
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
  | 'luna_after_jev_unavailable'
  | 'luna_only_invalid_context';

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

export interface ConfidenceInterval95 {
  confidenceLevel: 0.95;
  method: 'wilson';
  lower: number | null;
  upper: number | null;
}

export interface OneSidedUpperBound95 {
  confidenceLevel: 0.95;
  method: 'clopper_pearson_exact';
  upper: number | null;
}

export interface StatisticalUncertainty95 {
  byClass: Record<AuthorizationDecision, {
    precision: ConfidenceInterval95;
    recall: ConfidenceInterval95;
  }>;
  falseCreateRate: OneSidedUpperBound95;
  createPlanMissRate: OneSidedUpperBound95;
}

export interface FocusedAuthorizationSystemMetrics {
  caseCount: number;
  evaluationEligibleCaseCount: number;
  rejectedBeforeProviderCount: number;
  labelStatusCounts: Record<string, number>;
  provisional: boolean;
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
  uncertainty95: StatisticalUncertainty95;
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
  labelStatusCounts: Record<string, number>;
  provisional: boolean;
}

export interface PairedDiscordanceMetrics {
  caseCount: number;
  bLunaCorrectFocusedBoundaryWrong: number;
  cFocusedBoundaryCorrectLunaWrong: number;
  exactTwoSidedMcNemarPValue: number;
  labelStatusCounts: Record<string, number>;
  provisional: boolean;
}

export interface PairedVsLabelsMetrics {
  note: 'Paired correctness uses supplied labels; repeated paraphrases in one conversation group are not independent observations.';
  overall: PairedDiscordanceMetrics;
  expectedFallbackFalseCreateRisk: PairedDiscordanceMetrics;
  labelStatusCounts: Record<string, number>;
  provisional: boolean;
}

export interface FocusedAuthorizationComparisonMetrics {
  jev: FocusedAuthorizationSystemMetrics;
  luna: FocusedAuthorizationSystemMetrics;
  focusedBoundary: FocusedAuthorizationFocusedBoundaryMetrics;
  jevLunaAgreement: JevLunaAgreementMetrics;
  pairedVsLabels: PairedVsLabelsMetrics;
  labelStatusCounts: Record<string, number>;
  provisional: boolean;
}

export interface FocusedAuthorizationComparisonSegmentedMetrics {
  global: FocusedAuthorizationComparisonMetrics;
  bySplit: Record<FocusedAuthorizationEvaluationSplit, FocusedAuthorizationComparisonMetrics>;
  byLayer: Record<FocusedAuthorizationEvaluationLayer, FocusedAuthorizationComparisonMetrics>;
}

export interface FocusedAuthorizationJevLunaComparisonReport {
  scopeNote: 'Focused-boundary latency and cost exclude downstream generic-semantic execution after fallback.';
  independenceNote: 'Repeated paraphrases in one conversation group are not independent observations.';
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
  jevEvaluation: DecisionEvaluation | null;
  lunaEvaluation: LunaFocusedAuthorizationEvaluation;
  jevQuality: QualitySample | null;
  lunaQuality: QualitySample;
  focusedBoundaryQuality: QualitySample;
}

function ratio(numerator: number, denominator: number): RatioMetric {
  return { numerator, denominator, value: denominator === 0 ? null : numerator / denominator };
}

function validCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function binomialCdf(successes: number, trials: number, probability: number): number {
  if (successes >= trials || probability === 0) return 1;
  if (successes < 0 || probability === 1) return 0;
  // Sum in log space: starting from (1 - p)^n underflows when p is near 1 or n is large.
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

export function exactClopperPearsonUpperBound95(
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

export function wilsonInterval95(
  occurrences: number,
  sampleCount: number,
): ConfidenceInterval95 {
  if (!validCount(occurrences) || !validCount(sampleCount) || occurrences > sampleCount) {
    throw new Error('Wilson interval inputs must be non-negative integer counts.');
  }
  if (sampleCount === 0) {
    return { confidenceLevel: 0.95, method: 'wilson', lower: null, upper: null };
  }
  const z = 1.959963984540054;
  const proportion = occurrences / sampleCount;
  const zSquaredOverN = (z * z) / sampleCount;
  const center = (proportion + zSquaredOverN / 2) / (1 + zSquaredOverN);
  const margin = z * Math.sqrt(
    (proportion * (1 - proportion) / sampleCount)
      + ((z * z) / (4 * sampleCount * sampleCount)),
  ) / (1 + zSquaredOverN);
  return {
    confidenceLevel: 0.95,
    method: 'wilson',
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}

export function exactTwoSidedMcNemarPValue(
  bLunaCorrectFocusedBoundaryWrong: number,
  cFocusedBoundaryCorrectLunaWrong: number,
): number {
  if (!validCount(bLunaCorrectFocusedBoundaryWrong)
    || !validCount(cFocusedBoundaryCorrectLunaWrong)) {
    throw new Error('McNemar inputs must be non-negative integer counts.');
  }
  const discordantCount = bLunaCorrectFocusedBoundaryWrong
    + cFocusedBoundaryCorrectLunaWrong;
  if (discordantCount === 0) return 1;
  return Math.min(
    1,
    2 * binomialCdf(
      Math.min(bLunaCorrectFocusedBoundaryWrong, cFocusedBoundaryCorrectLunaWrong),
      discordantCount,
      0.5,
    ),
  );
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

function countLabelStatuses(statuses: readonly string[]): Record<string, number> {
  return statuses.reduce<Record<string, number>>((counts, status) => {
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
}

function labelStatusCounts(samples: readonly QualitySample[]): Record<string, number> {
  return countLabelStatuses(samples.map((sample) => sample.labelStatus));
}

function provisionalLabelCounts(counts: Readonly<Record<string, number>>): boolean {
  return Object.entries(counts).some(
    ([status, count]) => count > 0 && status !== 'human_reviewed_gold',
  );
}

function oneSidedUpperBound(metric: RatioMetric): OneSidedUpperBound95 {
  return {
    confidenceLevel: 0.95,
    method: 'clopper_pearson_exact',
    upper: exactClopperPearsonUpperBound95(metric.numerator, metric.denominator),
  };
}

function statisticalUncertainty95(params: {
  byClass: Record<AuthorizationDecision, ClassMetrics>;
  falsePositiveCreatePlan: RatioMetric;
  falseNegativeCreatePlan: RatioMetric;
}): StatisticalUncertainty95 {
  return {
    byClass: {
      create_plan: {
        precision: wilsonInterval95(
          params.byClass.create_plan.precision.numerator,
          params.byClass.create_plan.precision.denominator,
        ),
        recall: wilsonInterval95(
          params.byClass.create_plan.recall.numerator,
          params.byClass.create_plan.recall.denominator,
        ),
      },
      fallback: {
        precision: wilsonInterval95(
          params.byClass.fallback.precision.numerator,
          params.byClass.fallback.precision.denominator,
        ),
        recall: wilsonInterval95(
          params.byClass.fallback.recall.numerator,
          params.byClass.fallback.recall.denominator,
        ),
      },
    },
    falseCreateRate: oneSidedUpperBound(params.falsePositiveCreatePlan),
    createPlanMissRate: oneSidedUpperBound(params.falseNegativeCreatePlan),
  };
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

  const byClass: Record<AuthorizationDecision, ClassMetrics> = {
    create_plan: {
      precision: ratio(correctCounts.create_plan, predictedCounts.create_plan),
      recall: ratio(correctCounts.create_plan, expectedCounts.create_plan),
    },
    fallback: {
      precision: ratio(correctCounts.fallback, predictedCounts.fallback),
      recall: ratio(correctCounts.fallback, expectedCounts.fallback),
    },
  };
  const falsePositiveCreatePlan = ratio(falsePositiveCreatePlanCount, expectedCounts.fallback);
  const falseNegativeCreatePlan = ratio(falseNegativeCreatePlanCount, expectedCounts.create_plan);
  const labels = labelStatusCounts(samples);

  return {
    caseCount: samples.length,
    evaluationEligibleCaseCount: samples.length,
    rejectedBeforeProviderCount: 0,
    labelStatusCounts: labels,
    provisional: provisionalLabelCounts(labels),
    byClass,
    coverage: ratio(coveredCount, samples.length),
    selectiveAccuracy: ratio(correctCount, coveredCount),
    falsePositiveCreatePlan,
    falseNegativeCreatePlan,
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
    uncertainty95: statisticalUncertainty95({
      byClass,
      falsePositiveCreatePlan,
      falseNegativeCreatePlan,
    }),
  };
}

function summarizeJev(cases: readonly CompletedCase[]): FocusedAuthorizationSystemMetrics {
  const eligibleCases = cases.filter((value): value is CompletedCase & {
    jevEvaluation: DecisionEvaluation;
    jevQuality: QualitySample;
  } => value.jevEvaluation !== null && value.jevQuality !== null);
  const generic = summarizeQuality(eligibleCases.map((value) => value.jevQuality));
  const samples: FocusedAuthorizationEvaluationSample[] = eligibleCases.map((value) => ({
    id: value.result.id,
    expected: value.result.expected,
    evaluation: value.jevEvaluation,
  }));
  const rejectedBeforeProviderCount = cases.length - eligibleCases.length;
  const existing = summarizeFocusedAuthorizationEvaluation(samples, rejectedBeforeProviderCount);
  const labels = countLabelStatuses(cases.map((value) => value.result.labelStatus));
  const uncertainty95 = statisticalUncertainty95({
    byClass: existing.byClass,
    falsePositiveCreatePlan: existing.falseAutoCreatePlanRate,
    falseNegativeCreatePlan: generic.falseNegativeCreatePlan,
  });
  return {
    ...generic,
    caseCount: cases.length,
    evaluationEligibleCaseCount: eligibleCases.length,
    rejectedBeforeProviderCount,
    labelStatusCounts: labels,
    provisional: provisionalLabelCounts(labels),
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
    uncertainty95,
  };
}

function summarizeAgreement(cases: readonly CompletedCase[]): JevLunaAgreementMetrics {
  let comparableCaseCount = 0;
  let agreementCount = 0;
  let jevCreatePlanLunaFallback = 0;
  let jevFallbackLunaCreatePlan = 0;
  for (const value of cases) {
    if (value.jevEvaluation === null) continue;
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
  const labels = countLabelStatuses(cases.map((value) => value.result.labelStatus));
  return {
    basis: 'jev_gated_decision_vs_luna_decision',
    note: 'Agreement is not accuracy and is not compared with labels.',
    comparableCaseCount,
    nonComparableCaseCount: cases.length - comparableCaseCount,
    agreement: ratio(agreementCount, comparableCaseCount),
    discordantPairCounts: { jevCreatePlanLunaFallback, jevFallbackLunaCreatePlan },
    labelStatusCounts: labels,
    provisional: provisionalLabelCounts(labels),
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

function pairedDiscordance(
  cases: readonly CompletedCase[],
  basis: 'label_correctness' | 'false_create_risk' = 'label_correctness',
): PairedDiscordanceMetrics {
  let bLunaCorrectFocusedBoundaryWrong = 0;
  let cFocusedBoundaryCorrectLunaWrong = 0;
  for (const value of cases) {
    const expected = value.result.expected;
    const lunaCorrect = basis === 'false_create_risk'
      ? value.result.luna.decision !== 'create_plan'
      : value.result.luna.decision === expected;
    const focusedBoundaryCorrect = basis === 'false_create_risk'
      ? value.result.focusedBoundary.finalDecision !== 'create_plan'
      : value.result.focusedBoundary.finalDecision === expected;
    if (lunaCorrect && !focusedBoundaryCorrect) bLunaCorrectFocusedBoundaryWrong += 1;
    if (!lunaCorrect && focusedBoundaryCorrect) cFocusedBoundaryCorrectLunaWrong += 1;
  }
  const labels = countLabelStatuses(cases.map((value) => value.result.labelStatus));
  return {
    caseCount: cases.length,
    bLunaCorrectFocusedBoundaryWrong,
    cFocusedBoundaryCorrectLunaWrong,
    exactTwoSidedMcNemarPValue: exactTwoSidedMcNemarPValue(
      bLunaCorrectFocusedBoundaryWrong,
      cFocusedBoundaryCorrectLunaWrong,
    ),
    labelStatusCounts: labels,
    provisional: provisionalLabelCounts(labels),
  };
}

function summarizePairedVsLabels(cases: readonly CompletedCase[]): PairedVsLabelsMetrics {
  const labels = countLabelStatuses(cases.map((value) => value.result.labelStatus));
  return {
    note: 'Paired correctness uses supplied labels; repeated paraphrases in one conversation group are not independent observations.',
    overall: pairedDiscordance(cases),
    expectedFallbackFalseCreateRisk: pairedDiscordance(
      cases.filter((value) => value.result.expected === 'fallback'),
      'false_create_risk',
    ),
    labelStatusCounts: labels,
    provisional: provisionalLabelCounts(labels),
  };
}

function summarizeComparison(cases: readonly CompletedCase[]): FocusedAuthorizationComparisonMetrics {
  const labels = countLabelStatuses(cases.map((value) => value.result.labelStatus));
  return {
    jev: summarizeJev(cases),
    luna: summarizeQuality(cases.map((value) => value.lunaQuality)),
    focusedBoundary: summarizeFocusedBoundary(cases),
    jevLunaAgreement: summarizeAgreement(cases),
    pairedVsLabels: summarizePairedVsLabels(cases),
    labelStatusCounts: labels,
    provisional: provisionalLabelCounts(labels),
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
  jev: DecisionEvaluation | null,
  luna: LunaFocusedAuthorizationEvaluation,
): FocusedAuthorizationFocusedBoundaryResult {
  if (jev === null) {
    return {
      route: 'luna_only_invalid_context',
      status: luna.status,
      finalDecision: luna.status === 'evaluated' ? luna.decision : null,
      totalLatencyMs: luna.metadata.latencyMs,
      totalCostUsd: nullableAggregate([luna.metadata.costUsd]),
      continuesToGenericSemantic: luna.status !== 'evaluated' || luna.decision === 'fallback',
    };
  }
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
  for (const [index, candidate] of candidates.entries()) {
    const label = labels[candidate.id];
    const context: FocusedAuthorizationEvaluationContext = {
      currentUserText: candidate.currentUserText,
      lastAssistantMessage: candidate.lastAssistantMessage,
    };
    const providerContext = {
      purpose: 'focused_authorization',
      requestId: `jev-luna-comparison:${index}`,
      inputRevision: 0,
      previousStatus: 'needs_scope',
      hasTasks: true,
      hasPendingQuestion: false,
      state: context,
    } as const;
    const jevEligible = isFocusedAuthorizationDecisionContext(providerContext);
    const [jevEvaluation, lunaEvaluation] = await Promise.all([
      jevEligible ? providers.jev.evaluate(context) : Promise.resolve(null),
      providers.luna.evaluate(context),
    ]);
    const final = focusedBoundaryResult(jevEvaluation, lunaEvaluation);
    const jevResult: JevComparisonResult = {
      rawChoice: jevEvaluation?.status === 'evaluated' ? jevEvaluation.decision : null,
      probabilities: jevEvaluation?.status === 'evaluated' ? jevEvaluation.probabilities : null,
      conditionChange: jevEvaluation?.status === 'evaluated' ? jevEvaluation.conditionChange : null,
      independentMeaning: jevEvaluation?.status === 'evaluated' ? jevEvaluation.independentMeaning : null,
      gateOutcome: jevEvaluation === null
        ? 'rejected_before_provider'
        : gateOutcomeForEvaluation(jevEvaluation),
      unavailableReason: jevEvaluation?.status === 'unavailable' ? jevEvaluation.reason : null,
      latencyMs: jevEvaluation?.metadata.latencyMs ?? null,
      tokens: {
        prompt: jevEvaluation?.metadata.inputTokens ?? null,
        completion: jevEvaluation?.metadata.outputTokens ?? null,
      },
      costUsd: jevEvaluation?.metadata.costUsd ?? null,
      requestedModel: jevEvaluation?.metadata.requestedModel ?? null,
      servedModel: jevEvaluation?.metadata.servedModel ?? null,
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
    const focusedBoundaryTokenComponents = jevEvaluation === null
      ? [lunaEvaluation.metadata.promptTokens]
      : final.route === 'jev_accepted'
      ? [jevEvaluation.metadata.inputTokens]
      : [jevEvaluation.metadata.inputTokens, lunaEvaluation.metadata.promptTokens];
    const focusedBoundaryCompletionComponents = jevEvaluation === null
      ? [lunaEvaluation.metadata.completionTokens]
      : final.route === 'jev_accepted'
      ? [jevEvaluation.metadata.outputTokens]
      : [jevEvaluation.metadata.outputTokens, lunaEvaluation.metadata.completionTokens];
    completed.push({
      result,
      jevEvaluation,
      lunaEvaluation,
      jevQuality: jevEvaluation === null ? null : {
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
        costComponents: jevEvaluation === null
          ? [lunaEvaluation.metadata.costUsd]
          : final.route === 'jev_accepted'
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
    independenceNote: 'Repeated paraphrases in one conversation group are not independent observations.',
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
