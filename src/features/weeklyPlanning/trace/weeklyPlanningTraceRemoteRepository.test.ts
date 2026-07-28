import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS,
  measureWeeklyPlanningTraceJsonBytes,
} from '../../../../shared/weeklyPlanningTraceContract';
import {
  createMemoryStorageHarness,
  installWeeklyPlanningTestStorage,
} from '../testUtils/weeklyPlanningApplicationTestHarness';
import type { WeeklyPlanningTraceApiClient } from './weeklyPlanningTracePrivacyClient';
import { createRemoteWeeklyPlanningTraceRepository } from './weeklyPlanningTraceRemoteRepository';
import type {
  WeeklyPlanningTraceInternalEventEntry,
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
  planningRangeStart: '2026-07-21',
  planningRangeEnd: '2026-07-27T24:00:00',
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

function entry(sequence: number): WeeklyPlanningTraceInternalEventEntry {
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

function debugEntry(
  sequence: number,
  dataChunkLength = 3_600,
): WeeklyPlanningTraceInternalEventEntry {
  return {
    ...entry(sequence),
    eventType: 'stable_v5_debug_stage',
    payload: {
      storage: 'base64_utf8_json_chunk',
      debugSchemaVersion: 1,
      debugSequence: sequence,
      stage: 'runtime_turn_input',
      stageOccurredAt: NOW,
      chunkIndex: 0,
      chunkCount: 1,
      totalSerializedBytes: 2_700,
      chunkBytes: 2_700,
      dataChunk: 'A'.repeat(dataChunkLength),
    },
    severity: 'debug',
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
  let restoreWindow: (() => void) | null = null;

  beforeEach(() => {
    const storage = createMemoryStorageHarness();
    restoreWindow = installWeeklyPlanningTestStorage(storage.storage);
  });

  afterEach(() => {
    restoreWindow?.();
    restoreWindow = null;
  });

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
      session: expect.objectContaining({
        planningRangeStart: '2026-07-21',
        planningRangeEnd: '2026-07-27T24:00:00',
      }),
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
          planningRangeStart: '2026-07-21',
          planningRangeEnd: '2026-07-27T24:00:00',
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

  it('reuses the same server handle after the repository is recreated', async () => {
    const apiClient = client();
    const firstRepository = createRemoteWeeklyPlanningTraceRepository(apiClient);

    await firstRepository.appendEntries({ session: SESSION, entries: [entry(0)] });
    const secondRepository = createRemoteWeeklyPlanningTraceRepository(apiClient);
    await secondRepository.appendEntries({
      session: { ...SESSION, entryCount: 2, turnCount: 2 },
      entries: [entry(1)],
    });

    expect(apiClient.startSession).toHaveBeenCalledTimes(1);
    expect(apiClient.append).toHaveBeenCalledTimes(2);
    const secondPayload = vi.mocked(apiClient.append).mock.calls[1]?.[0];
    expect(secondPayload).toEqual(expect.objectContaining({
      session: expect.objectContaining({ id: SERVER_SESSION_ID }),
      entries: [expect.objectContaining({
        id: `${SERVER_SESSION_ID}-00000001`,
        sessionId: SERVER_SESSION_ID,
      })],
    }));
  });

  it('keeps the issued server handle after both transient append attempts fail', async () => {
    const apiClient = client();
    vi.mocked(apiClient.append)
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce(undefined);
    const firstRepository = createRemoteWeeklyPlanningTraceRepository(apiClient);

    await expect(firstRepository.appendEntries({ session: SESSION, entries: [entry(0)] }))
      .rejects.toThrow(/temporary network failure/);

    const secondRepository = createRemoteWeeklyPlanningTraceRepository(apiClient);
    await secondRepository.appendEntries({ session: SESSION, entries: [entry(0)] });

    expect(apiClient.startSession).toHaveBeenCalledTimes(1);
    expect(apiClient.append).toHaveBeenCalledTimes(3);
    expect(vi.mocked(apiClient.append).mock.calls[2]?.[0])
      .toEqual(vi.mocked(apiClient.append).mock.calls[0]?.[0]);
  });

  it('splits more than one hundred entries into monotonic append batches', async () => {
    const apiClient = client();
    const repository = createRemoteWeeklyPlanningTraceRepository(apiClient);
    const entries = Array.from({ length: 205 }, (_, sequence) => entry(sequence));

    await repository.appendEntries({
      session: { ...SESSION, turnCount: 0, entryCount: entries.length },
      entries,
    });

    const payloads = vi.mocked(apiClient.append).mock.calls.map(([payload]) => payload);
    expect(payloads).toHaveLength(3);
    expect(payloads.map((payload) => payload.entries.length)).toEqual([100, 100, 5]);
    expect(payloads.map((payload) => payload.session.entryCount)).toEqual([100, 200, 205]);
    payloads.forEach((payload) => {
      expect(payload.entries.length).toBeLessThanOrEqual(
        WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxEntriesPerRequest,
      );
      expect(measureWeeklyPlanningTraceJsonBytes(payload)).toBeLessThanOrEqual(
        WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxRequestBodyBytes,
      );
    });
  });

  it('splits a sub-100-entry debug payload by serialized request bytes', async () => {
    const apiClient = client();
    const repository = createRemoteWeeklyPlanningTraceRepository(apiClient);
    const entries = Array.from({ length: 95 }, (_, sequence) => debugEntry(sequence, 3_900));

    await repository.appendEntries({
      session: { ...SESSION, turnCount: 0, entryCount: entries.length },
      entries,
    });

    const payloads = vi.mocked(apiClient.append).mock.calls.map(([payload]) => payload);
    expect(payloads.length).toBeGreaterThan(1);
    expect(payloads.reduce((sum, payload) => sum + payload.entries.length, 0)).toBe(95);
    payloads.forEach((payload) => {
      expect(payload.entries.length).toBeLessThan(100);
      expect(measureWeeklyPlanningTraceJsonBytes(payload)).toBeLessThanOrEqual(
        WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxRequestBodyBytes,
      );
    });
    expect(payloads.map((payload) => payload.session.entryCount))
      .toEqual([...payloads.map((payload) => payload.session.entryCount)].sort((a, b) => a - b));
    expect(payloads[payloads.length - 1]?.session.entryCount).toBe(95);
  });

  it('refreshes a stale persisted server handle and retries append once', async () => {
    const apiClient = client();
    const firstRepository = createRemoteWeeklyPlanningTraceRepository(apiClient);
    await firstRepository.appendEntries({ session: SESSION, entries: [entry(0)] });

    vi.mocked(apiClient.append)
      .mockRejectedValueOnce(new Error('stale server handle'))
      .mockResolvedValueOnce(undefined);
    const secondRepository = createRemoteWeeklyPlanningTraceRepository(apiClient);
    await secondRepository.appendEntries({
      session: { ...SESSION, entryCount: 2, turnCount: 2 },
      entries: [entry(1)],
    });

    expect(apiClient.startSession).toHaveBeenCalledTimes(2);
    expect(apiClient.append).toHaveBeenCalledTimes(3);
  });

  it('retries a transient append failure with the same canonical handle', async () => {
    const apiClient = client();
    vi.mocked(apiClient.append)
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce(undefined);
    const repository = createRemoteWeeklyPlanningTraceRepository(apiClient);

    await repository.appendEntries({ session: SESSION, entries: [entry(0)] });

    expect(apiClient.startSession).toHaveBeenCalledTimes(1);
    expect(apiClient.append).toHaveBeenCalledTimes(2);
    const payloads = vi.mocked(apiClient.append).mock.calls.map(([payload]) => payload);
    expect(payloads[1]).toEqual(payloads[0]);
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
    expect(sessions[0]).toMatchObject({
      planningRangeStart: '2026-07-21',
      planningRangeEnd: '2026-07-27T24:00:00',
    });
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