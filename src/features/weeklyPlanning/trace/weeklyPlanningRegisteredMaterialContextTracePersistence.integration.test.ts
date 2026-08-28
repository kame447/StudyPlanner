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

const USER_ID = 'owner-registered-material-trace';
const CONVERSATION_ID =
  'weekly-conversation-223e4567-e89b-52d3-a456-426614174000';
const FUTURE_FIELD_SENTINEL = 'future-registered-material-field';

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
        throw new Error('injected registered material trace failure');
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
    userText: '明日から金フレを9月7日まで進めたい。',
    assistantMessage: '登録済み教材の情報を確認しました。',
    responseSource: 'ai' as const,
    outcome: 'needs_clarification',
    debugTraceEvents,
    previewCount: 0,
  };
}

function semanticInputEvent(publicStateSummary: Record<string, unknown>, sequence = 0) {
  return {
    schemaVersion: 2 as const,
    sequence,
    stage: 'semantic_pipeline_input',
    occurredAt: '2026-08-29T00:00:00.000Z',
    severity: 'debug' as const,
    data: {
      userText: '明日から金フレを9月7日まで進めたい。',
      recentConversation: [],
      publicStateSummary,
    },
  };
}

const subject = {
  token: `wpt_${'b'.repeat(43)}`,
  epoch: '101',
};
const canonicalIds = {
  sessionId: 'weekly-trace-223e4567-e89b-52d3-a456-426614174000',
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

describe('registered material semantic context trace persistence gate', () => {
  it('survives outbox retry and Worker preparation without dropping future material fields', async () => {
    const event = semanticInputEvent({
      graphRevision: 3,
      registeredMaterials: [
        {
          materialId: 'gold-phrase',
          name: 'TOEIC L&R TEST 出る単特急 金のフレーズ',
          aliases: ['金フレ'],
          catalogEntryId: 'seed:gold-phrase',
          progressUnit: 'word',
          totalUnits: 1000,
          currentUnit: 200,
          remainingUnits: 800,
        },
        {
          materialId: 'target-1900',
          name: '英単語ターゲット1900',
          aliases: ['ターゲット1900'],
          futureRegisteredMaterialField: FUTURE_FIELD_SENTINEL,
        },
      ],
    });

    const harness = repositoryHarness();
    harness.failNext();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const first = traceInput(`${CONVERSATION_ID}:request:1`, [event]);
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
    expect(serialized).toContain('金のフレーズ');
    expect(serialized).toContain('seed:gold-phrase');
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
    }, subject, canonicalIds, '2026-08-29T00:00:00.000Z');
    expect(prepared.entries).toHaveLength(1);
    expect(JSON.stringify(prepared.entries[0])).toContain(FUTURE_FIELD_SENTINEL);
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes,
    );
  });

  it('bounds oversized registered material diagnostics before persistence', async () => {
    const harness = repositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const oversized = 'oversized-material-field-'.repeat(4_000);

    await recordWeeklyPlanningStableV5TurnTrace(traceInput(
      `${CONVERSATION_ID}:request:oversized`,
      [semanticInputEvent({
        graphRevision: 4,
        registeredMaterials: [{
          materialId: 'gold-phrase',
          name: 'TOEIC L&R TEST 出る単特急 金のフレーズ',
          aliases: ['金フレ'],
          oversizedMaterialField: oversized,
        }],
      })],
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
    }, subject, canonicalIds, '2026-08-29T00:00:00.000Z');
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes,
    );
  });
});
