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
const FUTURE_FIELD_SENTINEL = 'future-provisional-timebox-field';

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
    userText:
      '総時間は分かりません。今ある空き時間の中で暫定的に配分してください。',
    assistantMessage: '暫定的な時間枠で仮予定を作成します。',
    responseSource: 'ai' as const,
    outcome: 'preview_ready',
    debugTraceEvents,
    previewCount: 5,
  };
}

function provisionalTraceEvents(oversized?: string) {
  return [
    {
      schemaVersion: 2 as const,
      sequence: 0,
      stage: 'semantic_provider_request',
      occurredAt: '2026-09-04T00:00:00.000Z',
      severity: 'debug' as const,
      data: {
        attempt: 'focused_provisional_timebox',
        request: {
          purpose: 'weekly_planning_semantic_normalizer',
          messages: [{
            role: 'user',
            content:
              '総時間は分かりません。今ある空き時間の中で暫定的に配分してください。',
          }],
          responseFormat: {
            type: 'json_schema',
            json_schema: {
              name: 'weekly_planning_focused_provisional_timebox_v5',
            },
          },
        },
        futureProvisionalTimeboxField: FUTURE_FIELD_SENTINEL,
        ...(oversized ? { oversizedProvisionalField: oversized } : {}),
      },
    },
    {
      schemaVersion: 2 as const,
      sequence: 1,
      stage: 'runtime_scheduler_dialogue_evaluated',
      occurredAt: '2026-09-04T00:00:00.010Z',
      severity: 'info' as const,
      data: {
        provisionalTimeboxProjection: {
          policyVersion: 'weekly-planning-provisional-timebox-v1',
          source: 'current_directive',
          workloadFactIds: [
            'workload-math-ia',
            'workload-math-iibc',
            'workload-physics-mechanics',
            'workload-physics-electromagnetism',
            'workload-chemistry-theory',
          ],
          minutesPerWorkload: 60,
        },
        contextualDirective: {
          kind: 'provisional_timebox',
          scope: 'current_missing_effort',
        },
      },
    },
  ];
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
  it('survives outbox retry and Worker preparation without dropping request or future fields', async () => {
    const harness = repositoryHarness();
    harness.failNext();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const first = traceInput(
      `${CONVERSATION_ID}:request:1`,
      provisionalTraceEvents(),
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
    expect(serialized).toContain('weekly_planning_focused_provisional_timebox_v5');
    expect(serialized).toContain('weekly-planning-provisional-timebox-v1');
    expect(serialized).toContain('current_missing_effort');
    expect(serialized).toContain(FUTURE_FIELD_SENTINEL);
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
    expect(JSON.stringify(prepared.entries[0])).toContain(FUTURE_FIELD_SENTINEL);
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes,
    );
  });

  it('truncates oversized provisional diagnostics without discarding the turn', async () => {
    const harness = repositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const oversized = 'oversized-provisional-timebox-field-'.repeat(4_000);

    await recordWeeklyPlanningStableV5TurnTrace(traceInput(
      `${CONVERSATION_ID}:request:oversized`,
      provisionalTraceEvents(oversized),
    ));

    expect(harness.writes).toHaveLength(1);
    const entry = harness.writes[0].entries[0];
    const serialized = JSON.stringify(entry);
    expect(serialized).toContain('"traceTruncated":true');
    expect(serialized).toContain('"truncation":{"applied":true');
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
