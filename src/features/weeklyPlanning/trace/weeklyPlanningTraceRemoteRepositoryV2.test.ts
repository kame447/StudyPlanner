import { describe, expect, it, vi } from 'vitest';
import type { WeeklyPlanningTraceApiClient } from './weeklyPlanningTracePrivacyClient';
import { createRemoteWeeklyPlanningTraceRepository } from './weeklyPlanningTraceRemoteRepository';
import type {
  WeeklyPlanningTraceSession,
  WeeklyPlanningTraceTurnDiagnosticEntry,
} from './weeklyPlanningTraceTypes';

const LOCAL_SESSION_ID = 'weekly-trace-stable-v5-123e4567-e89b-52d3-a456-426614174000';
const LOCAL_CONVERSATION_ID = 'weekly-planning-conversation-123e4567-e89b-52d3-a456-426614174000';
const SERVER_SESSION_ID = 'weekly-trace-223e4567-e89b-52d3-a456-426614174000';
const SERVER_CONVERSATION_ID = 'weekly-conversation-323e4567-e89b-52d3-a456-426614174000';
const NOW = '2026-07-29T00:00:00.000Z';

const session: WeeklyPlanningTraceSession = {
  id: LOCAL_SESSION_ID,
  logicalConversationId: LOCAL_CONVERSATION_ID,
  userId: 'firebase-user-1',
  status: 'active',
  startedAt: NOW,
  lastActivityAt: NOW,
  turnCount: 1,
  entryCount: 1,
  hasPreview: false,
  hasApprovalFailure: false,
  hasFallback: false,
  hasError: false,
  appVersion: 'test',
  schemaVersion: 2,
  expireAt: '2027-01-25T00:00:00.000Z',
};

function diagnostic(): WeeklyPlanningTraceTurnDiagnosticEntry {
  return {
    id: `${LOCAL_SESSION_ID}-00000000`,
    sessionId: LOCAL_SESSION_ID,
    logicalConversationId: LOCAL_CONVERSATION_ID,
    sequence: 0,
    requestId: 'request-1',
    occurredAt: NOW,
    observedAt: NOW,
    schemaVersion: 2,
    expireAt: '2027-01-25T00:00:00.000Z',
    kind: 'turn_diagnostic',
    traceSchema: 'weekly-planning-turn-diagnostic-v2',
    turnIndex: 0,
    userInput: { text: '予定を立てたい' },
    aiInterpreter: {
      provider: 'openai',
      model: 'gpt-test',
      promptVersion: 'v5',
      input: {
        userText: '予定を立てたい',
        conversationContext: [],
        planningStateSummary: {},
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
      text: '条件を教えてください。',
      responseSource: 'ai',
    },
    diagnostics: {
      durationMs: 10,
      fallback: null,
      error: null,
      outcome: 'revision_pending',
      previewCount: 0,
      stale: false,
    },
  };
}

function client(): WeeklyPlanningTraceApiClient {
  const remoteEntry = {
    ...diagnostic(),
    id: `${SERVER_SESSION_ID}-00000000`,
    sessionId: SERVER_SESSION_ID,
    logicalConversationId: SERVER_CONVERSATION_ID,
    subjectAlias: 'subject-abc123',
  };
  return {
    getPolicyStatus: vi.fn(),
    acceptPolicy: vi.fn(),
    startSession: vi.fn(async () => ({
      sessionId: SERVER_SESSION_ID,
      logicalConversationId: SERVER_CONVERSATION_ID,
    })),
    append: vi.fn(async () => undefined),
    deleteCurrentUserTrace: vi.fn(),
    listAdminSessions: vi.fn(async () => []),
    listAdminEntries: vi.fn(async () => [remoteEntry]),
    archiveAdminSession: vi.fn(async () => undefined),
  };
}

describe('remote weekly planning trace repository schema v2', () => {
  it('counts a turn diagnostic as one logical turn in append metadata', async () => {
    const apiClient = client();
    const repository = createRemoteWeeklyPlanningTraceRepository(apiClient);

    await repository.appendEntries({ session, entries: [diagnostic()] });

    const payload = vi.mocked(apiClient.append).mock.calls[0]?.[0];
    expect(payload?.session).toMatchObject({
      entryCount: 1,
      turnCount: 1,
      schemaVersion: 2,
    });
    expect(payload?.entries).toHaveLength(1);
  });

  it('does not map the session subject alias into the v2 entry userId field', async () => {
    const apiClient = client();
    const repository = createRemoteWeeklyPlanningTraceRepository(apiClient);

    const entries = await repository.listEntries('ignored', SERVER_SESSION_ID);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe('turn_diagnostic');
    expect(entries[0]?.userId).toBeUndefined();
  });
});
