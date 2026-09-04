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

const USER_ID = 'owner-provisional-capacity-trace';
const CONVERSATION_ID =
  'weekly-conversation-423e4567-e89b-52d3-a456-426614174000';

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
        throw new Error('injected provisional capacity trace failure');
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

const oversizedTitle = `英文長文-${'あ'.repeat(5_000)}-TAIL`;

function previewEvent() {
  return {
    schemaVersion: 2 as const,
    sequence: 0,
    stage: 'runtime_preview_scheduler_evaluated',
    occurredAt: '2026-09-05T00:00:00.000Z',
    severity: 'warn' as const,
    data: {
      schedulerVersion: 'weekly-planning-stable-v5-preview-scheduler-v1',
      defaultsAndCriteria: {
        allOrNothing: 'unscheduled work returns insufficient_capacity; ordinary planning does not expose retained partial candidates as a preview',
      },
      result: {
        status: 'insufficient_capacity',
        candidates: [{
          stableKey: 'stable-v5:11:item-math:0',
          date: '2026-09-05',
          startTime: '18:30',
          endTime: '19:30',
          durationMinutes: 60,
          title: oversizedTitle,
          field: '数学',
          stableV5Metadata: {
            taskId: 'task-math',
            futureSentinel: 'keep-provisional-capacity-sentinel',
          },
        }],
        unscheduledWorkItems: ['item-english-daily'],
      },
      candidateCount: 1,
      unscheduledCount: 1,
    },
  };
}

function traceInput(requestId: string, events: ReturnType<typeof previewEvent>[]) {
  return {
    userId: USER_ID,
    conversationId: CONVERSATION_ID,
    requestId,
    userText: '空き時間の中で数学を英語より優先して暫定配分してください。',
    assistantMessage: '英語の一部を外した仮予定を作りました。',
    responseSource: 'ai' as const,
    outcome: 'preview_ready',
    debugTraceEvents: events,
    previewCount: 1,
  };
}

const subject = {
  token: `wpt_${'d'.repeat(43)}`,
  epoch: '103',
};
const canonicalIds = {
  sessionId: 'weekly-trace-423e4567-e89b-52d3-a456-426614174000',
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

describe('provisional capacity preview trace persistence gate', () => {
  it('survives outbox retry and Worker preparation with retained candidates and omitted low-priority work', async () => {
    const harness = repositoryHarness();
    harness.failNext();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const first = traceInput(`${CONVERSATION_ID}:request:1`, [previewEvent()]);

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
    expect(serialized).toContain('insufficient_capacity');
    expect(serialized).toContain('item-english-daily');
    expect(serialized).toContain('task-math');
    expect(serialized).toContain('keep-provisional-capacity-sentinel');
    expect(serialized).toContain('ordinary planning does not expose retained partial candidates');
    expect(serialized).toContain('[trace truncated]');
    expect(serialized).not.toContain(oversizedTitle);
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
    }, subject, canonicalIds, '2026-09-05T00:00:00.000Z');
    expect(prepared.entries).toHaveLength(1);
    const preparedSerialized = JSON.stringify(prepared.entries[0]);
    expect(preparedSerialized).toContain('item-english-daily');
    expect(preparedSerialized).toContain('keep-provisional-capacity-sentinel');
    expect(preparedSerialized).toContain('[trace truncated]');
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes,
    );
  });
});
