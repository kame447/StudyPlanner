import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningTurnDiagnosticV2,
  type CreateWeeklyPlanningTurnDiagnosticV2WithResponseSourceInput,
} from './weeklyPlanningTurnDiagnosticV2ResponseSource';

function input(
  responseSource: 'ai' | 'deterministic_fallback',
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
    expect(
      createWeeklyPlanningTurnDiagnosticV2(input('deterministic_fallback')).assistantOutput.responseSource,
    ).toBe('deterministic_fallback');
  });
});
