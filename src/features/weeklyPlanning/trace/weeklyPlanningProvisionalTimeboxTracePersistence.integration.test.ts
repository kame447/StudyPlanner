import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS,
  measureWeeklyPlanningTraceJsonBytes,
} from '../../../../shared/weeklyPlanningTraceContract';
import {
  prepareWeeklyPlanningTraceServerWrite,
} from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import {
  createMemoryStorageHarness,
  installWeeklyPlanningTestStorage,
} from '../testUtils/weeklyPlanningApplicationTestHarness';
import {
  recordWeeklyPlanningStableV5TurnTrace,
  resetWeeklyPlanningStableV5TraceRuntimeForTest,
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest,
} from './weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from './weeklyPlanningTraceOutbox';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import type {
  WeeklyPlanningTraceEntry,
  WeeklyPlanningTraceRepository,
  WeeklyPlanningTraceSession,
} from './weeklyPlanningTraceTypes';

const USER_ID = 'owner-provisional-timebox-trace';
const CONVERSATION_ID =
  'weekly-conversation-323e4567-e89b-52d3-a456-426614174000';
const USER_TEXT =
  '総時間は分かりません。今ある空き時間の中で暫定的に配分してください。';
const PROVISIONAL_RESPONSE = JSON.stringify({
  decision: 'provisional_timebox',
  effortTarget: null,
  effortMeasurement: null,
  minutes: null,
  precision: null,
  quantityRole: null,
});

function repositoryHarness() {
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
        throw new Error('injected provisional timebox trace failure');
      }
      writes.push(structuredClone(params));
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
    failNext() { failuresRemaining += 1; },
  };
}

function traceInput(requestId: string, debugTraceEvents: Array<{
  schemaVersion: 2;
  sequence: number;
  stage: string;
  occurredAt: string;
  severity: 'debug' | 'info';
  data: unknown;
}>) {
  return {
    userId: USER_ID,
    conversationId: CONVERSATION_ID,
    requestId,
    userText: USER_TEXT,
    assistantMessage: '暫定的な時間枠で仮予定を作成します。',
    responseSource: 'ai' as const,
    outcome: 'preview_ready',
    debugTraceEvents,
    previewCount: 5,
  };
}

function provisionalTraceEvents(rawResponse = PROVISIONAL_RESPONSE) {
  return [
    {
      schemaVersion: 2 as const,
      sequence: 0,
      stage: 'semantic_provider_request',
      occurredAt: '2026-09-04T00:00:00.000Z',
      severity: 'debug' as const,
      data: {
        attempt: 'focused_contextual_answer',
        requestBytes: 512,
        request: {
          purpose: 'weekly_planning_semantic_normalizer',
          messages: [
            {
              role: 'system',
              content: 'provisional_timebox is scheduler permission only and must not become a completion estimate.',
            },
            { role: 'user', content: USER_TEXT },
          ],
          responseFormat: {
            type: 'json_schema',
            json_schema: {
              name: 'weekly_planning_focused_contextual_answer_v5',
            },
          },
          maxCompletionTokens: 320,
        },
      },
    },
    {
      schemaVersion: 2 as const,
      sequence: 1,
      stage: 'semantic_provider_response',
      occurredAt: '2026-09-04T00:00:00.005Z',
      severity: 'debug' as const,
      data: {
        attempt: 'focused_contextual_answer',
        responseLength: rawResponse.length,
        rawResponse,
      },
    },
  ];
}

function provisionalPreviewEvent() {
  return {
    schemaVersion: 2 as const,
    sequence: 2,
    stage: 'runtime_preview_scheduler_evaluated',
    occurredAt: '2026-09-04T00:00:00.010Z',
    severity: 'info' as const,
    data: {
      schedulerVersion: 'weekly-planning-stable-v5-preview-scheduler-v1',
      candidateCount: 1,
      unscheduledCount: 0,
      result: {
        status: 'ready',
        candidates: [{
          stableKey: 'stable-v5:11:wpwi-provisional-mock:0',
          date: '2026-09-10',
          startTime: '18:30',
          endTime: '19:30',
          durationMinutes: 60,
          title: '共通テスト模試対策 60分',
          field: '共通テスト模試対策',
          stableV5Metadata: {
            taskId: 'task-mock-prep',
            sourceFactRefs: ['task-mock-prep', 'wptb_task-mock-prep'],
          },
        }],
        unscheduledWorkItems: [],
      },
    },
  };
}

