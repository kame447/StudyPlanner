import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createMemoryStorageHarness,
  installWeeklyPlanningTestStorage,
} from '../testUtils/weeklyPlanningApplicationTestHarness';
import type {
  WeeklyPlanningTraceApiClient,
  WeeklyPlanningTraceServerHandle,
  WeeklyPlanningTraceSessionStartInput,
} from './weeklyPlanningTracePrivacyClient';
import { createRemoteWeeklyPlanningTraceRepository } from './weeklyPlanningTraceRemoteRepository';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import {
  recordWeeklyPlanningStableV5TurnTrace,
  resetWeeklyPlanningStableV5TraceRuntimeForTest,
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest,
} from './weeklyPlanningStableV5TraceRuntime';

const SERVER_SESSION_ID = 'weekly-trace-123e4567-e89b-52d3-a456-426614174000';
const SERVER_CONVERSATION_ID = 'weekly-conversation-223e4567-e89b-52d3-a456-426614174000';

function clientHarness() {
  const startCalls: WeeklyPlanningTraceSessionStartInput[] = [];
  const appendCalls: Record<string, unknown>[] = [];
  const handles = new Map<string, WeeklyPlanningTraceServerHandle>();
  const client: WeeklyPlanningTraceApiClient = {
    async getPolicyStatus() {
      return { policyVersion: 'test', accepted: true, acceptedAt: '2026-07-24T00:00:00.000Z' };
    },
    async acceptPolicy() {
      return { policyVersion: 'test', accepted: true, acceptedAt: '2026-07-24T00:00:00.000Z' };
    },
    async startSession(input) {
      startCalls.push(structuredClone(input));
      const existing = handles.get(input.idempotencyKey);
      if (existing) return existing;
      const handle = {
        sessionId: SERVER_SESSION_ID,
        logicalConversationId: SERVER_CONVERSATION_ID,
      };
      handles.set(input.idempotencyKey, handle);
      return handle;
    },
    async append(payload) {
      appendCalls.push(structuredClone(payload));
    },
    async deleteCurrentUserTrace() {
      return { deletedSessions: 0, deletedEntries: 0 };
    },
    async listAdminSessions() { return []; },
    async listAdminEntries() { return []; },
    async archiveAdminSession() {},
  };
  return { client, startCalls, appendCalls };
}

function input(requestSequence: number) {
  return {
    userId: 'owner-1',
    conversationId: 'weekly-conversation-local-1',
    requestId: `weekly-conversation-local-1:request:${requestSequence}`,
    userText: requestSequence === 1
      ? '今日の計画を立ててください'
      : '院試でハードウェアとOSnetworkを復習します',
    assistantMessage: '予定に入れる作業量を教えてください。',
    outcome: 'needs_scope',
    graphRevision: requestSequence,
    graphSummary: {},
    compatibilityState: { status: 'needs_scope' },
    previewCount: 0,
  };
}

describe('Stable V5 trace remote continuity', () => {
  let restoreWindow: (() => void) | null = null;

  beforeEach(() => {
    const storage = createMemoryStorageHarness();
    restoreWindow = installWeeklyPlanningTestStorage(storage.storage);
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
  });

  afterEach(() => {
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    setWeeklyPlanningTraceRepositoryForTests(undefined);
    restoreWindow?.();
    restoreWindow = null;
  });

  it('reuses the canonical server handle after runtime and repository reload', async () => {
    const harness = clientHarness();
    setWeeklyPlanningTraceRepositoryForTests(
      createRemoteWeeklyPlanningTraceRepository(harness.client),
    );
    await recordWeeklyPlanningStableV5TurnTrace(input(1));

    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    setWeeklyPlanningTraceRepositoryForTests(
      createRemoteWeeklyPlanningTraceRepository(harness.client),
    );
    await recordWeeklyPlanningStableV5TurnTrace(input(2));

    expect(harness.startCalls).toHaveLength(1);
    expect(harness.startCalls[0]).toEqual(expect.objectContaining({
      idempotencyKey: expect.any(String),
      conversationCorrelationKey: 'weekly-conversation-local-1',
    }));

    expect(harness.appendCalls).toHaveLength(2);
    const first = harness.appendCalls[0] as {
      session: { id: string; logicalConversationId: string };
      entries: Array<{ sequence: number; sessionId: string; logicalConversationId: string }>;
    };
    const second = harness.appendCalls[1] as typeof first;
    expect(second.session.id).toBe(first.session.id);
    expect(second.session.logicalConversationId).toBe(first.session.logicalConversationId);
    expect(second.entries[0].sequence).toBe(first.entries.length);
    expect(second.entries.every((entry) => entry.sessionId === first.session.id)).toBe(true);
    expect(second.entries.every(
      (entry) => entry.logicalConversationId === first.session.logicalConversationId,
    )).toBe(true);
  });
});
