import { describe, expect, it, vi } from 'vitest';
import type { WeeklyPlanningTraceApiClient } from './weeklyPlanningTracePrivacyClient';
import { createRemoteWeeklyPlanningTraceRepository } from './weeklyPlanningTraceRemoteRepository';
import type {
  WeeklyPlanningTraceEntry,
  WeeklyPlanningTraceSession,
} from './weeklyPlanningTraceTypes';

const SESSION: WeeklyPlanningTraceSession = {
  id: 'session-1',
  logicalConversationId: 'conversation-1',
  userId: 'firebase-user-1',
  status: 'active',
  startedAt: '2026-07-18T00:00:00.000Z',
  lastActivityAt: '2026-07-18T00:00:01.000Z',
  turnCount: 1,
  entryCount: 1,
  hasPreview: false,
  hasApprovalFailure: false,
  hasFallback: false,
  hasError: false,
  appVersion: 'test',
  schemaVersion: 1,
  expireAt: '2027-01-14T00:00:00.000Z',
};

const ENTRY: WeeklyPlanningTraceEntry = {
  id: 'entry-1',
  sessionId: 'session-1',
  logicalConversationId: 'conversation-1',
  userId: 'firebase-user-1',
  sequence: 1,
  kind: 'internal_event',
  eventType: 'user_turn_received',
  payload: { planningDayCount: 7 },
  severity: 'info',
  occurredAt: '2026-07-18T00:00:01.000Z',
  observedAt: '2026-07-18T00:00:01.000Z',
  schemaVersion: 1,
  expireAt: '2027-01-14T00:00:00.000Z',
};

function client(): WeeklyPlanningTraceApiClient {
  return {
    getPolicyStatus: vi.fn(),
    acceptPolicy: vi.fn(),
    append: vi.fn(async () => undefined),
    deleteCurrentUserTrace: vi.fn(),
    listAdminSessions: vi.fn(async () => [{
      ...SESSION,
      userId: undefined,
      subjectAlias: 'subject-abc123',
    }]),
    listAdminEntries: vi.fn(async () => [{
      ...ENTRY,
      userId: undefined,
      subjectAlias: 'subject-abc123',
    }]),
    archiveAdminSession: vi.fn(async () => undefined),
  };
}

describe('createRemoteWeeklyPlanningTraceRepository', () => {
  it('sends session and entries to the server API and never exposes normal-user reads', async () => {
    const apiClient = client();
    const repository = createRemoteWeeklyPlanningTraceRepository(apiClient);

    await repository.appendEntries({ session: SESSION, entries: [ENTRY] });

    expect(apiClient.append).toHaveBeenCalledWith({ session: SESSION, entries: [ENTRY] });
    expect(await repository.listSessions('firebase-user-1')).toEqual([]);
    expect(await repository.getSession('firebase-user-1', 'session-1')).toEqual(SESSION);
  });

  it('maps server subject aliases into the legacy admin viewer shape without raw uid', async () => {
    const apiClient = client();
    const repository = createRemoteWeeklyPlanningTraceRepository(apiClient);

    const sessions = await repository.listSessionsForAdmin();
    const entries = await repository.listEntries('ignored', 'session-1');

    expect(sessions[0]?.userId).toBe('subject-abc123');
    expect(entries[0]?.userId).toBe('subject-abc123');
    expect(JSON.stringify({ sessions, entries })).not.toContain('firebase-user-1');
  });

  it('delegates archive operations to the restricted server endpoint', async () => {
    const apiClient = client();
    const repository = createRemoteWeeklyPlanningTraceRepository(apiClient);

    await repository.archiveSessionForAdmin('session-1', '2026-07-18T01:00:00.000Z');

    expect(apiClient.archiveAdminSession).toHaveBeenCalledWith('session-1');
  });
});
