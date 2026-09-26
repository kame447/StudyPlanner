import { describe, expect, it } from 'vitest';
import type { DecisionEvaluation, DecisionMetadata, DecisionProvider } from '../decisionProvider';
import { JEV_CATALOG_VERSION, JEV_GATE_VERSION } from '../decisionPolicy';
import { evaluateFocusedAuthorizationCandidates } from './focusedAuthorizationEvaluation';
import {
  FOCUSED_AUTHORIZATION_EVALUATION_LAYERS,
  FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES,
  FOCUSED_AUTHORIZATION_SYNTHETIC_FIXTURE_SET_VERSION,
  validateFocusedAuthorizationSyntheticCandidates,
  type FocusedAuthorizationSyntheticCandidate,
} from './focusedAuthorizationSyntheticCandidates';

const metadata = (latencyMs: number, costUsd: number | null): DecisionMetadata => ({
  provider: 'openrouter', requestedModel: 'mock-jev', servedModel: 'mock-jev', latencyMs,
  inputTokens: null, outputTokens: null, costUsd, requestBytes: 1, responseBytes: 1,
});

function evaluated(
  decision: 'create_plan' | 'fallback',
  latencyMs: number,
  costUsd: number | null,
  confidence = 0.999,
): DecisionEvaluation {
  return {
    status: 'evaluated', decision, confidence,
    probabilities: decision === 'create_plan'
      ? { create_plan: 0.999, fallback: 0.001 }
      : { create_plan: 0.001, fallback: 0.999 },
    conditionChange: decision === 'fallback' ? 0.999 : 0.001,
    independentMeaning: decision === 'fallback' ? 0.999 : 0.001,
    metadata: metadata(latencyMs, costUsd),
  };
}

function fixture(id: string, expected: 'create_plan' | 'fallback'): FocusedAuthorizationSyntheticCandidate {
  return {
    id, conversationGroupId: id, layer: 'plain_authorization',
    lastAssistantMessage: 'この条件で案を作りますか？', currentUserText: id,
    expected, split: 'tuning', reviewStatus: 'synthetic_unreviewed',
  };
}

describe('focused authorization synthetic candidates', () => {
  it('keeps a modest stratified candidate set explicitly unreviewed and group-safe', () => {
    expect(() => validateFocusedAuthorizationSyntheticCandidates(FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES)).not.toThrow();
    expect(FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES.length).toBeGreaterThanOrEqual(40);
    expect(FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES.length).toBeLessThanOrEqual(80);
    expect(new Set(FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES.map((value) => value.layer)))
      .toEqual(new Set(FOCUSED_AUTHORIZATION_EVALUATION_LAYERS));
    for (const layer of FOCUSED_AUTHORIZATION_EVALUATION_LAYERS) {
      expect(new Set(FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES
        .filter((value) => value.layer === layer).map((value) => value.split)))
        .toEqual(new Set(['tuning', 'holdout']));
    }
    expect(FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES.every((value) => value.reviewStatus === 'synthetic_unreviewed')).toBe(true);
    const holdoutCounts = FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES
      .filter((value) => value.split === 'holdout')
      .reduce((counts, value) => ({ ...counts, [value.expected]: counts[value.expected] + 1 }), {
        create_plan: 0, fallback: 0,
      });
    expect(holdoutCounts).toEqual({ create_plan: 6, fallback: 16 });
  });

  it('rejects paraphrases from one conversation group crossing tuning and holdout', () => {
    const original = FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES[0];
    const crossed: FocusedAuthorizationSyntheticCandidate = {
      ...original, id: `${original.id}-crossed`, split: original.split === 'tuning' ? 'holdout' : 'tuning',
    };
    expect(() => validateFocusedAuthorizationSyntheticCandidates([original, crossed]))
      .toThrow(/crosses evaluation splits/);
  });
});

