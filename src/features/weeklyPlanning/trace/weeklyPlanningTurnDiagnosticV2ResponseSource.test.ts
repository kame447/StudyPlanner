import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningDialogueRendererTrace } from './weeklyPlanningDialogueRendererTrace';
import {
  createWeeklyPlanningTurnDiagnosticV2,
  type CreateWeeklyPlanningTurnDiagnosticV2WithResponseSourceInput,
} from './weeklyPlanningTurnDiagnosticV2ResponseSource';

const rendererTrace: WeeklyPlanningDialogueRendererTrace = {
  actionId: 'stable-v5:request-1:quantity_role_unresolved',
  actionKind: 'question',
  questionCode: 'quantity_role_unresolved',
  request: {
    purpose: 'weekly_planning_renderer',
    requiredLabels: ['院試の勉強'],
    fallbackText: '今回進めたい量か、残っている全体量か教えてください。',
    previewCount: 0,
  },
  response: {
    status: 'fallback',
    reason: 'provider_error',
    rawResponse: null,
    renderedText: null,
  },
  decision: {
    branch: 'deterministic_fallback',
    responseSource: 'deterministic_fallback',
    finalMessage: '今回進めたい量か、残っている全体量か教えてください。',
  },
};

function input(
  responseSource: 'ai' | 'deterministic_fallback',
  dialogueRendererTrace?: WeeklyPlanningDialogueRendererTrace,
): CreateWeeklyPlanningTurnDiagnosticV2WithResponseSourceInput {
  return {
    id: 'trace-1-00000000',
    sessionId: 'trace-1',
    logicalConversationId: 'conversation-1',
    sequence: 0,
    turnIndex: 0,
    requestId: 'request-1',
    occurredAt: '2026-07-30T00:00:00.000Z',
    observedAt: '2026-07-30T00:00:01.000Z',
    expireAt: '2027-01-26T00:00:00.000Z',
    userText: '予定を作りたい',
    assistantMessage: '何を進めたいですか？',
    responseSource,
    dialogueRendererTrace,
    outcome: 'revision_pending',
    previewCount: 0,
    debugTraceEvents: [],
  };
}

describe('turn diagnostic explicit response source', () => {
  it('overrides the legacy rules inference with the actually adopted AI source', () => {
    expect(createWeeklyPlanningTurnDiagnosticV2(input('ai')).assistantOutput.responseSource).toBe('ai');
  });

  it('records deterministic fallback even when the outcome name has no fallback suffix', () => {
    const entry = createWeeklyPlanningTurnDiagnosticV2(
      input('deterministic_fallback', rendererTrace),
    );

    expect(entry.assistantOutput.responseSource).toBe('deterministic_fallback');
    expect(entry.diagnostics.fallback).toBe('provider_error');
    expect(entry.diagnostics.dialogueRenderer).toEqual(rendererTrace);
  });

  it('bounds renderer output before persistence', () => {
    const entry = createWeeklyPlanningTurnDiagnosticV2(input('ai', {
      ...rendererTrace,
      response: {
        status: 'rendered',
        reason: null,
        rawResponse: 'x'.repeat(5_000),
        renderedText: 'y'.repeat(3_000),
      },
      decision: {
        branch: 'ai_rendered',
        responseSource: 'ai',
        finalMessage: 'z'.repeat(3_000),
      },
    }));

    expect(entry.diagnostics.dialogueRenderer?.response.rawResponse).toContain('[trace truncated]');
    expect(entry.diagnostics.dialogueRenderer?.response.renderedText).toContain('[trace truncated]');
    expect(entry.diagnostics.dialogueRenderer?.decision.finalMessage).toContain('[trace truncated]');
  });
});
