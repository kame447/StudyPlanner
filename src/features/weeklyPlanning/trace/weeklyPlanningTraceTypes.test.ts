import { describe, expect, it } from 'vitest';
import { isWeeklyPlanningTraceEntry } from './weeklyPlanningTraceTypes';

function baseEntry() {
  return {
    id: 'session-1-00000000',
    sessionId: 'session-1',
    logicalConversationId: 'conversation-1',
    userId: 'user-1',
    sequence: 0,
    occurredAt: '2026-07-15T00:00:00.000Z',
    observedAt: '2026-07-15T00:00:00.000Z',
    schemaVersion: 1,
    expireAt: '2026-10-13T00:00:00.000Z',
  };
}

function turnDiagnostic(overrides: Record<string, unknown> = {}) {
  return {
    ...baseEntry(),
    userId: undefined,
    schemaVersion: 2,
    kind: 'turn_diagnostic',
    traceSchema: 'weekly-planning-turn-diagnostic-v2',
    turnIndex: 0,
    userInput: { text: '来週、英語を3時間やりたい' },
    aiInterpreter: {
      provider: 'openai',
      model: 'gpt-test',
      promptVersion: 'v5',
      input: {
        userText: '来週、英語を3時間やりたい',
        conversationContext: [],
        planningStateSummary: { taskCount: 0 },
        requests: [],
      },
      rawResponses: [],
      structuredResults: [],
      candidateOperations: [],
      error: null,
    },
    parsers: [],
    decision: {
      status: 'accepted',
      acceptedOperations: [],
      rejectedOperations: [],
      finalOperations: [],
      precedence: null,
      reason: null,
      stateDiff: null,
    },
    constraintContext: {
      existingPlanCount: 0,
      scheduleTemplateCount: 0,
      relevantBusyIntervals: [],
    },
    assistantOutput: {
      text: '条件を整理しました。',
      responseSource: 'ai',
    },
    diagnostics: {
      durationMs: 100,
      fallback: null,
      error: null,
      outcome: 'revision_pending',
      previewCount: 0,
      stale: false,
    },
    ...overrides,
  };
}

describe('isWeeklyPlanningTraceEntry', () => {
  it('有限catalogにないevent typeをsafe discardする', () => {
    expect(isWeeklyPlanningTraceEntry({
      ...baseEntry(),
      kind: 'internal_event',
      eventType: 'unknown_event',
      payload: {},
      severity: 'info',
    })).toBe(false);
  });

  it('有限catalogにあるevent typeを受理する', () => {
    expect(isWeeklyPlanningTraceEntry({
      ...baseEntry(),
      kind: 'internal_event',
      eventType: 'preview_rejected_stale',
      payload: { previewId: 'preview-1' },
      severity: 'warn',
    })).toBe(true);
  });

  it('legacy Stable V5 debug stage eventを受理する', () => {
    expect(isWeeklyPlanningTraceEntry({
      ...baseEntry(),
      kind: 'internal_event',
      eventType: 'stable_v5_debug_stage',
      payload: {
        debugSchemaVersion: 1,
        debugSequence: 0,
        stage: 'semantic_provider_request',
        stageOccurredAt: '2026-07-27T00:00:00.000Z',
        data: {
          request: {
            messages: [{ role: 'system', content: 'full prompt' }],
          },
        },
      },
      severity: 'debug',
    })).toBe(true);
  });

  it('schema v2の1ターン診断recordを受理する', () => {
    expect(isWeeklyPlanningTraceEntry(turnDiagnostic())).toBe(true);
  });

  it('schema v2でAI request配列が欠けたrecordをsafe discardする', () => {
    const entry = turnDiagnostic();
    const ai = entry.aiInterpreter as Record<string, unknown>;
    ai.input = {
      userText: '来週、英語を3時間やりたい',
      conversationContext: [],
      planningStateSummary: {},
    };
    expect(isWeeklyPlanningTraceEntry(entry)).toBe(false);
  });

  it('不正なsnapshot reasonをsafe discardする', () => {
    expect(isWeeklyPlanningTraceEntry({
      ...baseEntry(),
      kind: 'state_snapshot',
      snapshotReason: 'unknown_reason',
      state: {},
    })).toBe(false);
  });

  it('payload欠落eventをsafe discardする', () => {
    expect(isWeeklyPlanningTraceEntry({
      ...baseEntry(),
      kind: 'internal_event',
      eventType: 'preview_generated',
      severity: 'info',
    })).toBe(false);
  });

  it('state欠落snapshotをsafe discardする', () => {
    expect(isWeeklyPlanningTraceEntry({
      ...baseEntry(),
      kind: 'state_snapshot',
      snapshotReason: 'turn_completed',
    })).toBe(false);
  });

  it('assistant turnではresponse sourceを必須にする', () => {
    expect(isWeeklyPlanningTraceEntry({
      ...baseEntry(),
      kind: 'turn',
      role: 'assistant',
      content: '応答',
      turnIndex: 0,
    })).toBe(false);
  });
});
