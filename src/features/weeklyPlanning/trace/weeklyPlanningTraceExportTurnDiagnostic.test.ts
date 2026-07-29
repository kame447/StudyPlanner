import { describe, expect, it } from 'vitest';
import { createWeeklyPlanningTraceExportBundle } from './weeklyPlanningTraceExport';
import type {
  WeeklyPlanningTraceSession,
  WeeklyPlanningTraceTurnDiagnosticEntry,
} from './weeklyPlanningTraceTypes';

const session: WeeklyPlanningTraceSession = {
  id: 'weekly-trace-123e4567-e89b-52d3-a456-426614174000',
  logicalConversationId: 'weekly-conversation-223e4567-e89b-52d3-a456-426614174000',
  userId: 'subject-test',
  status: 'active',
  startedAt: '2026-07-29T00:00:00.000Z',
  lastActivityAt: '2026-07-29T00:00:01.000Z',
  turnCount: 1,
  entryCount: 1,
  hasPreview: false,
  hasApprovalFailure: false,
  hasFallback: false,
  hasError: false,
  appVersion: '0.1.0',
  schemaVersion: 2,
  expireAt: '2027-01-25T00:00:00.000Z',
};

const diagnostic: WeeklyPlanningTraceTurnDiagnosticEntry = {
  id: `${session.id}-00000000`,
  sessionId: session.id,
  logicalConversationId: session.logicalConversationId,
  sequence: 0,
  requestId: 'request-1',
  occurredAt: '2026-07-29T00:00:00.000Z',
  observedAt: '2026-07-29T00:00:01.000Z',
  schemaVersion: 2,
  expireAt: '2027-01-25T00:00:00.000Z',
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
      requests: [{
        attempt: 'initial',
        messages: [{ role: 'user', content: 'actual prompt' }],
        purpose: 'weekly_planning_semantic_normalizer',
        responseFormat: { type: 'json_schema' },
        maxCompletionTokens: 3200,
        requestBytes: 100,
      }],
    },
    rawResponses: [{ attempt: 'initial', text: '{"tasks":[]}' }],
    structuredResults: [{
      attempt: 'initial',
      accepted: true,
      errors: [],
      structuredResult: { tasks: [] },
    }],
    candidateOperations: [],
    error: null,
  },
  parsers: [{
    parser: 'planning_range',
    inputText: '来週、英語を3時間やりたい',
    matchedText: '来週',
    candidateOperation: { operation: 'set_planning_window' },
    accepted: true,
    reason: null,
  }],
  decision: {
    status: 'accepted',
    acceptedOperations: [{
      source: 'ai',
      operation: { operation: 'set_planning_window' },
    }],
    rejectedOperations: [],
    finalOperations: [{ operation: 'set_planning_window' }],
    precedence: 'semantic_canonicalizer',
    reason: null,
    stateDiff: [{ operation: 'set_planning_window' }],
  },
  constraintContext: {
    existingPlanCount: 500,
    scheduleTemplateCount: 20,
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
};

describe('weekly planning trace schema v2 export', () => {
  it('exports one complete turn diagnostic without legacy chunk reconstruction', () => {
    const bundle = createWeeklyPlanningTraceExportBundle(
      session,
      [diagnostic],
      '2026-07-29T01:00:00.000Z',
    );

    expect(bundle.schemaVersion).toBe(2);
    expect(bundle.entries).toEqual([diagnostic]);
    expect(bundle.turnDiagnostics).toEqual([diagnostic]);
    expect(bundle.stableV5DebugStages).toEqual([]);
    expect(bundle.evaluationFixtureCandidate.turns).toEqual([
      { role: 'user', content: '来週、英語を3時間やりたい' },
      { role: 'assistant', content: '条件を整理しました。' },
    ]);
    expect(bundle.roleplayCandidate.turns).toEqual([
      { role: 'user', content: '来週、英語を3時間やりたい' },
      { role: 'assistant', content: '条件を整理しました。' },
    ]);
    expect(JSON.stringify(bundle)).not.toContain('dataChunk');
    expect(JSON.stringify(bundle)).not.toContain('base64_utf8_json_chunk');
  });

  it('keeps raw user, AI request and AI response text in the v2 JSON payload', () => {
    const rawDiagnostic = structuredClone(diagnostic);
    rawDiagnostic.userInput.text = 'person@example.comへ連絡する';
    rawDiagnostic.aiInterpreter.input.userText = 'person@example.comへ連絡する';
    rawDiagnostic.aiInterpreter.input.requests[0].messages = [{
      role: 'user',
      content: 'raw prompt 123e4567-e89b-52d3-a456-426614174000',
    }];
    rawDiagnostic.aiInterpreter.rawResponses = [{
      attempt: 'initial',
      text: 'raw response person@example.com',
    }];

    const bundle = createWeeklyPlanningTraceExportBundle(session, [rawDiagnostic]);
    const output = JSON.stringify(bundle.entries);

    expect(output).toContain('person@example.comへ連絡する');
    expect(output).toContain('raw prompt 123e4567-e89b-52d3-a456-426614174000');
    expect(output).toContain('raw response person@example.com');
  });
});
