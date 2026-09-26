import { describe, expect, it } from 'vitest';
import {
  isFocusedContextualDecisionContext,
  isFocusedDecisionContext,
} from './focusedContextualDecision';

function contextualContext() {
  return {
    purpose: 'focused_contextual_answer' as const,
    requestId: 'request-contextual-fixture',
    inputRevision: 4,
    questionCode: 'quantity_role_unresolved' as const,
    state: {
      currentUserText: 'これは残りの量です。',
      pendingQuestion: {
        targetQuantityRole: 'declared' as const,
        questionBasis: null,
        hasEstimateTarget: false,
      },
    },
  };
}

describe('focused contextual decision context', () => {
  it('accepts the bounded discriminated projection', () => {
    const value = contextualContext();
    expect(isFocusedContextualDecisionContext(value)).toBe(true);
    expect(isFocusedDecisionContext(value)).toBe(true);
  });

  it.each([
    ['unknown top-level key', () => ({ ...contextualContext(), model: 'other' })],
    ['unknown state key', () => ({
      ...contextualContext(),
      state: { ...contextualContext().state, canonicalTaskId: 'task-private' },
    })],
    ['unknown pending key', () => ({
      ...contextualContext(),
      state: {
        ...contextualContext().state,
        pendingQuestion: {
          ...contextualContext().state.pendingQuestion,
          schedulerPermission: true,
        },
      },
    })],
    ['unsafe revision', () => ({ ...contextualContext(), inputRevision: Number.MAX_SAFE_INTEGER + 1 })],
    ['oversized text', () => ({
      ...contextualContext(),
      state: { ...contextualContext().state, currentUserText: 'あ'.repeat(2_667) },
    })],
    ['resolved quantity role target', () => ({
      ...contextualContext(),
      state: {
        ...contextualContext().state,
        pendingQuestion: {
          ...contextualContext().state.pendingQuestion,
          targetQuantityRole: 'target',
        },
      },
    })],
  ])('rejects %s', (_name, build) => {
    expect(isFocusedContextualDecisionContext(build())).toBe(false);
  });

  it('requires completed-work basis and estimate-target presence to agree', () => {
    const effort = {
      ...contextualContext(),
      questionCode: 'missing_effort_estimate' as const,
      state: {
        ...contextualContext().state,
        pendingQuestion: {
          targetQuantityRole: 'completed' as const,
          questionBasis: 'completed_workload_total' as const,
          hasEstimateTarget: true,
        },
      },
    };
    expect(isFocusedContextualDecisionContext(effort)).toBe(true);
    expect(isFocusedContextualDecisionContext({
      ...effort,
      state: {
        ...effort.state,
        pendingQuestion: { ...effort.state.pendingQuestion, hasEstimateTarget: false },
      },
    })).toBe(false);
  });
});
