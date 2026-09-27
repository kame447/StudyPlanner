import { describe, expect, it } from 'vitest';
import type { DecisionEvaluation } from './decisionProvider';
import {
  gateUserContextRoutingDecision,
  USER_CONTEXT_ROUTING_DECISION_CATALOG,
  userContextRoutingCanarySelected,
  userContextRoutingDecisionMode,
  type UserContextRoutingDecision,
} from './userContextRoutingPolicy';

function evaluated(
  decision: UserContextRoutingDecision,
  overrides: Partial<Extract<
    DecisionEvaluation<UserContextRoutingDecision>,
    { status: 'evaluated' }
  >> = {},
): DecisionEvaluation<UserContextRoutingDecision> {
  return {
    status: 'evaluated',
    decision,
    confidence: 0.999,
    probabilities: {
      user_context: decision === 'user_context' ? 0.995 : 0.001,
      bookshelf: decision === 'bookshelf' ? 0.995 : 0.001,
      timetable: decision === 'timetable' ? 0.995 : 0.001,
      schedule: decision === 'schedule' ? 0.995 : 0.001,
      actual: decision === 'actual' ? 0.995 : 0.001,
      uncertain: decision === 'uncertain' ? 0.995 : 0,
    },
    conditionChange: 0.001,
    independentMeaning: 0.001,
    metadata: {
      provider: 'openrouter',
      requestedModel: 'typesafe/jev-1.15',
      servedModel: 'typesafe/jev-1.15',
      latencyMs: 20,
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.00001,
      requestBytes: 100,
      responseBytes: 100,
    },
    ...overrides,
  };
}

describe('userContextRoutingPolicy', () => {
  it.each(['bookshelf', 'timetable', 'schedule', 'actual'] as const)(
    'accepts a high-confidence, single-owner %s route',
    (decision) => {
      expect(gateUserContextRoutingDecision(evaluated(decision)))
        .toEqual({ status: 'accepted', decision });
    },
  );

  it('always leaves user_context and uncertain choices to Luna', () => {
    expect(gateUserContextRoutingDecision(evaluated('user_context')))
      .toEqual({ status: 'deferred', reason: 'luna_owned' });
    expect(gateUserContextRoutingDecision(evaluated('uncertain')))
      .toEqual({ status: 'deferred', reason: 'uncertain_choice' });
  });

  it('abstains on weak choice evidence or conflicting auxiliary heads', () => {
    expect(gateUserContextRoutingDecision(evaluated('bookshelf', {
      confidence: 0.96,
    }))).toEqual({ status: 'abstained', reason: 'uncertain' });
    expect(gateUserContextRoutingDecision(evaluated('schedule', {
      independentMeaning: 0.101,
    }))).toEqual({ status: 'abstained', reason: 'conflicting_heads' });
    expect(gateUserContextRoutingDecision(evaluated('actual', {
      conditionChange: 0.151,
    }))).toEqual({ status: 'abstained', reason: 'conflicting_heads' });
  });

  it('accepts the tuning-only calibrated auxiliary boundary without weakening main evidence', () => {
    expect(gateUserContextRoutingDecision(evaluated('schedule', {
      confidence: 0.97,
      probabilities: {
        user_context: 0.002,
        bookshelf: 0.002,
        timetable: 0.002,
        schedule: 0.99,
        actual: 0.002,
        uncertain: 0.002,
      },
      conditionChange: 0.15,
      independentMeaning: 0.10,
    }))).toEqual({ status: 'accepted', decision: 'schedule' });
    expect(gateUserContextRoutingDecision(evaluated('schedule', {
      confidence: 0.969,
      conditionChange: 0.15,
      independentMeaning: 0.10,
    }))).toEqual({ status: 'abstained', reason: 'uncertain' });
  });

  it('routes every provider failure to the existing interpreter', () => {
    const unavailable: DecisionEvaluation<UserContextRoutingDecision> = {
      status: 'unavailable',
      reason: 'model_mismatch',
      metadata: evaluated('bookshelf').metadata,
    };
    expect(gateUserContextRoutingDecision(unavailable))
      .toEqual({ status: 'unavailable', reason: 'model_mismatch' });
  });

  it('defines a closed six-choice catalog and conservative rollout', () => {
    expect(USER_CONTEXT_ROUTING_DECISION_CATALOG.decisions).toEqual([
      'user_context',
      'bookshelf',
      'timetable',
      'schedule',
      'actual',
      'uncertain',
    ]);
    expect(userContextRoutingDecisionMode({})).toBe('off');
    expect(userContextRoutingDecisionMode({ JEV_MODE: 'typo' })).toBe('off');
    expect(userContextRoutingCanarySelected({
      JEV_MODE: 'canary',
      JEV_CANARY_PERCENT: '5',
    }, 0.04)).toBe(true);
    expect(userContextRoutingCanarySelected({
      JEV_MODE: 'canary',
      JEV_CANARY_PERCENT: '5',
    }, 0.06)).toBe(false);
  });
});