describe('focused authorization evaluation metrics', () => {
  it('rejects production-ineligible fixtures before the provider and excludes them from quality denominators', async () => {
    let providerCalls = 0;
    const provider: DecisionProvider = {
      evaluate: async () => {
        providerCalls += 1;
        return evaluated('create_plan', 12, 0.01);
      },
    };
    const emptyText = { ...fixture('empty-text', 'fallback'), currentUserText: '' };
    const oversizedAssistant = {
      ...fixture('oversized-assistant', 'fallback'), lastAssistantMessage: 'あ'.repeat(2_000),
    };

    const report = await evaluateFocusedAuthorizationCandidates([
      emptyText, oversizedAssistant, fixture('eligible', 'create_plan'),
    ], provider);

    expect(providerCalls).toBe(1);
    expect(report.cases.map((value) => value.gateOutcome)).toEqual([
      'rejected_before_provider', 'rejected_before_provider', 'accepted_create_plan',
    ]);
    expect(report.metrics.global).toMatchObject({
      fixtureCaseCount: 3,
      evaluationEligibleCaseCount: 1,
      rejectedBeforeProviderCount: 2,
      coverage: { numerator: 1, denominator: 1, value: 1 },
      selectiveAccuracy: { numerator: 1, denominator: 1, value: 1 },
    });
  });

  it('uses an injected DecisionProvider and reports gate, safety, denominator, latency and unknown-cost metrics', async () => {
    const evaluations: DecisionEvaluation[] = [
      evaluated('create_plan', 10, 0.01),
      evaluated('create_plan', 20, 0.02),
      evaluated('fallback', 30, null),
      evaluated('create_plan', 40, 0.04, 0.5),
      {
        status: 'unavailable', reason: 'timeout',
        metadata: { ...metadata(100, 0.05), servedModel: null },
      },
      evaluated('fallback', 60, 0.06),
    ];
    const provider: DecisionProvider = {
      evaluate: async () => {
        const result = evaluations.shift();
        if (!result) throw new Error('Unexpected mock provider call.');
        return result;
      },
    };
    const candidates = [
      fixture('correct-create', 'create_plan'),
      fixture('false-auto-create', 'fallback'),
      fixture('correct-fallback', 'fallback'),
      fixture('abstained-create', 'create_plan'),
      fixture('unavailable-fallback', 'fallback'),
      fixture('wrong-fallback', 'create_plan'),
    ];

    const report = await evaluateFocusedAuthorizationCandidates(candidates, provider);

    expect(report.cases.map((value) => value.gateOutcome)).toEqual([
      'accepted_create_plan', 'accepted_create_plan', 'accepted_fallback',
      'abstained', 'unavailable', 'accepted_fallback',
    ]);
    expect(report.metrics.global.gateOutcomes).toEqual({
      accepted_create_plan: 2, accepted_fallback: 2, abstained: 1, unavailable: 1,
    });
    expect(report.metrics.global).toMatchObject({
      fixtureCaseCount: 6, evaluationEligibleCaseCount: 6, rejectedBeforeProviderCount: 0,
    });
    expect(report.metrics.global.coverage).toEqual({ numerator: 4, denominator: 6, value: 4 / 6 });
    expect(report.metrics.global.selectiveAccuracy).toEqual({ numerator: 2, denominator: 4, value: 0.5 });
    expect(report.metrics.global.falseAutoCreatePlanCount).toBe(1);
    expect(report.metrics.global.falseAutoCreatePlanRate)
      .toEqual({ numerator: 1, denominator: 3, value: 1 / 3 });
    expect(report.metrics.global.byClass.create_plan.precision).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    expect(report.metrics.global.byClass.create_plan.recall).toEqual({ numerator: 1, denominator: 3, value: 1 / 3 });
    expect(report.metrics.global.byClass.fallback.precision).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    expect(report.metrics.global.byClass.fallback.recall).toEqual({ numerator: 1, denominator: 3, value: 1 / 3 });
    expect(report.metrics.global.abstentionRate).toEqual({ numerator: 1, denominator: 6, value: 1 / 6 });
    expect(report.metrics.global.unavailableRate).toEqual({ numerator: 1, denominator: 6, value: 1 / 6 });
    expect(report.metrics.global.latencyMs).toEqual({
      evaluatedOnly: { sampleCount: 5, p50: 30, p95: 60, p99: 60 },
      allSamples: { sampleCount: 6, p50: 30, p95: 100, p99: 100 },
    });
    expect(report.metrics.global.reportedCostUsd).toMatchObject({
      reportedCaseCount: 5, unknownCaseCount: 1, completeTotal: null,
    });
    expect(report.metrics.global.reportedCostUsd.knownSubtotal).toBeCloseTo(0.18);
    expect(report).toMatchObject({
      fixtureSetVersion: FOCUSED_AUTHORIZATION_SYNTHETIC_FIXTURE_SET_VERSION,
      catalogVersion: JEV_CATALOG_VERSION,
      gateVersion: JEV_GATE_VERSION,
    });
    expect(report.cases[0]).toMatchObject({
      choice: 'create_plan', confidence: 0.999,
      probabilities: { create_plan: 0.999, fallback: 0.001 },
      conditionChange: 0.001, independentMeaning: 0.001,
      requestedModel: 'mock-jev', servedModel: 'mock-jev',
    });
    expect(report.cases[4]).toMatchObject({
      choice: null, confidence: null, probabilities: null,
      conditionChange: null, independentMeaning: null,
      requestedModel: 'mock-jev', servedModel: null,
    });

    const unknownCostProvider: DecisionProvider = {
      evaluate: async () => ({
        status: 'unavailable', reason: 'configuration', metadata: metadata(1, null),
      }),
    };
    const unknownCostReport = await evaluateFocusedAuthorizationCandidates(
      [fixture('unknown-cost', 'fallback')], unknownCostProvider,
    );
    expect(unknownCostReport.metrics.global.reportedCostUsd).toEqual({
      reportedCaseCount: 0, unknownCaseCount: 1, knownSubtotal: null, completeTotal: null,
    });
    expect(unknownCostReport.metrics.global.latencyMs.evaluatedOnly)
      .toEqual({ sampleCount: 0, p50: null, p95: null, p99: null });
  });

  it('summarizes the same gate metrics globally and by split and layer', async () => {
    const evaluations = [evaluated('create_plan', 10, null), evaluated('fallback', 20, null)];
    const provider: DecisionProvider = {
      evaluate: async () => {
        const result = evaluations.shift();
        if (!result) throw new Error('Unexpected mock provider call.');
        return result;
      },
    };
    const candidates: FocusedAuthorizationSyntheticCandidate[] = [
      fixture('tuning-create', 'create_plan'),
      { ...fixture('holdout-fallback', 'fallback'), split: 'holdout', layer: 'negation' },
      {
        ...fixture('holdout-rejected', 'fallback'), split: 'holdout', layer: 'abnormal_values',
        currentUserText: '',
      },
    ];

    const report = await evaluateFocusedAuthorizationCandidates(candidates, provider);

    expect(report.metrics.global).toMatchObject({
      fixtureCaseCount: 3, evaluationEligibleCaseCount: 2, rejectedBeforeProviderCount: 1,
    });
    expect(report.metrics.bySplit.tuning).toMatchObject({
      fixtureCaseCount: 1, evaluationEligibleCaseCount: 1, rejectedBeforeProviderCount: 0,
    });
    expect(report.metrics.bySplit.holdout).toMatchObject({
      fixtureCaseCount: 2, evaluationEligibleCaseCount: 1, rejectedBeforeProviderCount: 1,
    });
    expect(report.metrics.byLayer.plain_authorization.gateOutcomes.accepted_create_plan).toBe(1);
    expect(report.metrics.byLayer.negation.gateOutcomes.accepted_fallback).toBe(1);
    expect(report.metrics.byLayer.negation.falseAutoCreatePlanRate)
      .toEqual({ numerator: 0, denominator: 1, value: 0 });
    expect(report.metrics.byLayer.abnormal_values).toMatchObject({
      fixtureCaseCount: 1, evaluationEligibleCaseCount: 0, rejectedBeforeProviderCount: 1,
      falseAutoCreatePlanRate: { numerator: 0, denominator: 0, value: null },
    });
  });
});
