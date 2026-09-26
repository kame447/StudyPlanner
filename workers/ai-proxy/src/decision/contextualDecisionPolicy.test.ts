import { describe, expect, it } from 'vitest';
import type { DecisionEvaluation, DecisionMetadata } from './decisionProvider';
import {
  contextualCanarySelected,
  contextualDecisionMode,
  gateContextualDecision,
  type ContextualDecision,
} from './contextualDecisionPolicy';

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
  decision: ContextualDecision,
  options: Partial<{
    confidence: number;
    selectedProbability: number;
    conditionChange: number;
    independentMeaning: number;
  }> = {},
): DecisionEvaluation<ContextualDecision> {
  const selectedProbability = options.selectedProbability ?? 0.9996;
  const remainder = (1 - selectedProbability) / 4;
  return {
    status: 'evaluated',
    decision,
    confidence: options.confidence ?? 0.999,
    probabilities: {
      target: decision === 'target' ? selectedProbability : remainder,
      remaining: decision === 'remaining' ? selectedProbability : remainder,
      completed: decision === 'completed' ? selectedProbability : remainder,
      focused_luna: decision === 'focused_luna' ? selectedProbability : remainder,
      fallback: decision === 'fallback' ? selectedProbability : remainder,
    },
    conditionChange: options.conditionChange ?? 0.001,
    independentMeaning: options.independentMeaning ?? 0.001,
    metadata,
  };
}

describe('focused contextual Jev gate', () => {
  it.each(['target', 'remaining', 'completed'] as const)(
    'always defers cross-question %s choices to Luna for effort questions',
    (decision) => {
      expect(gateContextualDecision(
        evaluated(decision, { confidence: 1, selectedProbability: 1 }),
        'missing_effort_estimate',
      )).toEqual({ status: 'deferred', reason: 'cross_question_choice' });
    },
  );

  it('keeps effort/provisional tuple ownership with Luna', () => {
    expect(gateContextualDecision(
      evaluated('focused_luna'),
      'missing_effort_estimate',
    )).toEqual({ status: 'deferred', reason: 'luna_owned' });
  });

  it('accepts a high-confidence quantity role only for the quantity question', () => {
    expect(gateContextualDecision(
      evaluated('remaining'),
      'quantity_role_unresolved',
    )).toEqual({ status: 'accepted', decision: 'remaining' });
    expect(gateContextualDecision(
      evaluated('remaining', {
        confidence: 0.8,
        selectedProbability: 0.85,
        conditionChange: 0.4,
        independentMeaning: 0.6,
      }),
      'quantity_role_unresolved',
    )).toEqual({ status: 'accepted', decision: 'remaining' });
  });

  it('routes definite independent meaning to generic semantics', () => {
    expect(gateContextualDecision(
      evaluated('remaining', { independentMeaning: 0.99 }),
      'quantity_role_unresolved',
    )).toEqual({ status: 'accepted', decision: 'fallback' });
  });

  it('abstains on low confidence and conflicting auxiliary heads', () => {
    expect(gateContextualDecision(
      evaluated('remaining', { confidence: 0.5 }),
      'quantity_role_unresolved',
    )).toEqual({ status: 'abstained', reason: 'uncertain' });
    expect(gateContextualDecision(
      evaluated('remaining', { selectedProbability: 0.84 }),
      'quantity_role_unresolved',
    )).toEqual({ status: 'abstained', reason: 'uncertain' });
    expect(gateContextualDecision(
      evaluated('remaining', { conditionChange: 0.41 }),
      'quantity_role_unresolved',
    )).toEqual({ status: 'abstained', reason: 'conflicting_heads' });
    expect(gateContextualDecision(
      evaluated('remaining', { independentMeaning: 0.61 }),
      'quantity_role_unresolved',
    )).toEqual({ status: 'abstained', reason: 'conflicting_heads' });
  });

  it('keeps primary fallback acceptance stricter than calibrated role acceptance', () => {
    expect(gateContextualDecision(
      evaluated('fallback', { confidence: 0.96 }),
      'quantity_role_unresolved',
    )).toEqual({ status: 'abstained', reason: 'uncertain' });
    expect(gateContextualDecision(
      evaluated('fallback', { selectedProbability: 0.98 }),
      'quantity_role_unresolved',
    )).toEqual({ status: 'abstained', reason: 'uncertain' });
    expect(gateContextualDecision(
      evaluated('fallback'),
      'quantity_role_unresolved',
    )).toEqual({ status: 'accepted', decision: 'fallback' });
  });

  it('keeps provider failures unavailable for Luna fallback', () => {
    expect(gateContextualDecision({
      status: 'unavailable',
      reason: 'timeout',
      metadata,
    }, 'quantity_role_unresolved')).toEqual({ status: 'unavailable', reason: 'timeout' });
  });

  it('defaults off and requires an explicit supported canary percentage', () => {
    expect(contextualDecisionMode({})).toBe('off');
    expect(contextualDecisionMode({ JEV_MODE: 'invalid' })).toBe('off');
    expect(contextualCanarySelected({ JEV_MODE: 'canary' }, 0)).toBe(false);
    expect(contextualCanarySelected({
      JEV_MODE: 'canary',
      JEV_CANARY_PERCENT: '5',
    }, 0.04)).toBe(true);
    expect(contextualCanarySelected({
      JEV_MODE: 'canary',
      JEV_CANARY_PERCENT: '5',
    }, 0.06)).toBe(false);
  });
});
