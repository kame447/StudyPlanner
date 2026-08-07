import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  bindWeeklyPlanningStableV5RuntimeSessionScope,
  getWeeklyPlanningStableV5RuntimeSession,
  hydrateWeeklyPlanningStableV5RuntimeSession,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from '../application/weeklyPlanningStableV5RuntimeSession';
import {
  discardWeeklyPlanningApplicationTurn,
  finalizeWeeklyPlanningApplicationTurn,
} from '../application/weeklyPlanningTurnSideEffects';
import {
  submitWeeklyPlanningApplicationTurn,
  type WeeklyPlanningTurnApplicationServices,
} from '../application/weeklyPlanningTurnApplication';
import {
  resetWeeklyPlanningRuntimeModeForTest,
  setWeeklyPlanningRuntimeMode,
} from '../application/weeklyPlanningRuntimeMode';
import { clearWeeklyPlanningSessionRuntime } from '../planning/weeklyPlanningSessionRuntime';
import {
  resetWeeklyPlanningStableV5DebugTraceForTest,
  takeWeeklyPlanningStableV5DebugTrace,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import type { PlanningState, WeeklyPlanningAction } from '../types';
import {
  createWeeklyPlanningControllerSession,
  submitWeeklyPlanningControlledTurn,
} from '../weeklyPlanningTurnController';
import {
  executeWeeklyPlanningTurn,
  type WeeklyPlanningTurnExecutionResult,
} from '../weeklyPlanningTurnExecutor';
import {
  createInitialPlanningState,
  weeklyPlanningReducer,
} from '../weeklyPlanningReducer';
import {
  WEEKLY_PLANNING_RESUMABLE_CONVERSATION_VERSION,
  parseWeeklyPlanningResumableConversationCheckpoint,
  serializeWeeklyPlanningResumableConversationCheckpoint,
  type WeeklyPlanningResumableConversationCheckpoint,
} from './weeklyPlanningResumableConversationCheckpoint';

const shouldRun = process.env.WEEKLY_PLANNING_RESUMABLE_REAL_API_TURN === '1';
const outputDir = process.env.WEEKLY_PLANNING_RESUMABLE_OUTPUT_DIR
  ?? 'artifacts/weekly-planning-resumable-conversation';
const DEFAULT_REAL_API_TURN_TIMEOUT_MS = 60_000;

function resolveRealApiTurnTimeoutMs(): number {
  const configured = Number(process.env.WEEKLY_PLANNING_RESUMABLE_TEST_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_REAL_API_TURN_TIMEOUT_MS;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function resetRuntime(): void {
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  resetWeeklyPlanningStableV5DebugTraceForTest();
  clearWeeklyPlanningSessionRuntime();
  resetWeeklyPlanningRuntimeModeForTest();
  setWeeklyPlanningRuntimeMode('stable_v5');
}

function createStore(initialState: PlanningState) {
  let state = structuredClone(initialState);
  return {
    getState: () => state,
    dispatch(action: WeeklyPlanningAction): PlanningState {
      state = weeklyPlanningReducer(state, action);
      return state;
    },
  };
}

function initialCheckpoint(): WeeklyPlanningResumableConversationCheckpoint {
  const ownerId = requiredEnv('WEEKLY_PLANNING_RESUMABLE_OWNER_ID');
  const conversationId = requiredEnv('WEEKLY_PLANNING_RESUMABLE_CONVERSATION_ID');
  const weekStartDate = requiredEnv('WEEKLY_PLANNING_RESUMABLE_WEEK_START_DATE');
  const selectedDate = requiredEnv('WEEKLY_PLANNING_RESUMABLE_SELECTED_DATE');
  const planningState = createInitialPlanningState(weekStartDate);
  resetRuntime();
  const runtime = bindWeeklyPlanningStableV5RuntimeSessionScope({ ownerId, weekStartDate, conversationId });
  return {
    version: WEEKLY_PLANNING_RESUMABLE_CONVERSATION_VERSION,
    ownerId,
    conversationId,
    weekStartDate,
    selectedDate,
    planningState,
    graph: runtime.graph,
    turns: [],
    savedAt: new Date().toISOString(),
  };
}

function loadCheckpoint(): WeeklyPlanningResumableConversationCheckpoint {
  const path = process.env.WEEKLY_PLANNING_RESUMABLE_CHECKPOINT_PATH?.trim();
  if (!path) return initialCheckpoint();
  return parseWeeklyPlanningResumableConversationCheckpoint(readFileSync(path, 'utf8'));
}

function writeOutputs(params: {
  checkpoint: WeeklyPlanningResumableConversationCheckpoint;
  trace: unknown[];
  result: WeeklyPlanningTurnExecutionResult;
}): void {
  mkdirSync(outputDir, { recursive: true });
  const checkpointPath = `${outputDir}/checkpoint.json`;
  const latestTurn = params.checkpoint.turns[
    params.checkpoint.turns.length - 1
  ];
  writeFileSync(
    checkpointPath,
    serializeWeeklyPlanningResumableConversationCheckpoint(params.checkpoint),
  );
  writeFileSync(`${outputDir}/latest-turn.json`, `${JSON.stringify({
    turn: latestTurn,
    failure: params.result.failure ?? null,
    dialogueRendererTrace: params.result.dialogueRendererTrace ?? null,
    trace: params.trace,
  }, null, 2)}\n`);
  const transcript = params.checkpoint.turns.flatMap((turn) => [
    `## Turn ${turn.index}`,
    '',
    `ユーザー: ${turn.userText}`,
    '',
    `アプリ: ${turn.assistantText}`,
    '',
  ]).join('\n');
  writeFileSync(`${outputDir}/transcript.md`, [
    '# Weekly Planning Resumable Conversation',
    '',
    `Conversation ID: ${params.checkpoint.conversationId}`,
    `Graph revision: ${params.checkpoint.graph.revision}`,
    '',
    transcript,
  ].join('\n'));
  writeFileSync(`${outputDir}/resume.json`, `${JSON.stringify({
    checkpointPath,
    conversationId: params.checkpoint.conversationId,
    nextTurnIndex: params.checkpoint.turns.length + 1,
  }, null, 2)}\n`);
}

const run = shouldRun ? describe : describe.skip;

run('weekly planning resumable real API turn', () => {
  it('restores one conversation, submits exactly one user turn, and writes a new checkpoint', async () => {
    const checkpoint = loadCheckpoint();
    resetRuntime();
    hydrateWeeklyPlanningStableV5RuntimeSession({
      ownerId: checkpoint.ownerId,
      weekStartDate: checkpoint.weekStartDate,
      conversationId: checkpoint.conversationId,
      graph: checkpoint.graph,
    });

    const store = createStore(checkpoint.planningState);
    const session = createWeeklyPlanningControllerSession(
      checkpoint.ownerId,
      checkpoint.weekStartDate,
      checkpoint.conversationId,
    );
    const capture: {
      result: WeeklyPlanningTurnExecutionResult | null;
      requestId: string | null;
    } = { result: null, requestId: null };
    const services: WeeklyPlanningTurnApplicationServices = {
      submitControlledTurn: submitWeeklyPlanningControlledTurn,
      executeTurn: async (input) => {
        capture.requestId = input.traceRequestId;
        capture.result = await executeWeeklyPlanningTurn(input);
        return capture.result;
      },
      isStableV5Enabled: () => true,
      bindStableV5SessionScope: bindWeeklyPlanningStableV5RuntimeSessionScope,
      saveOwnedState: () => undefined,
      finalizeTurn: finalizeWeeklyPlanningApplicationTurn,
      discardTurn: discardWeeklyPlanningApplicationTurn,
      recordCommittedTurn: () => null,
      recordDiscardedTurn: () => null,
      recordFailedTurn: () => null,
    };

    const userText = requiredEnv('WEEKLY_PLANNING_RESUMABLE_USER_TEXT');
    const submission = await submitWeeklyPlanningApplicationTurn({
      session,
      userId: checkpoint.ownerId,
      ownerId: checkpoint.ownerId,
      userText,
      selectedDate: checkpoint.selectedDate,
      plans: [],
      scheduleTemplates: [],
      weekStartsOn: 'monday',
      getState: store.getState,
      dispatch: store.dispatch,
    }, services);

    expect(submission.accepted).toBe(true);
    const result = capture.result;
    const requestId = capture.requestId;
    if (!result || !requestId) {
      throw new Error('Turn did not expose execution diagnostics.');
    }
    if (result.failure) {
      throw new Error(`Turn failed: ${result.failure.code} ${result.failure.traceCode}`);
    }
    const runtime = getWeeklyPlanningStableV5RuntimeSession(checkpoint.conversationId);
    if (!runtime) throw new Error('Stable V5 runtime session disappeared after the turn.');
    const assistantText = store.getState().lastAssistantMessage ?? '';
    if (!assistantText.trim()) throw new Error('Assistant response was empty.');
    const trace = takeWeeklyPlanningStableV5DebugTrace(requestId);
    const nextCheckpoint: WeeklyPlanningResumableConversationCheckpoint = {
      ...checkpoint,
      planningState: structuredClone(store.getState()),
      graph: runtime.graph,
      turns: [
        ...checkpoint.turns,
        {
          index: checkpoint.turns.length + 1,
          userText,
          assistantText,
          requestId,
          responseSource: result.responseSource ?? null,
          graphRevision: runtime.graph.revision,
          createdAt: new Date().toISOString(),
        },
      ],
      savedAt: new Date().toISOString(),
    };
    writeOutputs({ checkpoint: nextCheckpoint, trace, result });
  }, resolveRealApiTurnTimeoutMs());
});
