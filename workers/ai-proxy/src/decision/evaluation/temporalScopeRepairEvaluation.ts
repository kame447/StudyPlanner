import type { TemporalScopeRepairCaseClass } from './temporalScopeRepairCorpus';
import type { TemporalScopeRepairDecisionGate } from '../temporalScopeRepairDecisionPolicy';

export interface TemporalScopeRepairEvaluationRecord {
  caseId: string;
  group: string;
  split: 'tuning' | 'holdout' | 'faults';
  caseClass: TemporalScopeRepairCaseClass | 'fault';
  labelSource: 'synthetic_unreviewed' | 'fault_injection';
  expected: 'plan_unavailable' | 'uncertain';
  route: 'jev_first' | 'luna_only';
  providerStatus: 'evaluated' | 'unavailable' | 'not_called';
  providerReason: string | null;
  providerHttpStatus: number | null;
  rawChoice: 'plan_unavailable' | 'uncertain' | null;
  confidence: number | null;
  selectedProbability: number | null;
  conditionChange: number | null;
  independentMeaning: number | null;
  gate: TemporalScopeRepairDecisionGate | null;
  lunaCalled: boolean;
  lunaStatus: number | null;
  finalDecision: 'plan_unavailable' | 'uncertain';
  unexpectedResponseKeys: string[];
  unexpectedDecisionKeys: string[];
  totalLatencyMs: number;
  jevLatencyMs: number | null;
  jevInputTokens: number | null;
  jevOutputTokens: number | null;
  jevCostUsd: number | null;
  lunaLatencyMs: number | null;
  lunaPromptTokens: number | null;
  lunaCompletionTokens: number | null;
}

function binomialCdf(x: number, n: number, p: number): number {
  if (p <= 0) return 1;
  if (p >= 1) return x >= n ? 1 : 0;
  let probability = (1 - p) ** n;
  let sum = probability;
  for (let k = 0; k < x; k += 1) {
    probability *= ((n - k) / (k + 1)) * (p / (1 - p));
    sum += probability;
  }
  return Math.min(1, Math.max(0, sum));
}

export function clopperPearsonUpper95(errors: number, total: number): number | null {
  if (total === 0 || errors >= total) return total === 0 ? null : 1;
  let low = 0;
  let high = 1;
  for (let index = 0; index < 80; index += 1) {
    const middle = (low + high) / 2;
    if (binomialCdf(errors, total, middle) > 0.05) low = middle;
    else high = middle;
  }
  return high;
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)] ?? null;
}

function lunaCostRange(records: readonly TemporalScopeRepairEvaluationRecord[]) {
  const withUsage = records.filter((record) =>
    record.lunaCalled
    && record.lunaPromptTokens !== null
    && record.lunaCompletionTokens !== null);
  const missingUsage = records.filter((record) => record.lunaCalled
    && (record.lunaPromptTokens === null || record.lunaCompletionTokens === null));
  const promptTokens = withUsage.reduce((sum, record) =>
    sum + Number(record.lunaPromptTokens), 0);
  const completionTokens = withUsage.reduce((sum, record) =>
    sum + Number(record.lunaCompletionTokens), 0);
  // Repository pricing: cached input $0.02/M, uncached input $0.20/M,
  // cache write $0.25/M, output $1.20/M. Cache breakdown is absent in the
  // upstream response, so all-cached and all-cache-write bound the known usage.
  const lowerUsd = (promptTokens * 0.02 + completionTokens * 1.2) / 1_000_000;
  const upperUsd = (promptTokens * 0.25 + completionTokens * 1.2) / 1_000_000;
  return {
    promptTokens,
    completionTokens,
    knownCalls: withUsage.length,
    missingUsageCalls: missingUsage.length,
    lowerUsd,
    upperUsd,
  };
}

export function summarizeTemporalScopeRepairEvaluation(
  records: readonly TemporalScopeRepairEvaluationRecord[],
) {
  const semantic = records.filter((record) => record.split !== 'faults');
  const negative = semantic.filter((record) => record.expected === 'uncertain');
  const falsePlanUnavailable = negative.filter((record) =>
    record.finalDecision === 'plan_unavailable');
  const negativeGroups = new Set(negative.map((record) => record.group));
  const falseGroups = new Set(falsePlanUnavailable.map((record) => record.group));
  const labelAgreement = semantic.filter((record) =>
    record.finalDecision === record.expected);
  const directAccepted = semantic.filter((record) =>
    record.route === 'jev_first' && !record.lunaCalled);
  const latency = records.map((record) => record.totalLatencyMs);
  const jevCostValues = records.map((record) => record.jevCostUsd)
    .filter((value): value is number => value !== null);
  const luna = lunaCostRange(records);
  const jevCostKnown = jevCostValues.length === records.filter((record) =>
    record.providerStatus !== 'not_called').length;
  const jevCostUsd = jevCostKnown
    ? jevCostValues.reduce((sum, value) => sum + value, 0)
    : null;
  return {
    cases: semantic.length,
    conversationGroups: new Set(semantic.map((record) => record.group)).size,
    labelStatus: 'Agreement with synthetic_unreviewed labels; not accuracy or gold.',
    directJevAccepts: directAccepted.length,
    lunaFallbacks: records.filter((record) => record.lunaCalled).length,
    planUnavailableFalseAccept: {
      cases: falsePlanUnavailable.length,
      denominatorCases: negative.length,
      upper95Cases: clopperPearsonUpper95(falsePlanUnavailable.length, negative.length),
      groups: falseGroups.size,
      denominatorGroups: negativeGroups.size,
      upper95Groups: clopperPearsonUpper95(falseGroups.size, negativeGroups.size),
      caseIds: falsePlanUnavailable.map((record) => record.caseId),
    },
    syntheticLabelAgreement: {
      count: labelAgreement.length,
      denominator: semantic.length,
    },
    containmentErrors: records.filter((record) =>
      record.unexpectedResponseKeys.length > 0
      || record.unexpectedDecisionKeys.length > 0).map((record) => record.caseId),
    latencyMs: {
      p50: percentile(latency, 0.5),
      p95: percentile(latency, 0.95),
    },
    usageAndCost: {
      jev: {
        inputTokens: records.reduce((sum, record) => sum + (record.jevInputTokens ?? 0), 0),
        outputTokens: records.reduce((sum, record) => sum + (record.jevOutputTokens ?? 0), 0),
        reportedCostUsd: jevCostUsd,
      },
      luna,
      totalKnownRangeUsd: jevCostUsd === null ? null : {
        lower: jevCostUsd + luna.lowerUsd,
        upper: jevCostUsd + luna.upperUsd,
      },
      perTurnKnownRangeUsd: jevCostUsd === null || records.length === 0 ? null : {
        lower: (jevCostUsd + luna.lowerUsd) / records.length,
        upper: (jevCostUsd + luna.upperUsd) / records.length,
      },
      note: luna.missingUsageCalls > 0
        ? 'Range covers calls with reported usage only; missing-usage calls are unknown outside it.'
        : 'Luna range covers cache-allocation uncertainty for every Luna call.',
    },
  };
}
