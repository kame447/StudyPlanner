import { describe, expect, it, vi } from 'vitest';
import type { WeeklyPlanningTraceApiClient } from './weeklyPlanningTracePrivacyClient';
import { createRemoteWeeklyPlanningTraceRepository } from './weeklyPlanningTraceRemoteRepository';
import type {
  WeeklyPlanningTraceEntry,
  WeeklyPlanningTraceSession,
} from './weeklyPlanningTraceTypes';

const LOCAL_SESSION_ID = 'weekly-trace-09012345678-localkey';
const LOCAL_CONVERSATION_ID = 'weekly-planning-conversation-09012345678-localkey';
const SERVER_SESSION_ID = 'weekly-trace-123e4567-e89b-52d3-a456-426614174000';
const SERVER_CONVERSATION_ID = 'weekly-conversation-223e4567-e89b-52d3-a456-426614174000';
const NOW = '2026-07-21T00:00:00.000Z';

const SESSION: WeeklyPlanningTraceSession = {
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
  schemaVersion: 1,
  expireAt: '2027-01-17T00:00:00.000Z',
};

function entry(sequence: number): WeeklyPlanningTraceEntry {
  return {
    id: `${LOCAL_SESSION_ID}-${String(sequence).padStart(8, '0')}`,
    sessionId: LOCAL_SESSION_ID,
    logicalConversationId: LOCAL_CONVERSATION_ID,
    userId: 'firebase-user-1',
    sequence,
    kind: 'internal_event',
    eventType: 'user_turn_received',
    payload: { planningDayCount: 7 },
    severity: 'info',
    occurredAt: NOW,
    observedAt: NOW,
    schemaVersion: 1,
    expireAt: '2027-01-17T00:00:00.000Z',
  };
}

function client(): WeeklyPlanningTraceApiClient {
  return {
    getPolicyStatus: vi.fn(),
    acceptPolicy: vi.fn(),
    startSession: vi.fn(async () => ({
      sessionId: SERVER_SESSION_ID,
      logicalConversationId: SERVER_CONVERSATION_ID,
    })),
    append: vi.fn(async () => undefined),
    deleteCurrentUserTrace: vi.fn(),
    listAdminSessions: vi.fn(async () => [{
      ...SESSION,
      id: SERVER_SESSION_ID,
      logicalConversationId: SERVER_CONVERSATION_ID,
      userId: undefined,
      subjectAlias: 'subject-abc123',
    }]),
    listAdminEntries: vi.fn(async () => [{
      ...entry(0),
      id: `${SERVER_SESSION_ID}-00000000`,
      sessionId: SERVER_SESSION_ID,
      logicalConversationId: SERVER_CONVERSATION_ID,
      userId: undefined,
      subjectAlias: 'subject-abc123',
    }]),
    archiveAdminSession: vi.fn(async () => undefined),
  };
}

describe('createRemoteWeeklyPlanningTraceRepository', () => {
  it('starts once and removes raw client structural IDs from append payloads', async () => {
    const apiClient = client();
    const repository = createRemoteWeeklyPlanningTraceRepository(apiClient);

    await repository.appendEntries({ session: SESSION, entries: [entry(0)] });
    await repository.appendEntries({
      session: { ...SESSION, entryCount: 2, turnCount: 2 },
      entries: [entry(1)],
    });

    expect(apiClient.startSession).toHaveBeenCalledTimes(1);
    expect(apiClient.startSession).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: LOCAL_SESSION_ID,
      conversationCorrelationKey: LOCAL_CONVERSATION_ID,
    }));
    expect(apiClient.append).toHaveBeenCalledTimes(2);
    const payloads = vi.mocked(apiClient.append).mock.calls.map(([payload]) => payload);
    expect(JSON.stringify(payloads)).not.toContain(LOCAL_SESSION_ID);
    expect(JSON.stringify(payloads)).not.toContain(LOCAL_CONVERSATION_ID);
    expect(payloads).toEqual([
      expect.objectContaining({
        session: expect.objectContaining({
          id: SERVER_SESSION_ID,
          logicalConversationId: SERVER_CONVERSATION_ID,
        }),
        entries: [expect.objectContaining({
          id: `${SERVER_SESSION_ID}-00000000`,
          sessionId: SERVER_SESSION_ID,
          logicalConversationId: SERVER_CONVERSATION_ID,
        })],
      }),
      expect.objectContaining({
        entries: [expect.objectContaining({
          id: `${SERVER_SESSION_ID}-00000001`,
          sessionId: SERVER_SESSION_ID,
          logicalConversationId: SERVER_CONVERSATION_ID,
        })],
      }),
    ]);
    expect(await repository.listSessions('firebase-user-1')).toEqual([]);
    expect(await repository.getSession('firebase-user-1', SERVER_SESSION_ID)).toEqual(
      expect.objectContaining({ id: SERVER_SESSION_ID }),
    );
  });

  it('retries session issuance after a failed start instead of caching the rejection', async () => {
    const apiClient = client();
    vi.mocked(apiClient.startSession)
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({
        sessionId: SERVER_SESSION_ID,
        logicalConversationId: SERVER_CONVERSATION_ID,
      });
    const repository = createRemoteWeeklyPlanningTraceRepository(apiClient);

    await expect(repository.appendEntries({ session: SESSION, entries: [entry(0)] }))
      .rejects.toThrow(/temporary failure/);
    await expect(repository.appendEntries({ session: SESSION, entries: [entry(0)] }))
      .resolves.toBeUndefined();
    expect(apiClient.startSession).toHaveBeenCalledTimes(2);
  });

  it('maps server subject aliases into the legacy admin viewer shape without raw uid', async () => {
    const apiClient = client();
    const repository = createRemoteWeeklyPlanningTraceRepository(apiClient);

    const sessions = await repository.listSessionsForAdmin();
    const entries = await repository.listEntries('ignored', SERVER_SESSION_ID);

    expect(sessions[0]?.userId).toBe('subject-abc123');
    expect(entries[0]?.userId).toBe('subject-abc123');
    expect(JSON.stringify({ sessions, entries })).not.toContain('firebase-user-1');
  });

  it('delegates archive operations to the restricted server endpoint', async () => {
    const apiClient = client();
    const repository = createRemoteWeeklyPlanningTraceRepository(apiClient);

    await repository.archiveSessionForAdmin(SERVER_SESSION_ID, NOW);

    expect(apiClient.archiveAdminSession).toHaveBeenCalledWith(SERVER_SESSION_ID);
  });
});
