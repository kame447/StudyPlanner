import { describe, expect, it } from 'vitest';
import { createInMemoryWeeklyPlanningTraceRepository } from './weeklyPlanningTraceInMemoryRepository';
import type {
  WeeklyPlanningTraceEntry,
  WeeklyPlanningTraceSession,
} from './weeklyPlanningTraceTypes';

const SESSION: WeeklyPlanningTraceSession = {
  id: 'session-1',
  logicalConversationId: 'conversation-1',
  userId: 'user-1',
  status: 'active',
  startedAt: '2026-07-15T00:00:00.000Z',
  lastActivityAt: '2026-07-15T00:00:02.000Z',
  turnCount: 1,
  entryCount: 2,
  hasPreview: false,
  hasApprovalFailure: false,
  hasFallback: false,
  hasError: false,
  appVersion: 'test',
  schemaVersion: 1,
  expireAt: '2026-10-13T00:00:00.000Z',
};

const ENTRIES: WeeklyPlanningTraceEntry[] = [
  {
    id: 'session-1-00000001',
    sessionId: 'session-1',
    logicalConversationId: 'conversation-1',
    userId: 'user-1',
    sequence: 1,
    kind: 'internal_event',
    eventType: 'user_turn_received',
    payload: { planningDayCount: 7 },
    severity: 'info',
    occurredAt: '2026-07-15T00:00:01.000Z',
    observedAt: '2026-07-15T00:00:01.000Z',
    schemaVersion: 1,
    expireAt: '2026-10-13T00:00:00.000Z',
  },
  {
    id: 'session-1-00000000',
    sessionId: 'session-1',
    logicalConversationId: 'conversation-1',
    userId: 'user-1',
    sequence: 0,
    kind: 'turn',
    role: 'user',
    content: '来週の予定を作りたい',
    turnIndex: 0,
    occurredAt: '2026-07-15T00:00:00.000Z',
    observedAt: '2026-07-15T00:00:00.000Z',
    schemaVersion: 1,
    expireAt: '2026-10-13T00:00:00.000Z',
  },
];

describe('createInMemoryWeeklyPlanningTraceRepository', () => {
  it('entryをsequence順で返し、他userからは参照できない', async () => {
    const repository = createInMemoryWeeklyPlanningTraceRepository();

    await repository.appendEntries({ session: SESSION, entries: ENTRIES });

    expect((await repository.listEntries('user-1', 'session-1')).map((entry) => entry.sequence))
      .toEqual([0, 1]);
    expect(await repository.getSession('user-2', 'session-1')).toBeNull();
    expect(await repository.listEntries('user-2', 'session-1')).toEqual([]);
  });

  it('同一内容のretryは冪等で、異なる内容の上書きを拒否する', async () => {
    const repository = createInMemoryWeeklyPlanningTraceRepository();

    await repository.appendEntries({ session: SESSION, entries: ENTRIES });
    await repository.appendEntries({ session: SESSION, entries: ENTRIES });
    expect(await repository.listEntries('user-1', 'session-1')).toHaveLength(2);

    const conflictingEntry: WeeklyPlanningTraceEntry = {
      ...ENTRIES[0],
      kind: 'internal_event',
      eventType: 'fallback_used',
      payload: { category: 'conflict' },
      severity: 'warn',
    };
    await expect(repository.appendEntries({ session: SESSION, entries: [conflictingEntry] }))
      .rejects.toThrow('append-only trace entry conflict');
  });

  it('sessionとentryのownership不一致を拒否する', async () => {
    const repository = createInMemoryWeeklyPlanningTraceRepository();
    const foreignEntry: WeeklyPlanningTraceEntry = {
      ...ENTRIES[0],
      userId: 'user-2',
    };

    await expect(repository.appendEntries({ session: SESSION, entries: [foreignEntry] }))
      .rejects.toThrow('trace ownership mismatch');
  });
});
