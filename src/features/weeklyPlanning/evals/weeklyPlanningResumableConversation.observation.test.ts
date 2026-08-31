import { createReadyPlannerDataAvailability } from '../testUtils/plannerDataAvailabilityTest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Plan, PlanDraft } from '../../../types/domain';
import {
  exportUserPlanningContextSnapshotV1,
  hydrateUserPlanningContextSnapshotV1,
  resetUserPlanningContextRuntimeForTestV1,
} from '../../userPlanningContext/userPlanningContextSpace';
import {
  createEmptyUserPlanningContextSnapshotV1,
} from '../../userPlanningContext/userPlanningContextTypes';
import {
  approveWeeklyPlanningDraftBlocks,
} from '../application/weeklyPlanningApprovalApplication';
import {
  bindWeeklyPlanningStableV5RuntimeSessionScope,
  getWeeklyPlanningStableV5RuntimeSession,
  hydrateWeeklyPlanningStableV5RuntimeSession,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from '../application/weeklyPlanningStableV5RuntimeSession';
import {
  weeklyPlanningTurnRuntimeGateway,
} from '../application/weeklyPlanningTurnRuntimeGateway';
import {
  weeklyPlanningTurnStagingLifecycle,
} from '../application/weeklyPlanningTurnSideEffects';
import {
  submitWeeklyPlanningApplicationTurn,
  type WeeklyPlanningTurnApplicationServices,
} from '../application/weeklyPlanningTurnApplication';
import { clearWeeklyPlanningSessionRuntime } from '../planning/weeklyPlanningSessionRuntime';
import {
  createWeeklyDraftBlocksFromPreviewCandidates,
} from '../preview/weeklyPlanningPreviewBlocks';
import {
  resetWeeklyPlanningStableV5DebugTraceForTest,
  takeWeeklyPlanningStableV5DebugTrace,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import type { PlanningState, WeeklyPlanningAction } from '../types';
import {
  createWeeklyPlanningControllerSession,
  submitWeeklyPlanningControlledTurn,
} from '../weeklyPlanningTurnController';
import type {
  WeeklyPlanningTurnExecutionResult,
} from '../weeklyPlanningTurnExecutor';
import {
  createInitialPlanningState,
  weeklyPlanningReducer,
} from '../weeklyPlanningReducer';
import {
  WEEKLY_PLANNING_RESUMABLE_CONVERSATION_VERSION,
  createWeeklyPlanningResumableEvaluationState,
  parseWeeklyPlanningResumableConversationCheckpoint,
  serializeWeeklyPlanningResumableConversationCheckpoint,
  type WeeklyPlanningEvaluationAction,
  type WeeklyPlanningResumableConversationCheckpoint,
} from './weeklyPlanningResumableConversationCheckpoint';

const shouldRun = process.env.WEEKLY_PLANNING_RESUMABLE_EVALUATION_ACTION === '1'
  || process.env.WEEKLY_PLANNING_RESUMABLE_REAL_API_TURN === '1';
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

function evaluationAction(): WeeklyPlanningEvaluationAction {
  const value = process.env.WEEKLY_PLANNING_RESUMABLE_ACTION?.trim() || 'submit_turn';
  if (value === 'submit_turn' || value === 'promote_preview' || value === 'approve_drafts') {
    return value;
  }
  throw new Error(`Unsupported resumable evaluation action: ${value}`);
}

function resetRuntime(): void {
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  resetWeeklyPlanningStableV5DebugTraceForTest();
  clearWeeklyPlanningSessionRuntime();
  resetUserPlanningContextRuntimeForTestV1();
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
    userPlanningContext: createEmptyUserPlanningContextSnapshotV1(ownerId),
    turns: [],
    evaluation: createWeeklyPlanningResumableEvaluationState({
      planningState,
      lastAction: null,
    }),
    savedAt: new Date().toISOString(),
  };
}

function loadCheckpoint(action: WeeklyPlanningEvaluationAction): WeeklyPlanningResumableConversationCheckpoint {
  const path = process.env.WEEKLY_PLANNING_RESUMABLE_CHECKPOINT_PATH?.trim();
  if (!path) {
    if (action !== 'submit_turn') {
      throw new Error(`${action} requires a previous checkpoint.`);
    }
    return initialCheckpoint();
  }
  return parseWeeklyPlanningResumableConversationCheckpoint(readFileSync(path, 'utf8'));
}

function successfulTranscript(checkpoint: WeeklyPlanningResumableConversationCheckpoint): string {
  return checkpoint.turns.flatMap((turn) => [
    `## Turn ${turn.index}`,
    '',
    `ユーザー: ${turn.userText}`,
    '',
    `アプリ: ${turn.assistantText}`,
    '',
  ]).join('\n');
}

function writeResumeFile(params: {
  checkpointPath: string;
  checkpoint: WeeklyPlanningResumableConversationCheckpoint;
}): void {
  writeFileSync(`${outputDir}/resume.json`, `${JSON.stringify({
    checkpointPath: params.checkpointPath,
    conversationId: params.checkpoint.conversationId,
    nextTurnIndex: params.checkpoint.turns.length + 1,
    evaluation: params.checkpoint.evaluation,
    terminal: params.checkpoint.evaluation.terminal,
  }, null, 2)}\n`);
}

function writeOutputs(params: {
  checkpoint: WeeklyPlanningResumableConversationCheckpoint;
  action: WeeklyPlanningEvaluationAction;
  trace?: unknown[];
  result?: WeeklyPlanningTurnExecutionResult;
  savedPlans?: Plan[];
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
  writeFileSync(`${outputDir}/latest-action.json`, `${JSON.stringify({
    action: params.action,
    evaluation: params.checkpoint.evaluation,
    turn: params.action === 'submit_turn' ? latestTurn ?? null : null,
    failure: params.result?.failure ?? null,
    dialogueRendererTrace: params.result?.dialogueRendererTrace ?? null,
    savedPlans: params.savedPlans ?? [],
    userPlanningContext: params.checkpoint.userPlanningContext,
    trace: params.trace ?? [],
  }, null, 2)}\n`);
  writeFileSync(`${outputDir}/completion-status.json`, `${JSON.stringify({
    stage: params.checkpoint.evaluation.stage,
    terminal: params.checkpoint.evaluation.terminal,
    savedPlanIds: params.checkpoint.evaluation.savedPlanIds,
    suggestedNextAction:
      params.checkpoint.evaluation.stage === 'preview_ready'
        ? 'promote_preview'
        : params.checkpoint.evaluation.stage === 'awaiting_approval'
          ? 'approve_drafts'
          : params.checkpoint.evaluation.stage === 'conversation_in_progress'
            ? 'submit_turn'
            : null,
  }, null, 2)}\n`);
  writeFileSync(`${outputDir}/transcript.md`, [
    '# Weekly Planning Completion-Based Conversation Evaluation',
    '',
    `Conversation ID: ${params.checkpoint.conversationId}`,
    `Graph revision: ${params.checkpoint.graph.revision}`,
    `Evaluation stage: ${params.checkpoint.evaluation.stage}`,
    `Terminal: ${String(params.checkpoint.evaluation.terminal)}`,
    '',
    successfulTranscript(params.checkpoint),
  ].join('\n'));
  writeResumeFile({ checkpointPath, checkpoint: params.checkpoint });
}

function writeFailureOutputs(params: {
  checkpoint: WeeklyPlanningResumableConversationCheckpoint;
  userText: string;
  requestId: string;
  trace: unknown[];
  result: WeeklyPlanningTurnExecutionResult;
}): void {
  mkdirSync(outputDir, { recursive: true });
  const checkpointPath = `${outputDir}/checkpoint.json`;
  writeFileSync(
    checkpointPath,
    serializeWeeklyPlanningResumableConversationCheckpoint(params.checkpoint),
  );
  const failedAttempt = {
    index: params.checkpoint.turns.length + 1,
    userText: params.userText,
    assistantText: params.result.message,
    requestId: params.requestId,
    responseSource: params.result.responseSource ?? null,
    graphRevision: params.checkpoint.graph.revision,
    committed: false,
  };
  writeFileSync(`${outputDir}/latest-action.json`, `${JSON.stringify({
    action: 'submit_turn',
    turn: null,
    failedAttempt,
    evaluation: params.checkpoint.evaluation,
    failure: params.result.failure ?? null,
    dialogueRendererTrace: params.result.dialogueRendererTrace ?? null,
    userPlanningContext: params.checkpoint.userPlanningContext,
    trace: params.trace,
  }, null, 2)}\n`);
  writeFileSync(`${outputDir}/transcript.md`, [
    '# Weekly Planning Completion-Based Conversation Evaluation',
    '',
    `Conversation ID: ${params.checkpoint.conversationId}`,
    `Graph revision: ${params.checkpoint.graph.revision}`,
    '',
    successfulTranscript(params.checkpoint),
    `## Failed attempt ${failedAttempt.index}`,
    '',
    `ユーザー: ${failedAttempt.userText}`,
    '',
    `アプリ/システム: ${failedAttempt.assistantText}`,
    '',
    `Failure: ${params.result.failure?.code ?? 'unknown'}`,
    '',
  ].join('\n'));
  writeResumeFile({ checkpointPath, checkpoint: params.checkpoint });
}

function hydrateCheckpointRuntime(checkpoint: WeeklyPlanningResumableConversationCheckpoint): void {
  resetRuntime();
  hydrateUserPlanningContextSnapshotV1(checkpoint.userPlanningContext);
  hydrateWeeklyPlanningStableV5RuntimeSession({
    ownerId: checkpoint.ownerId,
    weekStartDate: checkpoint.weekStartDate,
    conversationId: checkpoint.conversationId,
    graph: checkpoint.graph,
  });
}

function runtimeGraph(checkpoint: WeeklyPlanningResumableConversationCheckpoint) {
  const runtime = getWeeklyPlanningStableV5RuntimeSession(checkpoint.conversationId);
  if (!runtime) throw new Error('Stable V5 runtime session disappeared during evaluation.');
  return runtime.graph;
}

function nextCheckpointBase(params: {
  checkpoint: WeeklyPlanningResumableConversationCheckpoint;
  planningState: PlanningState;
  action: WeeklyPlanningEvaluationAction;
  savedPlanIds?: readonly string[];
}): Omit<WeeklyPlanningResumableConversationCheckpoint, 'turns'> {
  const now = new Date().toISOString();
  return {
    ...params.checkpoint,
    planningState: structuredClone(params.planningState),
    graph: runtimeGraph(params.checkpoint),
    userPlanningContext: exportUserPlanningContextSnapshotV1({
      ownerId: params.checkpoint.ownerId,
      currentDate: params.checkpoint.selectedDate,
    }),
    evaluation: createWeeklyPlanningResumableEvaluationState({
      planningState: params.planningState,
      previous: params.checkpoint.evaluation,
      lastAction: params.action,
      savedPlanIds: params.savedPlanIds,
      now,
    }),
    savedAt: now,
  };
}

async function submitTurnAction(
  checkpoint: WeeklyPlanningResumableConversationCheckpoint,
): Promise<void> {
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
    runtimeGateway: {
      async execute(params) {
        capture.requestId = params.pending.requestId;
        capture.result = await weeklyPlanningTurnRuntimeGateway.execute(params);
        return capture.result;
      },
    },
    stagingLifecycle: weeklyPlanningTurnStagingLifecycle,
    outcomeLifecycle: {
      committed: () => undefined,
      discarded: () => undefined,
      failed: () => undefined,
    },
  };

  const userText = requiredEnv('WEEKLY_PLANNING_RESUMABLE_USER_TEXT');
  const submission = await submitWeeklyPlanningApplicationTurn({
    session,
    userId: checkpoint.ownerId,
    ownerId: checkpoint.ownerId,
    plannerDataAvailability: createReadyPlannerDataAvailability(checkpoint.ownerId),
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
  const trace = takeWeeklyPlanningStableV5DebugTrace(requestId);
  if (result.failure) {
    writeFailureOutputs({ checkpoint, userText, requestId, trace, result });
    throw new Error(`Turn failed: ${result.failure.code} ${result.failure.traceCode}`);
  }
  const assistantText = store.getState().lastAssistantMessage ?? '';
  if (!assistantText.trim()) throw new Error('Assistant response was empty.');
  const base = nextCheckpointBase({
    checkpoint,
    planningState: store.getState(),
    action: 'submit_turn',
  });
  const nextCheckpoint: WeeklyPlanningResumableConversationCheckpoint = {
    ...base,
    turns: [
      ...checkpoint.turns,
      {
        index: checkpoint.turns.length + 1,
        userText,
        assistantText,
        requestId,
        responseSource: result.responseSource ?? null,
        graphRevision: base.graph.revision,
        createdAt: new Date().toISOString(),
      },
    ],
  };
  writeOutputs({ checkpoint: nextCheckpoint, action: 'submit_turn', trace, result });
}

function promotePreviewAction(
  checkpoint: WeeklyPlanningResumableConversationCheckpoint,
): void {
  const store = createStore(checkpoint.planningState);
  const candidates = store.getState().previewCandidates ?? [];
  if (candidates.length === 0) {
    throw new Error('No preview candidates are available to promote.');
  }
  const blocks = createWeeklyDraftBlocksFromPreviewCandidates({
    candidates,
    userId: checkpoint.ownerId,
    createdAt: new Date().toISOString(),
  });
  if (blocks.length === 0) throw new Error('Preview promotion produced no draft blocks.');
  store.dispatch({ type: 'add_draft_blocks', blocks });
  const base = nextCheckpointBase({
    checkpoint,
    planningState: store.getState(),
    action: 'promote_preview',
  });
  const nextCheckpoint: WeeklyPlanningResumableConversationCheckpoint = {
    ...base,
    turns: checkpoint.turns,
  };
  expect(nextCheckpoint.evaluation.stage).toBe('awaiting_approval');
  expect(nextCheckpoint.evaluation.terminal).toBe(false);
  writeOutputs({ checkpoint: nextCheckpoint, action: 'promote_preview' });
}

function savedPlanFromDraft(draft: PlanDraft, index: number): Plan {
  const now = new Date().toISOString();
  const id = `evaluation-plan-${index}`;
  return {
    ...draft,
    id,
    seriesId: id,
    createdAt: now,
    updatedAt: now,
  };
}

async function approveDraftsAction(
  checkpoint: WeeklyPlanningResumableConversationCheckpoint,
): Promise<void> {
  const store = createStore(checkpoint.planningState);
  if (!store.getState().draftBlocks.some((block) => block.status === 'draft')) {
    throw new Error('No draft blocks are available for approval.');
  }
  const savedPlans: Plan[] = [];
  await approveWeeklyPlanningDraftBlocks({
    userId: checkpoint.ownerId,
    plans: [],
    approvalOperations: [],
    saveWeeklyApprovedPlan: async (draft) => {
      const plan = savedPlanFromDraft(draft, savedPlans.length + 1);
      savedPlans.push(plan);
      return plan;
    },
    getState: store.getState,
    dispatch: store.dispatch,
    onOperationCompleted: () => undefined,
  });
  if (savedPlans.length === 0) {
    throw new Error('Approval completed without saved plan evidence.');
  }
  const base = nextCheckpointBase({
    checkpoint,
    planningState: store.getState(),
    action: 'approve_drafts',
    savedPlanIds: savedPlans.map((plan) => plan.id),
  });
  const nextCheckpoint: WeeklyPlanningResumableConversationCheckpoint = {
    ...base,
    turns: checkpoint.turns,
  };
  expect(nextCheckpoint.evaluation).toMatchObject({
    stage: 'completed_saved',
    terminal: true,
  });
  writeOutputs({
    checkpoint: nextCheckpoint,
    action: 'approve_drafts',
    savedPlans,
  });
}

const run = shouldRun ? describe : describe.skip;

run('weekly planning completion-based evaluation action', () => {
  it('restores the conversation and advances one explicit action toward terminal save', async () => {
    const action = evaluationAction();
    const checkpoint = loadCheckpoint(action);
    if (checkpoint.evaluation.terminal) {
      throw new Error('Evaluation is already terminal; no further action is allowed.');
    }
    hydrateCheckpointRuntime(checkpoint);

    if (action === 'submit_turn') {
      await submitTurnAction(checkpoint);
      return;
    }
    if (action === 'promote_preview') {
      promotePreviewAction(checkpoint);
      return;
    }
    await approveDraftsAction(checkpoint);
  }, resolveRealApiTurnTimeoutMs());
});
