import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS,
  measureWeeklyPlanningTraceJsonBytes,
} from '../../../../shared/weeklyPlanningTraceContract';
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

  it('bounds renderer output without consuming the Worker transport headroom', () => {
    const entry = createWeeklyPlanningTurnDiagnosticV2(input('ai', {
      ...rendererTrace,
      request: {
        ...rendererTrace.request!,
        requiredLabels: Array.from({ length: 50 }, (_, index) => `対象${index}${'あ'.repeat(300)}`),
        fallbackText: 'あ'.repeat(10_000),
      },
      response: {
        status: 'rendered',
        reason: null,
        rawResponse: 'あ'.repeat(20_000),
        renderedText: 'あ'.repeat(10_000),
      },
      decision: {
        branch: 'ai_rendered',
        responseSource: 'ai',
        finalMessage: 'あ'.repeat(10_000),
      },
    }));

    expect(entry.diagnostics.dialogueRenderer?.response.rawResponse).toContain('[trace truncated]');
    expect(entry.diagnostics.dialogueRenderer?.response.renderedText).toContain('[trace truncated]');
    expect(entry.diagnostics.dialogueRenderer?.decision.finalMessage).toContain('[trace truncated]');
    expect(JSON.stringify(entry)).not.toContain('\uFFFD');
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes,
    );
  });

  it('keeps an oversized base diagnostic under the client target after source override', () => {
    const large = input('deterministic_fallback');
    large.debugTraceEvents = Array.from({ length: 32 }, (_, sequence) => ({
      schemaVersion: 2 as const,
      sequence,
      stage: 'semantic_provider_response',
      occurredAt: `2026-07-30T00:00:${String(sequence).padStart(2, '0')}.000Z`,
      severity: 'debug' as const,
      data: {
        attempt: `attempt-${sequence}`,
        rawResponse: 'あ'.repeat(10_000),
      },
    }));

    const entry = createWeeklyPlanningTurnDiagnosticV2(large);

    expect(entry.assistantOutput.responseSource).toBe('deterministic_fallback');
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes,
    );
  });
});
