import { describe, expect, it } from 'vitest';
import type { DecisionEvaluation, DecisionMetadata } from './decisionProvider';
import {
  gateTemporalScopeRepairDecision,
  temporalScopeRepairCanarySelected,
  temporalScopeRepairDecisionMode,
  type TemporalScopeRepairDecision,
} from './temporalScopeRepairDecisionPolicy';

const metadata: DecisionMetadata = {
  provider: 'openrouter',
  requestedModel: 'typesafe/jev-1.13',
  servedModel: 'typesafe/jev-1.13',
  latencyMs: 1,
  inputTokens: 1,
  outputTokens: 1,
  costUsd: null,
  requestBytes: 1,
  responseBytes: 1,
};

function evaluated(
  decision: TemporalScopeRepairDecision,
  options: Partial<{
    confidence: number;
    selectedProbability: number;
    conditionChange: number;
    independentMeaning: number;
  }> = {},
): DecisionEvaluation<TemporalScopeRepairDecision> {
  const selectedProbability = options.selectedProbability ?? 0.995;
  return {
    status: 'evaluated',
    decision,
    confidence: options.confidence ?? 0.99,
    probabilities: {
      plan_unavailable: decision === 'plan_unavailable'
        ? selectedProbability
        : 1 - selectedProbability,
      uncertain: decision === 'uncertain'
        ? selectedProbability
        : 1 - selectedProbability,
    },
    conditionChange: options.conditionChange ?? 0.001,
    independentMeaning: options.independentMeaning ?? 0.001,
    metadata,
  };
}

describe('temporal-scope repair Jev gate', () => {
  it('accepts plan-wide unavailability only at the strict boundary', () => {
    expect(gateTemporalScopeRepairDecision(evaluated('plan_unavailable')))
      .toEqual({ status: 'accepted', decision: 'plan_unavailable' });
    expect(gateTemporalScopeRepairDecision(evaluated('plan_unavailable', {
      confidence: 0.969,
    }))).toEqual({ status: 'abstained', reason: 'uncertain' });
    expect(gateTemporalScopeRepairDecision(evaluated('plan_unavailable', {
      selectedProbability: 0.989,
    }))).toEqual({ status: 'abstained', reason: 'uncertain' });
  });

  it('can accept high-confidence uncertain because it is the safe repair', () => {
    expect(gateTemporalScopeRepairDecision(evaluated('uncertain', {
      confidence: 0.8,
      selectedProbability: 0.85,
      conditionChange: 0.4,
      independentMeaning: 0.6,
    }))).toEqual({ status: 'accepted', decision: 'uncertain' });
  });

  it('abstains on conflicting auxiliary heads for either choice', () => {
    expect(gateTemporalScopeRepairDecision(evaluated('plan_unavailable', {
      conditionChange: 0.051,
    }))).toEqual({ status: 'abstained', reason: 'conflicting_heads' });
    expect(gateTemporalScopeRepairDecision(evaluated('uncertain', {
      independentMeaning: 0.601,
    }))).toEqual({ status: 'abstained', reason: 'conflicting_heads' });
  });

  it('keeps provider failures unavailable for real Luna fallback', () => {
    expect(gateTemporalScopeRepairDecision({
      status: 'unavailable',
      reason: 'timeout',
      metadata,
    })).toEqual({ status: 'unavailable', reason: 'timeout' });
  });

  it('defaults off and requires a supported explicit canary percentage', () => {
    expect(temporalScopeRepairDecisionMode({})).toBe('off');
    expect(temporalScopeRepairDecisionMode({ JEV_MODE: 'invalid' })).toBe('off');
    expect(temporalScopeRepairCanarySelected({ JEV_MODE: 'canary' }, 0)).toBe(false);
    expect(temporalScopeRepairCanarySelected({
      JEV_MODE: 'canary',
      JEV_CANARY_PERCENT: '5',
    }, 0.04)).toBe(true);
    expect(temporalScopeRepairCanarySelected({
      JEV_MODE: 'canary',
      JEV_CANARY_PERCENT: '5',
    }, 0.06)).toBe(false);
  });
});
