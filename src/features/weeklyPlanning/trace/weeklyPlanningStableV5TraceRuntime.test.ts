import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS } from '../../../../shared/weeklyPlanningTraceContract';
import {
  createMemoryStorageHarness,
  installWeeklyPlanningTestStorage,
} from '../testUtils/weeklyPlanningApplicationTestHarness';
import {
  setWeeklyPlanningTraceRepositoryForTests,
} from './weeklyPlanningTraceRepository';
import {
  loadWeeklyPlanningStableV5TraceCursor,
} from './weeklyPlanningStableV5TraceSessionStorage';
import type {
  WeeklyPlanningTraceEntry,
  WeeklyPlanningTraceRepository,
  WeeklyPlanningTraceSession,
} from './weeklyPlanningTraceTypes';
import {
  recordWeeklyPlanningStableV5TurnTrace,
  resetWeeklyPlanningStableV5TraceRuntimeForTest,
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest,
} from './weeklyPlanningStableV5TraceRuntime';

function createRepositoryHarness() {
  const writes: Array<{
    session: WeeklyPlanningTraceSession;
    entries: WeeklyPlanningTraceEntry[];
  }> = [];
  let failuresRemaining = 0;
  const repository: WeeklyPlanningTraceRepository = {
    async upsertSession() {},
    async appendEntries(params) {
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        throw new Error('injected trace write failure');
      }
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
  return {
    repository,
    writes,
    failNext(count = 1) {
      failuresRemaining = count;
    },
  };
}

function traceInput(overrides: Partial<Parameters<
  typeof recordWeeklyPlanningStableV5TurnTrace
>[0]> = {}) {
  return {
    userId: 'owner-1',
    conversationId: 'conversation-1',
    requestId: 'conversation-1:request:1',
    userText: '予定を立てたい',
    assistantMessage: '条件を教えてください。',
    outcome: 'revision_pending',
    graphRevision: 1,
    graphSummary: { taskCount: 1 },
    compatibilityState: { status: 'revision_pending' },
    previewCount: 0,
    ...overrides,
  };
}

describe('Stable V5 trace runtime', () => {
  beforeEach(() => {
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
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
    const input = traceInput();

    await recordWeeklyPlanningStableV5TurnTrace(input);
    await recordWeeklyPlanningStableV5TurnTrace(input);

    expect(harness.writes).toHaveLength(1);
  });

  it('resumes the same trace session and sequence after runtime memory is lost', async () => {
    const storageHarness = createMemoryStorageHarness();
    const restoreWindow = installWeeklyPlanningTestStorage(storageHarness.storage);
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);

    try {
      await recordWeeklyPlanningStableV5TurnTrace(traceInput());
      const first = harness.writes[0];
      resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();

      await recordWeeklyPlanningStableV5TurnTrace(traceInput({
        requestId: 'conversation-1:request:2',
        userText: 'OSとハードウェアを復習します',
        assistantMessage: '作業量を教えてください。',
        graphRevision: 2,
      }));

      expect(harness.writes).toHaveLength(2);
      const second = harness.writes[1];
      expect(second.session.id).toBe(first.session.id);
      expect(second.session.logicalConversationId).toBe('conversation-1');
      expect(second.entries[0].sequence).toBe(first.entries.length);
      expect(second.session.entryCount).toBe(first.entries.length + second.entries.length);

      const allEntries = harness.writes.flatMap((write) => write.entries);
      expect(new Set(allEntries.map((entry) => entry.id)).size).toBe(allEntries.length);
      expect(allEntries
        .filter((entry) => entry.kind === 'turn')
        .map((entry) => entry.turnIndex)).toEqual([0, 1, 2, 3]);
    } finally {
      resetWeeklyPlanningStableV5TraceRuntimeForTest();
      restoreWindow();
    }
  });

  it('keeps one trace session after more than thirty minutes of inactivity', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-24T00:00:00.000Z'));
    const storageHarness = createMemoryStorageHarness();
    const restoreWindow = installWeeklyPlanningTestStorage(storageHarness.storage);
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);

    try {
      await recordWeeklyPlanningStableV5TurnTrace(traceInput());
      const first = harness.writes[0];
      resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
      vi.setSystemTime(new Date('2026-07-24T01:00:00.000Z'));

      await recordWeeklyPlanningStableV5TurnTrace(traceInput({
        requestId: 'conversation-1:request:2',
        userText: '一時間後に続きを入力します',
        graphRevision: 2,
      }));

      expect(harness.writes).toHaveLength(2);
      expect(harness.writes[1].session.id).toBe(first.session.id);
      expect(harness.writes[1].entries[0].sequence).toBe(first.entries.length);
    } finally {
      resetWeeklyPlanningStableV5TraceRuntimeForTest();
      restoreWindow();
    }
  });

  it('retries a failed write without consuming sequence or request id', async () => {
    const harness = createRepositoryHarness();
    harness.failNext();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const input = traceInput();

    await recordWeeklyPlanningStableV5TurnTrace(input);
    expect(harness.writes).toHaveLength(0);

    await recordWeeklyPlanningStableV5TurnTrace(input);
    expect(harness.writes).toHaveLength(1);
    expect(harness.writes[0].entries[0].sequence).toBe(0);
    expect(harness.writes[0].session.entryCount).toBe(harness.writes[0].entries.length);
  });

  it('persists zero-count identity before the first append and reuses it after failure plus reload', async () => {
    const storageHarness = createMemoryStorageHarness();
    const restoreWindow = installWeeklyPlanningTestStorage(storageHarness.storage);
    const harness = createRepositoryHarness();
    harness.failNext();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const input = traceInput();

    try {
      await recordWeeklyPlanningStableV5TurnTrace(input);
      expect(harness.writes).toHaveLength(0);

      const provisional = loadWeeklyPlanningStableV5TraceCursor({
        userId: input.userId,
        conversationId: input.conversationId,
      });
      expect(provisional).not.toBeNull();
      expect(provisional?.session).toMatchObject({
        logicalConversationId: input.conversationId,
        turnCount: 0,
        entryCount: 0,
      });
      expect(provisional?.nextSequence).toBe(0);
      expect(provisional?.nextTurnIndex).toBe(0);

      resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
      await recordWeeklyPlanningStableV5TurnTrace(input);

      expect(harness.writes).toHaveLength(1);
      expect(harness.writes[0].session.id).toBe(provisional?.session.id);
      expect(harness.writes[0].entries[0].sequence).toBe(0);
    } finally {
      resetWeeklyPlanningStableV5TraceRuntimeForTest();
      restoreWindow();
    }
  });

  it('chunks full debug data below the Worker string-redaction boundary', async () => {
    const harness = createRepositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);

    await recordWeeklyPlanningStableV5TurnTrace(traceInput({
      debugTraceEvents: [{
        schemaVersion: 1,
        sequence: 0,
        stage: 'runtime_turn_input',
        severity: 'debug',
        occurredAt: '2026-07-27T00:00:00.000Z',
        data: { large: 'x'.repeat(20_000) },
      }],
    }));

    const debugEntries = harness.writes[0].entries.filter(
      (entry) => entry.kind === 'internal_event'
        && entry.eventType === 'stable_v5_debug_stage',
    );
    expect(debugEntries.length).toBeGreaterThan(1);
    debugEntries.forEach((entry) => {
      if (entry.kind !== 'internal_event') throw new Error('expected internal event');
      const payload = entry.payload as Record<string, unknown>;
      expect(payload.storage).toBe('base64_utf8_json_chunk');
      expect(payload.chunkBytes).toBeLessThanOrEqual(
        WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.debugRawChunkBytes,
      );
      expect(String(payload.dataChunk).length).toBeLessThan(4_000);
    });
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