const subject = {
  token: `wpt_${'c'.repeat(43)}`,
  epoch: '102',
};
const canonicalIds = {
  sessionId: 'weekly-trace-323e4567-e89b-52d3-a456-426614174000',
  logicalConversationId: CONVERSATION_ID,
};

let restoreStorage: (() => void) | undefined;

beforeEach(() => {
  restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
});

afterEach(() => {
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  setWeeklyPlanningTraceRepositoryForTests(undefined);
  restoreStorage?.();
  restoreStorage = undefined;
});

describe('provisional timebox trace persistence gate', () => {
  it('survives outbox retry and Worker preparation with the focused request, response, and provisional preview evidence', async () => {
    const harness = repositoryHarness();
    harness.failNext();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const first = traceInput(
      `${CONVERSATION_ID}:request:1`,
      [...provisionalTraceEvents(), provisionalPreviewEvent()],
    );

    await recordWeeklyPlanningStableV5TurnTrace(first);

    expect(harness.writes).toHaveLength(0);
    expect(listWeeklyPlanningTraceOutboxItems({
      userId: first.userId,
      conversationId: first.conversationId,
    })).toHaveLength(1);

    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace(traceInput(
      `${CONVERSATION_ID}:request:2`,
      [],
    ));

    expect(harness.writes).toHaveLength(2);
    const replayed = harness.writes[0];
    const replayedEntry = replayed.entries[0];
    const serialized = JSON.stringify(replayedEntry);
    expect(replayedEntry.requestId).toBe(first.requestId);
    expect(serialized).toContain('weekly_planning_focused_contextual_answer_v5');
    expect(serialized).toContain('focused_contextual_answer');
    expect(serialized).toContain('provisional_timebox');
    expect(serialized).toContain('scheduler permission only');
    expect(serialized).toContain('wptb_task-mock-prep');
    expect(serialized).toContain('共通テスト模試対策');
    expect(measureWeeklyPlanningTraceJsonBytes(replayedEntry)).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes,
    );
    expect(listWeeklyPlanningTraceOutboxItems({
      userId: first.userId,
      conversationId: first.conversationId,
    })).toEqual([]);

    const prepared = prepareWeeklyPlanningTraceServerWrite({
      session: replayed.session as unknown as Record<string, unknown>,
      entries: replayed.entries as unknown as Record<string, unknown>[],
    }, subject, canonicalIds, '2026-09-04T00:00:00.000Z');
    expect(prepared.entries).toHaveLength(1);
    const preparedSerialized = JSON.stringify(prepared.entries[0]);
    expect(preparedSerialized).toContain('weekly_planning_focused_contextual_answer_v5');
    expect(preparedSerialized).toContain('provisional_timebox');
    expect(preparedSerialized).toContain('wptb_task-mock-prep');
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes,
    );
  });

  it('compacts an oversized focused raw response while preserving bounded diagnostics', async () => {
    const harness = repositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const oversized = `HEAD-${'あ'.repeat(10_000)}-TAIL`;

    await recordWeeklyPlanningStableV5TurnTrace(traceInput(
      `${CONVERSATION_ID}:request:oversized`,
      provisionalTraceEvents(oversized),
    ));

    expect(harness.writes).toHaveLength(1);
    const entry = harness.writes[0].entries[0];
    if (entry.kind !== 'turn_diagnostic') throw new Error('expected turn diagnostic');
    const response = entry.aiInterpreter.rawResponses[0];
    const serialized = JSON.stringify(entry);
    expect(response.attempt).toBe('focused_contextual_answer');
    expect(response.truncated).toBe(true);
    expect(response.originalBytes).toBe(new TextEncoder().encode(oversized).byteLength);
    expect(response.text).toContain('HEAD-');
    expect(response.text).toContain('-TAIL');
    expect(response.text).not.toBe(oversized);
    expect(serialized).not.toContain(oversized);
    expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes,
    );

    const prepared = prepareWeeklyPlanningTraceServerWrite({
      session: harness.writes[0].session as unknown as Record<string, unknown>,
      entries: harness.writes[0].entries as unknown as Record<string, unknown>[],
    }, subject, canonicalIds, '2026-09-04T00:00:00.000Z');
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes,
    );
  });
});
