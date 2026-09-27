import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS,
  measureWeeklyPlanningTraceJsonBytes,
} from '../../../../shared/weeklyPlanningTraceContract';
import {
  prepareWeeklyPlanningTraceServerWrite,
} from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import {
  executeWeeklyPlanningStableV5RuntimeTurn,
} from '../application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import {
  hydrateWeeklyPlanningStableV5RuntimeSession,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from '../application/weeklyPlanningStableV5RuntimeSession';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import {
  createMemoryStorageHarness,
  installWeeklyPlanningTestStorage,
} from '../testUtils/weeklyPlanningApplicationTestHarness';
import {
  beginWeeklyPlanningStableV5DebugTrace,
  recordWeeklyPlanningStableV5DebugTrace,
  resetWeeklyPlanningStableV5DebugTraceForTest,
  takeWeeklyPlanningStableV5DebugTrace,
} from './weeklyPlanningStableV5DebugTrace';
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

const USER_ID = 'owner-question-presentation-trace';
const CONVERSATION_ID =
  'weekly-conversation-523e4567-e89b-52d3-a456-426614174000';
const SENTINEL = 'question-presentation-binding-sentinel';

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
        throw new Error('injected question presentation trace failure');
      }
      writes.push(structuredClone(params));
    },
    async listSessions() { return []; },
    async listSessionsForAdmin() { return []; },
    async archiveSessionForAdmin() {},
    async getSession() { return null; },
    async listEntries() { return []; },
  };
  return { repository, writes, failNext() { failuresRemaining += 1; } };
}

function boundQuestionContext() {
  return {
    kind: 'options',
    targetSlot: 'stable_v5:learning_strategy_proposal',
    intent: 'learning_strategy_proposal',
    topicId: 'workload-1',
    actionId: 'wpp_memory_trace',
    presentation: {
      version: 1,
      turnId: SENTINEL,
      assistantMessageId: `${SENTINEL}:assistant`,
      planningStateRevision: 8,
      graphRevision: 3,
      content: {
        responseSource: 'ai',
        currentTurnGrounding: 'none',
        selfRepairNotice: false,
        groundingContext: { proposed: 0, contested: 0 },
        previewPromotionControl: false,
      },
    },
  };
}

/*
 * Worst case: in production the binding is added by the turn controller after the
 * runtime and is excluded from the semantic summary, so no debug stage receives it.
 * Here it is deliberately placed in every stage that carries question contexts to
 * pin that the durable diagnostic boundary also drops it.
 */
function debugEventsCarryingBinding(requestId: string) {
  beginWeeklyPlanningStableV5DebugTrace(requestId);
  const state = {
    status: 'revision_pending',
    questions: ['分散学習の提案について、採用するか教えてください。'],
    lastQuestionContext: boundQuestionContext(),
  };
  recordWeeklyPlanningStableV5DebugTrace({
    requestId,
    stage: 'runtime_session_context_prepared',
    data: {
      graphRevision: 3,
      publicStateSummary: { pendingQuestion: boundQuestionContext() },
    },
  });
  recordWeeklyPlanningStableV5DebugTrace({
    requestId,
    stage: 'runtime_branch_selected',
    data: {
      branch: 'learning_strategy_proposal',
      basis: {},
      output: { state, message: '', draftCandidates: [] },
    },
  });
  recordWeeklyPlanningStableV5DebugTrace({
    requestId,
    stage: 'turn_executor_result_projected',
    data: {
      branch: 'no_recorded_failure',
      projectedResult: { state, message: '提案です。', draftCandidates: [] },
    },
  });
  recordWeeklyPlanningStableV5DebugTrace({
    requestId,
    stage: 'runtime_turn_output',
    data: { finalDecision: { lastQuestionContext: boundQuestionContext() } },
  });
  return takeWeeklyPlanningStableV5DebugTrace(requestId);
}

function traceInput(requestId: string, debugTraceEvents: ReturnType<typeof debugEventsCarryingBinding>) {
  return {
    userId: USER_ID,
    conversationId: CONVERSATION_ID,
    requestId,
    userText: 'いいえ',
    assistantMessage: '分散学習の提案について、採用するか教えてください。',
    responseSource: 'ai' as const,
    outcome: 'question',
    debugTraceEvents,
    previewCount: 0,
  };
}

const subject = { token: `wpt_${'e'.repeat(43)}`, epoch: '104' };
const canonicalIds = {
  sessionId: 'weekly-trace-523e4567-e89b-52d3-a456-426614174000',
  logicalConversationId: CONVERSATION_ID,
};

let restoreStorage: (() => void) | undefined;

beforeEach(() => {
  restoreStorage = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  resetWeeklyPlanningStableV5DebugTraceForTest();
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
});

afterEach(() => {
  resetWeeklyPlanningStableV5DebugTraceForTest();
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  setWeeklyPlanningTraceRepositoryForTests(undefined);
  restoreStorage?.();
  restoreStorage = undefined;
});

