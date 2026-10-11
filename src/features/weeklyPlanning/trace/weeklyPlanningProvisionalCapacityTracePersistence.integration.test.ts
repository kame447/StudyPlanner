import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS,
  measureWeeklyPlanningTraceJsonBytes,
} from '../../../../shared/weeklyPlanningTraceContract';
import {
  prepareWeeklyPlanningTraceServerWrite,
} from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { executeWeeklyPlanningStableV5Preview } from '../application/weeklyPlanningStableV5PreviewExecution';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from '../semantic/weeklyPlanningFactGraphV5';
import type { GenericSchedulerInput } from '../semantic/weeklyPlanningGenericSchedulerInput';
import { compileGenericPlanningWorkItems } from '../semantic/weeklyPlanningGenericWorkItems';
import { createWeeklyPlanningPlacementGraphViewV5 } from '../semantic/weeklyPlanningPlacementGraphViewV5';
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
import {
  takeWeeklyPlanningStableV5DebugTrace,
  type WeeklyPlanningStableV5DebugTraceEvent,
} from './weeklyPlanningStableV5DebugTrace';
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

function traceInput(requestId: string, events: WeeklyPlanningStableV5DebugTraceEvent[]) {
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
  it('persists actual deadline-rescued candidates through outbox retry and bounded Worker preparation', async () => {
    const dates = ['2026-09-07', '2026-09-08'];
    const taskIds = ['task-flexible', 'task-urgent'];
    const source = {
      conversationId: CONVERSATION_ID, turnId: 'turn-rescue', semanticLocalId: 'capacity-rescue',
      sourceText: '二つの作業を各60分、後者は月曜までに進めたい', origin: 'user' as const,
    };
    const graph: WeeklyPlanningFactGraphV5 = {
      ...createEmptyWeeklyPlanningFactGraphV5(),
      revision: 1,
      tasks: taskIds.map((id) => ({
        id, category: 'study', title: id, source, createdRevision: 1,
      })),
      workloads: taskIds.map((taskId) => ({
        id: `workload-${taskId}`, taskId, componentId: null, quantityRole: 'target',
        amount: 60, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null,
        perOccurrence: false, periodExpression: null, source, createdRevision: 1,
      })),
      factLifecycles: taskIds.flatMap((id) => [id, `workload-${id}`]).map((factId) => ({
        factId, status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null,
      })),
    };
    const activeGraph = createWeeklyPlanningActiveSchedulerGraphViewV5(graph);
    const work = compileGenericPlanningWorkItems(activeGraph);
    expect(work.readiness).toBe('ready');
    expect(work.items.map((item) => item.taskId)).toEqual(taskIds);
    const schedulerInput: GenericSchedulerInput = {
      version: 'weekly-planning-generic-scheduler-input-v2', graphRevision: 1, ownerId: USER_ID,
      horizon: { startDate: dates[0], endDate: dates[1], timeZone: 'Asia/Tokyo', planningWindowFactIds: [] },
      movableWorkItems: work.items,
      fixedTaskReservations: [], taskDateEligibilities: [], sourceSelections: [], relations: [],
      preferredPlacements: [], sourceFactRefs: work.items.flatMap((item) => item.sourceFactRefs),
      hardDateBounds: [{
        taskId: 'task-urgent', targetFactId: 'task-urgent', startDate: null,
        endDate: dates[0], sourceFactIds: ['deadline-urgent'],
      }],
      dailyCapacityLimits: dates.map((date) => ({ date, maxMinutes: 60, sourceFactIds: [`cap:${date}`] })),
      availabilityWindows: dates.map((date) => ({
        id: `available:${date}`, kind: 'available', start: { date, time: '09:00' },
        end: { date, time: '10:00' }, timeZone: 'Asia/Tokyo', constraintLevel: 'hard',
        sourceKind: 'user_declaration', sourceRef: `available:${date}`, ownerId: USER_ID, graphRevision: 1,
      })),
    };
    const requestId = `${CONVERSATION_ID}:request:rescue`;
    const preview = executeWeeklyPlanningStableV5Preview({
      input: { plans: [], scheduleTemplates: [], traceRequestId: requestId },
      graph: createWeeklyPlanningPlacementGraphViewV5(activeGraph),
      schedulerInput,
      requestContext: {
        startedAtIso: '2026-09-07T00:00:00.000Z', timeZone: 'Asia/Tokyo',
        currentDate: dates[0], currentTime: '09:00', notBeforeDate: dates[0], notBeforeTime: '09:00',
        weekStartsOn: 'monday',
      },
    });
    expect(preview.status).toBe('ready');
    expect(preview.unscheduledWorkItemIds).toEqual([]);
    expect(preview.candidates.map(({ date, field, durationMinutes }) => ({ date, field, durationMinutes }))).toEqual([
      { date: dates[0], field: 'task-urgent', durationMinutes: 60 },
      { date: dates[1], field: 'task-flexible', durationMinutes: 60 },
    ]);
    const events = takeWeeklyPlanningStableV5DebugTrace(requestId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      stage: 'runtime_preview_scheduler_evaluated',
      data: { status: 'ready', candidateCount: 2, unscheduledCount: 0, candidates: preview.candidates },
    });
    const sentinel = 'future-capacity-rescue-field';
    const oversized = 'oversized-capacity-rescue-'.repeat(4_000);
    const event = {
      ...events[0],
      data: {
        ...(events[0].data as Record<string, unknown>),
        candidates: preview.candidates.map((candidate, index) => ({
          ...candidate,
          ...(index === 0 ? { oversizedFutureField: oversized } : { futureCapacityField: sentinel }),
        })),
      },
    };
    const harness = repositoryHarness();
    harness.failNext();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const first = {
      ...traceInput(requestId, [event]), previewCount: 2,
      userText: source.sourceText, assistantMessage: '月曜と火曜に60分ずつ配置しました。',
    };
    await recordWeeklyPlanningStableV5TurnTrace(first);
    expect(harness.writes).toHaveLength(0);
    expect(listWeeklyPlanningTraceOutboxItems({ userId: USER_ID, conversationId: CONVERSATION_ID })).toHaveLength(1);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace({ ...first, requestId: `${requestId}:next`, debugTraceEvents: [] });
    expect(harness.writes).toHaveLength(2);
    const replayed = harness.writes[0];
    expect(replayed.entries).toHaveLength(1);
    expect(replayed.entries[0].requestId).toBe(requestId);
    expect(listWeeklyPlanningTraceOutboxItems({ userId: USER_ID, conversationId: CONVERSATION_ID })).toEqual([]);
    expect(measureWeeklyPlanningTraceJsonBytes(replayed.entries[0])).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes,
    );
    const prepared = prepareWeeklyPlanningTraceServerWrite({
      session: replayed.session as unknown as Record<string, unknown>,
      entries: replayed.entries as unknown as Record<string, unknown>[],
    }, subject, canonicalIds, '2026-09-07T00:00:00.000Z');
    expect(prepared.entries).toHaveLength(1);
    for (const entry of [replayed.entries[0], prepared.entries[0]]) {
      const serialized = JSON.stringify(entry);
      expect(serialized).toContain('"status":"ready"');
      expect(serialized).toContain('"candidateCount":2');
      expect(serialized).toContain('"unscheduledCount":0');
      expect(serialized).toContain(sentinel);
      expect(serialized).toContain('"traceTruncated":true');
      expect(serialized).not.toContain(oversized);
      for (const value of [...dates, ...taskIds, ...work.items.flatMap((item) => item.sourceFactRefs)]) {
        expect(serialized).toContain(value);
      }
    }
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes,
    );
  });

  it('survives outbox retry and Worker preparation while minimizing transient scheduler identifiers', async () => {
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
    expect(serialized).toContain('"unscheduledCount":1');
    expect(serialized).toContain('英語の一部を外した仮予定');
    expect(serialized).toContain('task-math');
    expect(serialized).toContain('keep-provisional-capacity-sentinel');
    expect(serialized).toContain('"traceTruncated":true');
    expect(serialized).toContain('-TAIL');
    expect(serialized).not.toContain(oversizedTitle);
    // Durable diagnostics intentionally omit transient work-item IDs and verbose scheduler criteria.
    // The persisted alternative is the bounded count, representative candidate, and user-visible omission label.
    expect(serialized).not.toContain('item-english-daily');
    expect(serialized).not.toContain('ordinary planning does not expose retained partial candidates');
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
    expect(preparedSerialized).toContain('"unscheduledCount":1');
    expect(preparedSerialized).toContain('英語の一部を外した仮予定');
    expect(preparedSerialized).toContain('keep-provisional-capacity-sentinel');
    expect(preparedSerialized).toContain('"traceTruncated":true');
    expect(preparedSerialized).not.toContain('item-english-daily');
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes,
    );
  });
});
