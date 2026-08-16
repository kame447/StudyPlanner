import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS,
  measureWeeklyPlanningTraceJsonBytes,
} from '../../../../shared/weeklyPlanningTraceContract';
import {
  prepareWeeklyPlanningTraceServerWrite,
} from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from '../semantic/weeklyPlanningFactGraphV5';
import { compileGenericSchedulerInput } from '../semantic/weeklyPlanningGenericSchedulerInput';
import { scheduleWeeklyPlanningStableV5Preview } from '../semantic/weeklyPlanningStableV5PreviewScheduler';
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

const WEEK = [
  '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20',
  '2026-08-21', '2026-08-22', '2026-08-23',
];
const CONVERSATION_ID =
  'weekly-conversation-123e4567-e89b-52d3-a456-426614174000';
const FUTURE_FIELD_SENTINEL = 'future-recurrence-preview-field';

function source(localId: string) {
  return {
    conversationId: CONVERSATION_ID,
    turnId: 'turn-1',
    semanticLocalId: localId,
    sourceText: '数学を毎日2時間',
    origin: 'user' as const,
  };
}

function recurringGraph(): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    tasks: [{
      id: 'task-mock',
      category: 'study',
      title: '模試対策',
      source: source('task-mock'),
      createdRevision: 1,
    }],
    components: [{
      id: 'component-math',
      taskId: 'task-mock',
      parentComponentId: null,
      role: 'subject',
      label: '数学',
      source: source('component-math'),
      createdRevision: 1,
    }],
    workloads: [{
      id: 'workload-daily',
      taskId: 'task-mock',
      componentId: 'component-math',
      quantityRole: 'target',
      amount: 2,
      unitCode: 'hour',
      unitLabel: '時間',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: true,
      periodExpression: 'daily',
      source: source('workload-daily'),
      createdRevision: 1,
    }],
    recurrences: [{
      id: 'recurrence-daily',
      taskId: 'task-mock',
      targetFactId: 'component-math',
      kind: 'daily',
      count: null,
      days: [],
      source: source('recurrence-daily'),
      createdRevision: 1,
    }],
  };
}

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
        throw new Error('injected recurrence trace failure');
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
  severity: 'info';
  data: unknown;
}>) {
  return {
    userId: 'owner-recurrence-trace',
    conversationId: CONVERSATION_ID,
    requestId,
    userText: '数学を毎日2時間進めたいです。',
    assistantMessage: '毎日2時間ずつ、7件の仮予定候補を作成しました。',
    responseSource: 'ai' as const,
    outcome: 'scheduler_ready',
    debugTraceEvents,
    previewCount: 7,
  };
}

const subject = {
  token: `wpt_${'a'.repeat(43)}`,
  epoch: '100',
};
const canonicalIds = {
  sessionId: 'weekly-trace-123e4567-e89b-52d3-a456-426614174000',
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

describe('recurrence preview trace persistence gate', () => {
  it('persists generated occurrence dates and provenance through retry and Worker bounds', async () => {
    const graph = recurringGraph();
    const compilation = compileGenericSchedulerInput({
      graph,
      context: {
        ownerId: 'owner-recurrence-trace',
        currentDate: '2026-08-14',
        planningStartDate: WEEK[0],
        planningEndDate: WEEK[6],
        timeZone: 'Asia/Tokyo',
      },
    });
    expect(compilation.status).toBe('ready');
    const preview = scheduleWeeklyPlanningStableV5Preview({
      input: compilation.input!,
      graph,
    });
    expect(preview.status).toBe('ready');
    expect(preview.candidates.map((candidate) => candidate.date)).toEqual(WEEK);

    const candidates = preview.candidates.map((candidate, index) => {
      if (index === 0) {
        return {
          ...candidate,
          oversizedFutureField: 'oversized-recurrence-field-'.repeat(4_000),
        };
      }
      return index === 1
        ? { ...candidate, futureRecurrencePreviewField: FUTURE_FIELD_SENTINEL }
        : candidate;
    });
    const event = {
      schemaVersion: 2 as const,
      sequence: 0,
      stage: 'runtime_preview_scheduler_evaluated',
      occurredAt: '2026-08-14T00:00:00.000Z',
      severity: 'info' as const,
      data: {
        schedulerVersion: preview.schedulerVersion,
        result: { ...preview, candidates },
      },
    };

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
    expect(serialized).toContain(FUTURE_FIELD_SENTINEL);
    expect(serialized).toContain('recurrence-daily');
    expect(serialized).toContain('2026-08-17');
    expect(serialized).toContain('"traceTruncated":true');
    expect(serialized).toContain('"truncation":{"applied":true');
    expect(serialized).not.toContain('oversized-recurrence-field-'.repeat(100));
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
    }, subject, canonicalIds, '2026-08-14T00:00:00.000Z');
    expect(prepared.entries).toHaveLength(1);
    expect(JSON.stringify(prepared.entries[0])).toContain(FUTURE_FIELD_SENTINEL);
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes,
    );
  });
});
