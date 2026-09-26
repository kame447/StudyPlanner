import type { AuthorizationDecision, DecisionEvaluation } from '../decisionProvider';
import { gateDecision, type DecisionGate } from '../decisionPolicy';

export interface FocusedAuthorizationEvaluationSample {
  id: string;
  expected: AuthorizationDecision;
  evaluation: DecisionEvaluation;
}

export type GateOutcome = 'accepted_create_plan' | 'accepted_fallback' | 'abstained' | 'unavailable';

export interface RatioMetric {
  numerator: number;
  denominator: number;
  value: number | null;
}

export interface ClassMetrics {
  precision: RatioMetric;
  recall: RatioMetric;
}

export interface FocusedAuthorizationEvaluationMetrics {
  fixtureCaseCount: number;
  evaluationEligibleCaseCount: number;
  rejectedBeforeProviderCount: number;
  gateOutcomes: Record<GateOutcome, number>;
  byClass: Record<AuthorizationDecision, ClassMetrics>;
  coverage: RatioMetric;
  selectiveAccuracy: RatioMetric;
  falseAutoCreatePlanCount: number;
  abstentionRate: RatioMetric;
  unavailableRate: RatioMetric;
  latencyMs: {
    sampleCount: number;
    p50: number | null;
    p95: number | null;
    p99: number | null;
  };
  reportedCostUsd: {
    reportedCaseCount: number;
    unknownCaseCount: number;
    knownSubtotal: number | null;
    completeTotal: number | null;
  };
}

function ratio(numerator: number, denominator: number): RatioMetric {
  return { numerator, denominator, value: denominator === 0 ? null : numerator / denominator };
}

function outcome(gate: DecisionGate): GateOutcome {
  if (gate.status === 'accepted') return gate.decision === 'create_plan' ? 'accepted_create_plan' : 'accepted_fallback';
  return gate.status;
}

function percentile(values: readonly number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)];
}

export function summarizeFocusedAuthorizationEvaluation(
  samples: readonly FocusedAuthorizationEvaluationSample[],
  rejectedBeforeProviderCount = 0,
): FocusedAuthorizationEvaluationMetrics {
  const gateOutcomes: Record<GateOutcome, number> = {
    accepted_create_plan: 0, accepted_fallback: 0, abstained: 0, unavailable: 0,
  };
  const expectedCounts: Record<AuthorizationDecision, number> = { create_plan: 0, fallback: 0 };
  const predictedCounts: Record<AuthorizationDecision, number> = { create_plan: 0, fallback: 0 };
  const correctCounts: Record<AuthorizationDecision, number> = { create_plan: 0, fallback: 0 };
  let acceptedCount = 0;
  let acceptedCorrectCount = 0;
  let falseAutoCreatePlanCount = 0;
  let knownCostSubtotal = 0;
  let reportedCostCount = 0;
  const latencies: number[] = [];

  for (const sample of samples) {
    expectedCounts[sample.expected] += 1;
    const gate = gateDecision(sample.evaluation);
    gateOutcomes[outcome(gate)] += 1;
    latencies.push(sample.evaluation.metadata.latencyMs);
    const cost = sample.evaluation.metadata.costUsd;
    if (cost !== null) {
      reportedCostCount += 1;
      knownCostSubtotal += cost;
    }
    if (gate.status !== 'accepted') continue;
    acceptedCount += 1;
    predictedCounts[gate.decision] += 1;
    if (gate.decision === sample.expected) {
      acceptedCorrectCount += 1;
      correctCounts[gate.decision] += 1;
    }
    if (gate.decision === 'create_plan' && sample.expected === 'fallback') {
      falseAutoCreatePlanCount += 1;
    }
  }

  const unknownCaseCount = samples.length - reportedCostCount;
  return {
    fixtureCaseCount: samples.length + rejectedBeforeProviderCount,
    evaluationEligibleCaseCount: samples.length,
    rejectedBeforeProviderCount,
    gateOutcomes,
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
    coverage: ratio(acceptedCount, samples.length),
    selectiveAccuracy: ratio(acceptedCorrectCount, acceptedCount),
    falseAutoCreatePlanCount,
    abstentionRate: ratio(gateOutcomes.abstained, samples.length),
    unavailableRate: ratio(gateOutcomes.unavailable, samples.length),
    latencyMs: {
      sampleCount: latencies.length,
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99),
    },
    reportedCostUsd: {
      reportedCaseCount: reportedCostCount,
      unknownCaseCount,
      knownSubtotal: reportedCostCount === 0 ? null : knownCostSubtotal,
      completeTotal: samples.length > 0 && unknownCaseCount === 0 ? knownCostSubtotal : null,
    },
  };
}

export function gateOutcomeForEvaluation(evaluation: DecisionEvaluation): GateOutcome {
  return outcome(gateDecision(evaluation));
}
