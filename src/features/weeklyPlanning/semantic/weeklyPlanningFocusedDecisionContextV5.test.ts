import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { focusedDecisionContextV5 } from './weeklyPlanningFocusedDecisionContextV5';
import { tryFocusedAuthorizationRouteV5 } from './weeklyPlanningSemanticFocusedPreRoutesV5';
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

  it('does not apply a delayed decision after revision, text or eligibility changes', async () => {
    for (const change of [
      (value: ReturnType<typeof input>) => { value.publicStateSummary.graphRevision += 1; },
      (value: ReturnType<typeof input>) => { value.userText = 'changed'; },
      (value: ReturnType<typeof input>) => { value.publicStateSummary.previousCompatibilityStatus = 'ready'; },
    ]) {
      const value = input();
      const client = { createChatCompletion: vi.fn(async () => { change(value); return '{"decision":"create_plan"}'; }) };
      expect(await tryFocusedAuthorizationRouteV5(new WeeklyPlanningSemanticNormalizerRunV5(client, value))).toEqual({ result: null, decision: null });
    }
  });

  it('does not attach a decision context for unbounded input or absent revision', () => {
    expect(focusedDecisionContextV5({ ...input(), userText: 'あ'.repeat(3000) })).toBeUndefined();
    expect(focusedDecisionContextV5({ ...input(), publicStateSummary: { ...input().publicStateSummary, graphRevision: undefined } })).toBeUndefined();
  });
});
