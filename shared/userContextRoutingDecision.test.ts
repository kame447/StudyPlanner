import { describe, expect, it } from 'vitest';
import {
  isUserContextRoutingDecisionContext,
  isUserContextRoutingDecisionResponse,
} from './userContextRoutingDecision';

describe('userContextRoutingDecision', () => {
  const context = {
    purpose: 'user_context_routing',
    requestId: 'request-1',
    inputRevision: 0,
    state: { currentUserText: '数学の確率がずっと苦手です' },
  };

  it('accepts only the bounded routing projection', () => {
    expect(isUserContextRoutingDecisionContext(context)).toBe(true);
    expect(isUserContextRoutingDecisionContext({
      ...context,
      state: { ...context.state, existingRecord: { value: 'untrusted' } },
    })).toBe(false);
    expect(isUserContextRoutingDecisionContext({ ...context, save: true })).toBe(false);
  });

  it('rejects empty, oversized and unknown-purpose contexts', () => {
    expect(isUserContextRoutingDecisionContext({
      ...context,
      state: { currentUserText: '   ' },
    })).toBe(false);
    expect(isUserContextRoutingDecisionContext({
      ...context,
      state: { currentUserText: 'あ'.repeat(2_667) },
    })).toBe(false);
    expect(isUserContextRoutingDecisionContext({
      ...context,
      purpose: 'future_user_context_routing',
    })).toBe(false);
  });

  it('accepts only the closed external-owner response', () => {
    expect(isUserContextRoutingDecisionResponse({
      decision: 'external_owner',
      targetDomain: 'bookshelf',
    })).toBe(true);
    expect(isUserContextRoutingDecisionResponse({
      decision: 'external_owner',
      targetDomain: 'user_context',
    })).toBe(false);
    expect(isUserContextRoutingDecisionResponse({
      decision: 'external_owner',
      targetDomain: 'schedule',
      displayText: 'invented',
    })).toBe(false);
  });
});
