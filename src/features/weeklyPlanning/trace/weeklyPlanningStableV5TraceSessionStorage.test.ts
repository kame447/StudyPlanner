import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createMemoryStorageHarness,
  installWeeklyPlanningTestStorage,
  type MemoryStorageHarness,
} from '../testUtils/weeklyPlanningApplicationTestHarness';
import { WEEKLY_PLANNING_TRACE_SCHEMA_VERSION } from './weeklyPlanningTraceTypes';
import {
  clearAllWeeklyPlanningStableV5TraceCursorsForTest,
  getWeeklyPlanningStableV5TraceCursorStorageKeyForTest,
  loadWeeklyPlanningStableV5TraceCursor,
  saveWeeklyPlanningStableV5TraceCursor,
} from './weeklyPlanningStableV5TraceSessionStorage';

const USER_ID = 'owner-1';
const CONVERSATION_ID = 'weekly-conversation-1';
const LAST_ACTIVITY = '2026-07-24T01:00:00.000Z';

function session() {
  return {
    id: 'weekly-trace-local-1',
    logicalConversationId: CONVERSATION_ID,
    userId: USER_ID,
    status: 'active' as const,
    startedAt: '2026-07-24T00:59:00.000Z',
    lastActivityAt: LAST_ACTIVITY,
    turnCount: 2,
    entryCount: 7,
    hasPreview: false,
    hasApprovalFailure: false,
    hasFallback: false,
    hasError: false,
    appVersion: '0.1.0',
    schemaVersion: WEEKLY_PLANNING_TRACE_SCHEMA_VERSION,
    expireAt: '2026-10-22T01:00:00.000Z',
  };
}

function saveValidCursor() {
  return saveWeeklyPlanningStableV5TraceCursor({
    userId: USER_ID,
    conversationId: CONVERSATION_ID,
    session: session(),
    nextSequence: 7,
    nextTurnIndex: 2,
    lastActivityMs: Date.parse(LAST_ACTIVITY),
    requestIds: ['weekly-conversation-1:request:1'],
  });
}

describe('Stable V5 trace cursor storage', () => {
  let harness: MemoryStorageHarness;
  let restoreWindow: (() => void) | null = null;

  beforeEach(() => {
    harness = createMemoryStorageHarness();
    restoreWindow = installWeeklyPlanningTestStorage(harness.storage);
    clearAllWeeklyPlanningStableV5TraceCursorsForTest();
  });

  afterEach(() => {
    clearAllWeeklyPlanningStableV5TraceCursorsForTest();
    restoreWindow?.();
    restoreWindow = null;
  });

  it('round-trips metadata without conversation content', () => {
    expect(saveValidCursor()).toBe(true);
    const loaded = loadWeeklyPlanningStableV5TraceCursor({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
    });

    expect(loaded).toMatchObject({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      nextSequence: 7,
      nextTurnIndex: 2,
      requestIds: ['weekly-conversation-1:request:1'],
      session: {
        id: 'weekly-trace-local-1',
        entryCount: 7,
        turnCount: 2,
      },
    });
    const raw = harness.values.get(
      getWeeklyPlanningStableV5TraceCursorStorageKeyForTest(USER_ID, CONVERSATION_ID),
    );
    expect(raw).not.toContain('今日の計画');
    expect(raw).not.toContain('assistantMessage');
    expect(raw).not.toContain('compatibilityState');
  });

  it('rejects counter divergence and deletes the cursor', () => {
    expect(saveValidCursor()).toBe(true);
    const key = getWeeklyPlanningStableV5TraceCursorStorageKeyForTest(
      USER_ID,
      CONVERSATION_ID,
    );
    const value = JSON.parse(harness.values.get(key)!) as Record<string, unknown>;
    value.nextSequence = 8;
    harness.values.set(key, JSON.stringify(value));

    expect(loadWeeklyPlanningStableV5TraceCursor({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
    })).toBeNull();
    expect(harness.values.has(key)).toBe(false);
  });

  it('rejects unknown fields, owner changes and schema changes', () => {
    expect(saveValidCursor()).toBe(true);
    const key = getWeeklyPlanningStableV5TraceCursorStorageKeyForTest(
      USER_ID,
      CONVERSATION_ID,
    );

    const unknown = JSON.parse(harness.values.get(key)!) as Record<string, unknown>;
    unknown.unexpected = true;
    harness.values.set(key, JSON.stringify(unknown));
    expect(loadWeeklyPlanningStableV5TraceCursor({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
    })).toBeNull();

    expect(saveValidCursor()).toBe(true);
    const ownerMismatch = JSON.parse(harness.values.get(key)!) as Record<string, unknown>;
    ownerMismatch.userId = 'owner-2';
    harness.values.set(key, JSON.stringify(ownerMismatch));
    expect(loadWeeklyPlanningStableV5TraceCursor({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
    })).toBeNull();

    expect(saveValidCursor()).toBe(true);
    const schemaMismatch = JSON.parse(harness.values.get(key)!) as {
      session: Record<string, unknown>;
    };
    schemaMismatch.session.schemaVersion = WEEKLY_PLANNING_TRACE_SCHEMA_VERSION + 1;
    harness.values.set(key, JSON.stringify(schemaMismatch));
    expect(loadWeeklyPlanningStableV5TraceCursor({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
    })).toBeNull();
  });

  it('uses an unambiguous user and conversation key boundary', () => {
    const first = getWeeklyPlanningStableV5TraceCursorStorageKeyForTest('a.b', 'c');
    const second = getWeeklyPlanningStableV5TraceCursorStorageKeyForTest('a', 'b.c');
    expect(first).not.toBe(second);
  });
});
