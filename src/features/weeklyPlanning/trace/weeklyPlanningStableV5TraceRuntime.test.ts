import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setWeeklyPlanningTraceRepositoryForTests,
} from './weeklyPlanningTraceRepository';
import type {
  WeeklyPlanningTraceEntry,
  WeeklyPlanningTraceRepository,
  WeeklyPlanningTraceSession,
} from './weeklyPlanningTraceTypes';
import {
  recordWeeklyPlanningStableV5TurnTrace,
  resetWeeklyPlanningStableV5TraceRuntimeForTest,
} from './weeklyPlanningStableV5TraceRuntime';

function createRepositoryHarness() {
  const writes: Array<{
    session: WeeklyPlanningTraceSession;
    entries: WeeklyPlanningTraceEntry[];
  }> = [];
  const sessions = new Map<string, WeeklyPlanningTraceSession>();
  const entries = new Map<string, WeeklyPlanningTraceEntry>();
  const repository: WeeklyPlanningTraceRepository = {
    async upsertSession(session) {
      sessions.set(session.id, structuredClone(session));
    },
    async appendEntries(params) {
      const session = structuredClone(params.session);
      const appended = structuredClone(params.entries);
      writes.push({ session, entries: appended });
      sessions.set(session.id, session);
      appended.forEach((entry) => entries.set(entry.id, entry));
    },
    async listSessions(userId) {
      return Array.from(sessions.values()).filter((session) => session.userId === userId);
    },
    async listSessionsForAdmin() {
      return Array.from(sessions.values());
    },
    async archiveSessionForAdmin() {},
    async getSession(userId, sessionId) {
      const session = sessions.get(sessionId);
      return session?.userId === userId ? structuredClone(session) : null;
    },
    async listEntries(userId, sessionId) {
      return Array.from(entries.values())
        .filter((entry) => entry.userId === userId && entry.sessionId === sessionId)
        .sort((left, right) => left.sequence - right.sequence);
    },
  };
  return { repository, writes, sessions, entries };
}

function traceInput(requestId: string) {
  return {
    userId: 'owner-1',
    conversationId: 'conversation-1',
    requestId,
    userText: '予定を立てたい',
    assistantMessage: '条件を教えてください。',
    outcome: 'revision_pending',
    graphRevision: 1,
    graphSummary: { taskCount: 1 },
    compatibilityState: { status: 'revision_pending' },
    previewCount: 0,
  } as const;
}

describe('Stable V5 trace runtime', () => {
  beforeEach(() => {
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    if (typeof window !== 'undefined') window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    setWeeklyPlanningTraceRepositoryForTests(undefined);
    if (typeof window !== 'undefined') window.localStorage.clear();
  });

  it('records user, assistant, structured interpretation, preview and snapshot', async () => {
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);

    await recordWeeklyPlanningStableV5TurnTrace({
      userId: 'owner-1',
      conversationId: 'conversation-1',
      requestId: 'request-1',
      userText: '今日の予定を立てたいです',
      assistantMessage: '1件の仮予定候補を作りました。',
      outcome: 'preview_ready',
      graphRevision: 2,
      graphSummary: {
        taskCount: 1,
        workloadCount: 1,
        activeFactCount: 2,
      },
      compatibilityState: { status: 'draft_ready' },
      previewCount: 1,
      planningRangeStart: '2026-07-23',
      planningRangeEnd: '2026-07-23',
    });

    expect(harness.writes).toHaveLength(1);
    const write = harness.writes[0];
    expect(write.session).toMatchObject({
      logicalConversationId: 'conversation-1',
      userId: 'owner-1',
      hasPreview: true,
      hasError: false,
      planningRangeStart: '2026-07-23',
      planningRangeEnd: '2026-07-23',
    });
    expect(write.entries.filter((entry) => entry.kind === 'turn')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: '今日の予定を立てたいです' }),
        expect.objectContaining({ role: 'assistant', content: '1件の仮予定候補を作りました。' }),
      ]),
    );
    expect(write.entries.filter((entry) => entry.kind === 'internal_event')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: 'interpreter_completed' }),
        expect.objectContaining({ eventType: 'dialogue_planned' }),
        expect.objectContaining({ eventType: 'preview_generated' }),
      ]),
    );
    expect(write.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'state_snapshot',
        snapshotReason: 'preview_generated',
        stateRevision: 2,
      }),
    ]));
  });

  it('deduplicates retries with the same request id', async () => {
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const input = traceInput('request-1');

    await recordWeeklyPlanningStableV5TurnTrace(input);
    await recordWeeklyPlanningStableV5TurnTrace(input);

    expect(harness.writes).toHaveLength(1);
  });

  it('continues the same physical trace session after runtime memory is lost', async () => {
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);

    await recordWeeklyPlanningStableV5TurnTrace(traceInput('request-1'));
    const firstWrite = harness.writes[0];
    resetWeeklyPlanningStableV5TraceRuntimeForTest();

    await recordWeeklyPlanningStableV5TurnTrace(traceInput('request-2'));
    const secondWrite = harness.writes[1];

    expect(secondWrite.session.id).toBe(firstWrite.session.id);
    expect(secondWrite.session.logicalConversationId).toBe('conversation-1');
    expect(secondWrite.entries[0].sequence).toBe(firstWrite.session.entryCount);
    expect(secondWrite.entries.filter((entry) => entry.kind === 'turn')).toEqual([
      expect.objectContaining({ role: 'user', turnIndex: firstWrite.session.turnCount }),
      expect.objectContaining({ role: 'assistant', turnIndex: firstWrite.session.turnCount + 1 }),
    ]);
    expect(secondWrite.session.entryCount).toBe(
      firstWrite.session.entryCount + secondWrite.entries.length,
    );
  });

  it('does not split an unchanged conversation after thirty minutes of inactivity', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-23T08:00:00.000Z'));
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);

    await recordWeeklyPlanningStableV5TurnTrace(traceInput('request-1'));
    const firstSessionId = harness.writes[0].session.id;
    vi.setSystemTime(new Date('2026-07-23T09:00:00.000Z'));

    await recordWeeklyPlanningStableV5TurnTrace(traceInput('request-2'));

    expect(harness.writes[1].session.id).toBe(firstSessionId);
    expect(harness.sessions).toHaveLength(1);
  });

  it('uses a different trace session after the logical conversation changes', async () => {
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);

    await recordWeeklyPlanningStableV5TurnTrace(traceInput('request-1'));
    await recordWeeklyPlanningStableV5TurnTrace({
      ...traceInput('request-2'),
      conversationId: 'conversation-2',
    });

    expect(harness.writes[1].session.id).not.toBe(harness.writes[0].session.id);
  });

  it('marks failed Stable V5 turns without storing raw error details', async () => {
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);

    await recordWeeklyPlanningStableV5TurnTrace({
      userId: 'owner-1',
      conversationId: 'conversation-1',
      requestId: 'request-failed',
      userText: '予定を立てたい',
      assistantMessage: '週間計画の会話状態を更新できませんでした。',
      outcome: 'failed',
      graphRevision: 0,
      graphSummary: {},
      previewCount: 0,
      errorCode: 'TypeError',
    });

    expect(harness.writes[0].session.hasError).toBe(true);
    const completed = harness.writes[0].entries.find(
      (entry) => entry.kind === 'internal_event'
        && entry.eventType === 'interpreter_completed',
    );
    expect(completed).toMatchObject({
      severity: 'error',
      payload: expect.objectContaining({ errorCode: 'TypeError' }),
    });
    expect(JSON.stringify(completed)).not.toContain('stack');
  });
});
