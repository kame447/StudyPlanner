import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import {
  createMemoryStorageHarness,
  installWeeklyPlanningTestStorage,
} from '../testUtils/weeklyPlanningApplicationTestHarness';
import type { PlanningState, WeeklyPlanningAction } from '../types';
import {
  recordWeeklyPlanningStableV5TurnTrace,
  resetWeeklyPlanningStableV5TraceRuntimeForTest,
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest,
} from '../trace/weeklyPlanningStableV5TraceRuntime';
import {
  setWeeklyPlanningTraceRepositoryForTests,
} from '../trace/weeklyPlanningTraceRepository';
import type {
  WeeklyPlanningTraceEntry,
  WeeklyPlanningTraceRepository,
  WeeklyPlanningTraceSession,
} from '../trace/weeklyPlanningTraceTypes';
import {
  createWeeklyPlanningControllerSession,
  submitWeeklyPlanningControlledTurn,
} from '../weeklyPlanningTurnController';
import {
  createInitialPlanningState,
  weeklyPlanningReducer,
} from '../weeklyPlanningReducer';

const OWNER_ID = 'owner-1';
const WEEK_START = '2026-07-20';
const CONVERSATION_ID = 'weekly-conversation-resume-test';

function intakeState(sourceTurns: string[]): PlanningIntakeState {
  return {
    status: 'needs_scope',
    intent: 'weekly_study_planning',
    tasks: [],
    progress: [],
    unitRates: [],
    constraints: [],
    priorityPolicy: { kind: 'unknown' },
    missing: [],
    assumptions: [],
    uncertainties: [],
    questions: [],
    shouldCreateDraft: false,
    shouldSavePlan: false,
    draftGenerationIntent: 'not_requested',
    sourceTurns,
  };
}

function repositoryHarness() {
  const writes: Array<{
    session: WeeklyPlanningTraceSession;
    entries: WeeklyPlanningTraceEntry[];
  }> = [];
  const repository: WeeklyPlanningTraceRepository = {
    async upsertSession() {},
    async appendEntries(params) {
      writes.push(structuredClone(params));
    },
    async listSessions() { return []; },
    async listSessionsForAdmin() { return []; },
    async archiveSessionForAdmin() {},
    async getSession() { return null; },
    async listEntries() { return []; },
  };
  return { writes, repository };
}

describe('Stable V5 restored conversation and trace integration', () => {
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

  it('continues controller request ids and trace entries in one session after reload', async () => {
    const harness = repositoryHarness();
    setWeeklyPlanningTraceRepositoryForTests(harness.repository);
    let state: PlanningState = createInitialPlanningState(WEEK_START);
    const dispatch = (action: WeeklyPlanningAction) => {
      state = weeklyPlanningReducer(state, action);
      return state;
    };

    async function submit(
      session: ReturnType<typeof createWeeklyPlanningControllerSession>,
      userText: string,
      sourceTurns: string[],
      graphRevision: number,
    ) {
      return submitWeeklyPlanningControlledTurn({
        session,
        ownerId: OWNER_ID,
        userText,
        getState: () => state,
        dispatch,
        async execute() {
          return {
            state: intakeState(sourceTurns),
            message: '予定に入れる作業量を教えてください。',
            draftCandidates: [],
          };
        },
        async onCommittedTurn({ pending, result }) {
          await recordWeeklyPlanningStableV5TurnTrace({
            userId: OWNER_ID,
            conversationId: pending.conversationId,
            requestId: pending.requestId,
            userText,
            assistantMessage: result.message,
            outcome: result.state.status,
            graphRevision,
            graphSummary: {},
            compatibilityState: result.state,
            previewCount: 0,
          });
        },
        now: () => `2026-07-23T15:2${graphRevision}:00.000Z`,
      });
    }

    const firstSession = createWeeklyPlanningControllerSession(
      OWNER_ID,
      WEEK_START,
      CONVERSATION_ID,
    );
    expect(await submit(
      firstSession,
      '今日の計画を立ててください',
      ['今日の計画を立ててください'],
      1,
    )).toMatchObject({ accepted: true });

    const firstTraceSessionId = harness.writes[0].session.id;
    expect(state.messages.map((message) => message.id)).toEqual([
      `${CONVERSATION_ID}:turn:1:user`,
      `${CONVERSATION_ID}:turn:1:assistant`,
    ]);

    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    const restoredController = createWeeklyPlanningControllerSession(
      OWNER_ID,
      WEEK_START,
      CONVERSATION_ID,
    );
    expect(restoredController.requestSequence).toBe(0);

    expect(await submit(
      restoredController,
      '院試でハードウェアとOSnetworkを復習します',
      [
        '今日の計画を立ててください',
        '院試でハードウェアとOSnetworkを復習します',
      ],
      2,
    )).toMatchObject({ accepted: true });

    expect(restoredController.requestSequence).toBe(2);
    expect(state.messages.map((message) => message.id)).toEqual([
      `${CONVERSATION_ID}:turn:1:user`,
      `${CONVERSATION_ID}:turn:1:assistant`,
      `${CONVERSATION_ID}:turn:2:user`,
      `${CONVERSATION_ID}:turn:2:assistant`,
    ]);
    expect(state.intakeState?.sourceTurns).toEqual([
      '今日の計画を立ててください',
      '院試でハードウェアとOSnetworkを復習します',
    ]);

    expect(harness.writes).toHaveLength(2);
    expect(harness.writes[1].session.id).toBe(firstTraceSessionId);
    expect(harness.writes[1].entries[0].requestId).toBe(
      `${CONVERSATION_ID}:request:2`,
    );
    expect(harness.writes[1].entries[0].sequence).toBe(harness.writes[0].entries.length);
    const allEntries = harness.writes.flatMap((write) => write.entries);
    expect(new Set(allEntries.map((entry) => entry.id)).size).toBe(allEntries.length);
  });
});
