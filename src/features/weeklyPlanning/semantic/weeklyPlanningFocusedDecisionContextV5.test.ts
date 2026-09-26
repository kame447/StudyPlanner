import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import {
  focusedContextualDecisionContextV5,
  focusedDecisionContextV5,
} from './weeklyPlanningFocusedDecisionContextV5';
import {
  tryFocusedAuthorizationRouteV5,
  tryFocusedContextualAnswerRouteV5,
} from './weeklyPlanningSemanticFocusedPreRoutesV5';
import { WeeklyPlanningSemanticNormalizerRunV5 } from './weeklyPlanningSemanticNormalizerRunV5';
import { beginWeeklyPlanningStableV5DebugTrace, takeWeeklyPlanningStableV5DebugTrace, resetWeeklyPlanningStableV5DebugTraceForTest } from '../trace/weeklyPlanningStableV5DebugTrace';

function input() {
  return {
    userText: 'private-projection-user-text', traceRequestId: 'request-305-fixture',
    publicStateSummary: {
      graphRevision: 2, previousCompatibilityStatus: 'needs_scope', pendingQuestion: null,
      tasks: [{ id: 'task-1', title: 'private-task-not-sent' }],
      lastAssistantMessage: 'private-assistant-context',
      unrelatedMemory: 'private-memory-not-sent',
    },
  };
}

afterEach(resetWeeklyPlanningStableV5DebugTraceForTest);

describe('bounded focused decision context', () => {
  it('projects only eligible state and preserves the draft-only builder and privacy exclusion', async () => {
    const original = input();
    const client = { createChatCompletion: vi.fn<OpenAiCompatibleClient['createChatCompletion']>(async () => '{"decision":"create_plan"}') };
    beginWeeklyPlanningStableV5DebugTrace(original.traceRequestId);
    const result = await tryFocusedAuthorizationRouteV5(new WeeklyPlanningSemanticNormalizerRunV5(client, original));
    expect(result.result?.document).toMatchObject({ planningIntent: 'create_plan', tasks: [], decisions: [] });
    const context = client.createChatCompletion.mock.calls[0][0].decisionContext;
    expect(context).toMatchObject({ inputRevision: 2, state: { currentUserText: original.userText } });
    expect(JSON.stringify(context)).not.toContain('private-task-not-sent');
    expect(JSON.stringify(context)).not.toContain('private-memory-not-sent');
    const trace = JSON.stringify(takeWeeklyPlanningStableV5DebugTrace(original.traceRequestId));
    expect(trace).toContain('"status":"accepted"');
    expect(trace).toContain('"requestBytes"');
    // Network request/response payloads are intentionally excluded from this diagnostic.
    expect(trace).not.toContain(original.userText);
    expect(trace).not.toContain(original.publicStateSummary.lastAssistantMessage);
    expect(trace).not.toContain('decisionContext');
  });

  it('does not attach a decision context for unbounded input or absent revision', () => {
    expect(focusedDecisionContextV5({ ...input(), userText: 'あ'.repeat(3000) })).toBeUndefined();
    expect(focusedDecisionContextV5({ ...input(), publicStateSummary: { ...input().publicStateSummary, graphRevision: undefined } })).toBeUndefined();
  });

  it('projects only the minimum typed pending-question context for contextual decisions', () => {
    const contextualInput = {
      userText: '残っている量です。',
      traceRequestId: 'request-contextual-fixture',
      publicStateSummary: {
        graphRevision: 8,
        pendingQuestion: {
          questionCode: 'quantity_role_unresolved',
          targetFactId: 'workload-1',
          graphRevision: 8,
        },
        workloads: [{
          publicId: 'workload-1',
          taskPublicId: 'task-1',
          componentPublicId: null,
          quantityRole: 'declared',
          amount: 20,
          unitCode: 'page',
          unitLabel: 'ページ',
          rangeStart: null,
          rangeEnd: null,
          perOccurrence: false,
          periodExpression: null,
        }],
        tasks: [{ publicId: 'task-1', category: 'study', title: 'private-title' }],
        components: [],
        relations: [{ publicId: 'private-relation' }],
      },
    };

    const context = focusedContextualDecisionContextV5(contextualInput);
    expect(context).toEqual({
      purpose: 'focused_contextual_answer',
      requestId: contextualInput.traceRequestId,
      inputRevision: 8,
      questionCode: 'quantity_role_unresolved',
      state: {
        currentUserText: contextualInput.userText,
        pendingQuestion: {
          targetQuantityRole: 'declared',
          questionBasis: null,
          hasEstimateTarget: false,
        },
      },
    });
    expect(JSON.stringify(context)).not.toContain('private-title');
    expect(JSON.stringify(context)).not.toContain('private-relation');
    expect(JSON.stringify(context)).not.toContain('workload-1');
  });

  it('excludes the contextual routing envelope from persisted debug trace diagnostics', async () => {
    const contextualInput = {
      userText: '残っている量です。',
      traceRequestId: 'request-contextual-trace',
      publicStateSummary: {
        graphRevision: 8,
        pendingQuestion: {
          questionCode: 'quantity_role_unresolved',
          targetFactId: 'workload-1',
          graphRevision: 8,
        },
        workloads: [{
          publicId: 'workload-1',
          taskPublicId: 'task-1',
          componentPublicId: null,
          quantityRole: 'declared',
          amount: 20,
          unitCode: 'page',
          unitLabel: 'ページ',
          rangeStart: null,
          rangeEnd: null,
          perOccurrence: false,
          periodExpression: null,
        }],
        tasks: [{ publicId: 'task-1', category: 'study', title: 'private-title' }],
        components: [],
      },
    };
    const client = {
      createChatCompletion: vi.fn<OpenAiCompatibleClient['createChatCompletion']>(async () =>
        JSON.stringify({
          decision: 'quantity_role_answer',
          effortTarget: null,
          effortMeasurement: null,
          minutes: null,
          precision: null,
          quantityRole: 'remaining',
        })),
    };
    beginWeeklyPlanningStableV5DebugTrace(contextualInput.traceRequestId);
    const result = await tryFocusedContextualAnswerRouteV5(
      new WeeklyPlanningSemanticNormalizerRunV5(client, contextualInput),
    );
    expect(result?.status).toBe('accepted');
    expect(client.createChatCompletion.mock.calls[0][0].decisionContext)
      .toMatchObject({ purpose: 'focused_contextual_answer' });
    const trace = JSON.stringify(takeWeeklyPlanningStableV5DebugTrace(
      contextualInput.traceRequestId,
    ));
    // The envelope duplicates untrusted text and exists only for Worker routing;
    // requestBytes plus the existing prompt/response diagnostics remain available.
    expect(trace).not.toContain('decisionContext');
    expect(trace).toContain('requestBytes');
    expect(trace).toContain('semantic_focused_contextual_answer_result');
  });
});