describe('question presentation binding trace exclusion gate', () => {
  it('keeps the binding out of the durable diagnostic through outbox retry and Worker preparation', async () => {
    const harness = repositoryHarness();
    harness.failNext();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    const firstRequestId = `${CONVERSATION_ID}:request:1`;
    const first = traceInput(firstRequestId, debugEventsCarryingBinding(firstRequestId));
    expect(JSON.stringify(first.debugTraceEvents)).toContain(SENTINEL);

    await recordWeeklyPlanningStableV5TurnTrace(first);

    expect(harness.writes).toHaveLength(0);
    const queued = listWeeklyPlanningTraceOutboxItems({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
    });
    // The local retry outbox keeps the recorded debug events verbatim; the exclusion
    // contract applies to the durable diagnostic built from them.
    expect(queued).toHaveLength(1);

    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace(traceInput(`${CONVERSATION_ID}:request:2`, []));

    expect(harness.writes).toHaveLength(2);
    const replayedEntry = harness.writes[0].entries[0];
    expect(replayedEntry.requestId).toBe(firstRequestId);
    const serialized = JSON.stringify(replayedEntry);
    // The turn itself is still diagnosed; only the binding is absent.
    expect(serialized).toContain('分散学習の提案');
    expect(serialized).not.toContain(SENTINEL);
    expect(serialized).not.toContain('planningStateRevision');
    expect(measureWeeklyPlanningTraceJsonBytes(replayedEntry)).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes,
    );
    expect(listWeeklyPlanningTraceOutboxItems({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
    })).toEqual([]);

    const prepared = prepareWeeklyPlanningTraceServerWrite({
      session: harness.writes[0].session as unknown as Record<string, unknown>,
      entries: harness.writes[0].entries as unknown as Record<string, unknown>[],
    }, subject, canonicalIds, '2026-09-28T00:00:00.000Z');
    expect(prepared.entries).toHaveLength(1);
    const preparedSerialized = JSON.stringify(prepared.entries[0]);
    expect(preparedSerialized).toContain('分散学習の提案');
    expect(preparedSerialized).not.toContain(SENTINEL);
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(
      WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes,
    );
  });

  it('keeps the binding out of the local outbox on a real suppressed duplicate turn', async () => {
    const requestId = `${CONVERSATION_ID}:request:dup`;
    hydrateWeeklyPlanningStableV5RuntimeSession({
      ownerId: USER_ID,
      weekStartDate: '2026-09-28',
      conversationId: CONVERSATION_ID,
      graph: {
        ...createEmptyWeeklyPlanningFactGraphV5(),
        revision: 3,
        appliedTurnKeys: [`${CONVERSATION_ID}:${requestId}`],
      },
    });
    const previousState = {
      status: 'revision_pending',
      intent: 'weekly_study_planning',
      tasks: [],
      progress: [],
      unitRates: [],
      constraints: [],
      priorityPolicy: { kind: 'unknown' },
      missing: [],
      assumptions: [],
      uncertainties: [],
      questions: ['分散学習の提案について、採用するか教えてください。'],
      shouldCreateDraft: false,
      shouldSavePlan: false,
      draftGenerationIntent: 'not_requested',
      sourceTurns: [],
      lastQuestionContext: boundQuestionContext(),
    } as PlanningIntakeState;

    const result = await executeWeeklyPlanningStableV5RuntimeTurn({
      previousState,
      messages: [],
      userText: 'いいえ',
      selectedDate: '2026-09-28',
      userId: USER_ID,
      plans: [],
      scheduleTemplates: [],
      conversationId: CONVERSATION_ID,
      traceRequestId: requestId,
      requestContext: {
        startedAtIso: '2026-09-28T00:00:00.000Z',
        timeZone: 'Asia/Tokyo',
        currentDate: '2026-09-28',
        currentTime: '09:00',
        notBeforeDate: '2026-09-28',
        notBeforeTime: '09:00',
        weekStartsOn: 'monday',
      },
    });
    expect(result.message).toContain('重複');
    expect(result.state.lastQuestionContext).toMatchObject({ actionId: 'wpp_memory_trace' });
    expect(result.state.lastQuestionContext).not.toHaveProperty('presentation');

    const events = takeWeeklyPlanningStableV5DebugTrace(requestId);
    expect(events.map((event) => event.stage)).toContain('runtime_turn_output');
    expect(JSON.stringify(events)).not.toContain(SENTINEL);

    const harness = repositoryHarness();
    harness.failNext();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    await recordWeeklyPlanningStableV5TurnTrace(traceInput(requestId, events));
    const queued = listWeeklyPlanningTraceOutboxItems({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
    });
    expect(queued).toHaveLength(1);
    expect(JSON.stringify(queued)).not.toContain(SENTINEL);

    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace(traceInput(`${CONVERSATION_ID}:request:after`, []));
    expect(harness.writes).toHaveLength(2);
    expect(JSON.stringify(harness.writes[0])).not.toContain(SENTINEL);
    const prepared = prepareWeeklyPlanningTraceServerWrite({
      session: harness.writes[0].session as unknown as Record<string, unknown>,
      entries: harness.writes[0].entries as unknown as Record<string, unknown>[],
    }, subject, canonicalIds, '2026-09-28T00:00:00.000Z');
    expect(JSON.stringify(prepared.entries)).not.toContain(SENTINEL);
  });
});
