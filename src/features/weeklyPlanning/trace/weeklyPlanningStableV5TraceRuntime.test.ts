import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  const repository: WeeklyPlanningTraceRepository = {
    async upsertSession() {},
    async appendEntries(params) {
      writes.push({
        session: structuredClone(params.session),
        entries: structuredClone(params.entries),
      });
    },
    async listSessions() { return []; },
    async listSessionsForAdmin() { return []; },
    async archiveSessionForAdmin() {},
    async getSession() { return null; },
    async listEntries() { return []; },
  };
  return { repository, writes };
}

describe('Stable V5 trace runtime', () => {
  beforeEach(() => {
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
  });

  afterEach(() => {
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    setWeeklyPlanningTraceRepositoryForTests(undefined);
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
    const input = {
      userId: 'owner-1',
      conversationId: 'conversation-1',
      requestId: 'request-1',
      userText: '予定を立てたい',
      assistantMessage: '条件を教えてください。',
      outcome: 'revision_pending',
      graphRevision: 1,
      graphSummary: { taskCount: 1 },
      compatibilityState: { status: 'revision_pending' },
      previewCount: 0,
    } as const;

    await recordWeeklyPlanningStableV5TurnTrace(input);
    await recordWeeklyPlanningStableV5TurnTrace(input);

    expect(harness.writes).toHaveLength(1);
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
