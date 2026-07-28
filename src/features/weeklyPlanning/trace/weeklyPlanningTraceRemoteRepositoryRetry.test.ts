import { describe, expect, it, vi } from 'vitest';
import {
  WeeklyPlanningTraceApiError,
  type WeeklyPlanningTraceApiClient,
} from './weeklyPlanningTracePrivacyClient';
import { createRemoteWeeklyPlanningTraceRepository } from './weeklyPlanningTraceRemoteRepository';
import type {
  WeeklyPlanningTraceInternalEventEntry,
  WeeklyPlanningTraceSession,
} from './weeklyPlanningTraceTypes';

const SESSION_ID = 'weekly-trace-stable-v5-09012345678-client';
const CONVERSATION_ID = 'weekly-planning-conversation-09012345678-client';
const SERVER_SESSION_ID = 'weekly-trace-123e4567-e89b-52d3-a456-426614174000';
const SERVER_CONVERSATION_ID = 'weekly-conversation-223e4567-e89b-52d3-a456-426614174000';
const NOW = '2026-07-28T00:00:00.000Z';

const session: WeeklyPlanningTraceSession = {
  id: SESSION_ID,
  logicalConversationId: CONVERSATION_ID,
  userId: 'user-1',
  status: 'active',
  startedAt: NOW,
  lastActivityAt: NOW,
  turnCount: 0,
  entryCount: 1,
  hasPreview: false,
  hasApprovalFailure: false,
  hasFallback: false,
  hasError: false,
  appVersion: 'test',
  schemaVersion: 1,
  expireAt: '2027-01-24T00:00:00.000Z',
};

const entry: WeeklyPlanningTraceInternalEventEntry = {
  id: `${SESSION_ID}-00000000`,
  sessionId: SESSION_ID,
  logicalConversationId: CONVERSATION_ID,
  userId: 'user-1',
  sequence: 0,
  kind: 'internal_event',
  eventType: 'user_turn_received',
  payload: {},
  severity: 'info',
  occurredAt: NOW,
  observedAt: NOW,
  schemaVersion: 1,
  expireAt: '2027-01-24T00:00:00.000Z',
};

function client(): WeeklyPlanningTraceApiClient {
  return {
    getHealth: vi.fn(async () => ({
      contractVersion: '2026-07-28-v2',
      workerRevision: 'test',
      storageLayoutVersion: 2,
    })),
    getPolicyStatus: vi.fn(),
    acceptPolicy: vi.fn(),
    startSession: vi.fn(async () => ({
      sessionId: SERVER_SESSION_ID,
      logicalConversationId: SERVER_CONVERSATION_ID,
    })),
    append: vi.fn(async () => undefined),
    deleteCurrentUserTrace: vi.fn(),
    listAdminSessions: vi.fn(async () => ({ sessions: [], rawCount: 0 })),
    listAdminEntries: vi.fn(async () => []),
    archiveAdminSession: vi.fn(async () => undefined),
  };
}

function apiError(params: {
  code: string;
  category: 'validation' | 'network';
  retryable: boolean;
}) {
  return new WeeklyPlanningTraceApiError('failed', {
    stage: 'append',
    status: params.category === 'validation' ? 400 : null,
    code: params.code,
    category: params.category,
    correlationId: 'correlation-1',
    retryable: params.retryable,
  });
}

describe('remote trace compatibility and retry policy', () => {
  it('Worker compatibilityをsession作成前に確認する', async () => {
    const apiClient = client();
    const repository = createRemoteWeeklyPlanningTraceRepository(apiClient);

    await repository.appendEntries({ session, entries: [entry] });

    expect(apiClient.getHealth).toHaveBeenCalledTimes(1);
    expect(vi.mocked(apiClient.getHealth!).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(apiClient.startSession).mock.invocationCallOrder[0]!);
  });

  it('validation errorを再送しない', async () => {
    const apiClient = client();
    vi.mocked(apiClient.append).mockRejectedValue(
      apiError({ code: 'trace_validation_failed', category: 'validation', retryable: false }),
    );
    const repository = createRemoteWeeklyPlanningTraceRepository(apiClient);

    await expect(repository.appendEntries({ session, entries: [entry] })).rejects.toThrow('failed');
    expect(apiClient.append).toHaveBeenCalledTimes(1);
  });

  it('network errorだけを同一payloadで一度再送する', async () => {
    const apiClient = client();
    vi.mocked(apiClient.append)
      .mockRejectedValueOnce(apiError({
        code: 'trace_network_failure',
        category: 'network',
        retryable: true,
      }))
      .mockResolvedValueOnce(undefined);
    const repository = createRemoteWeeklyPlanningTraceRepository(apiClient);

    await repository.appendEntries({ session, entries: [entry] });

    expect(apiClient.append).toHaveBeenCalledTimes(2);
    expect(vi.mocked(apiClient.append).mock.calls[1]?.[0])
      .toEqual(vi.mocked(apiClient.append).mock.calls[0]?.[0]);
  });
});
