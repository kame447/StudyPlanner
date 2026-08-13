import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  resetUserPlanningContextRuntimeForTestV1,
} from '../../userPlanningContext/userPlanningContextSpace';
import {
  bindWeeklyPlanningStableV5RuntimeSessionScope,
  getWeeklyPlanningStableV5RuntimeSession,
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
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
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

const shouldRun = process.env.WEEKLY_PLANNING_FULL_REAL_API_CONVERSATION === '1';
const outputDir = process.env.WEEKLY_PLANNING_FULL_CONVERSATION_OUTPUT_DIR
  ?? 'artifacts/weekly-planning-full-conversation';
const DEFAULT_TIMEOUT_MS = 90_000;

interface ObservedTurn {
  index: number;
  userText: string;
  assistantText: string;
  requestId: string;
  graphRevision: number;
  previewCandidateCount: number;
  trace: unknown[];
}

interface TurnCapture {
  result: WeeklyPlanningTurnExecutionResult | null;
  requestId: string | null;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function timeoutMs(): number {
  const configured = Number(process.env.WEEKLY_PLANNING_FULL_CONVERSATION_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_TIMEOUT_MS;
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

function requireCapturedTurn(
  capture: TurnCapture,
  index: number,
): { result: WeeklyPlanningTurnExecutionResult; requestId: string } {
  if (!capture.result || !capture.requestId) {
    throw new Error(`Turn ${index} did not expose execution diagnostics.`);
  }
  return {
    result: capture.result,
    requestId: capture.requestId,
  };
}

function minutesFromTime(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function overlaps(params: {
  startTime: string;
  endTime: string;
  blockedStart: string;
  blockedEnd: string;
}): boolean {
  return minutesFromTime(params.startTime) < minutesFromTime(params.blockedEnd)
    && minutesFromTime(params.blockedStart) < minutesFromTime(params.endTime);
}

function nextUserReply(params: {
  state: PlanningState;
  conversationId: string;
}): string {
  const question = params.state.intakeState?.lastQuestionContext;
  if (!question) {
    throw new Error('Conversation did not produce preview or a machine question.');
  }
  if (question.targetSlot !== 'stable_v5:missing_effort_estimate' || !question.topicId) {
    throw new Error(
      `Unexpected machine question: ${JSON.stringify(question)}`,
    );
  }

  const runtime = getWeeklyPlanningStableV5RuntimeSession(params.conversationId);
  if (!runtime) throw new Error('Stable V5 runtime session disappeared.');
  const workload = runtime.graph.workloads.find((fact) => fact.id === question.topicId);
  if (!workload) {
    throw new Error(`Pending workload ${question.topicId} is absent from the Fact Graph.`);
  }

  if (workload.unitCode === 'problem') return '8分くらいです。';
  if (workload.unitCode === 'word') return '30分くらいです。';

  throw new Error(
    `No test-driver answer is defined for pending unit ${workload.unitCode}.`,
  );
}

function writeFailureOutput(params: {
  turnIndex: number;
  userText: string;
  requestId: string;
  result: WeeklyPlanningTurnExecutionResult;
  trace: unknown[];
  turns: ObservedTurn[];
  state: PlanningState;
  graph: WeeklyPlanningFactGraphV5 | null;
}): void {
  mkdirSync(outputDir, { recursive: true });
  const payload = {
    turnIndex: params.turnIndex,
    userText: params.userText,
    requestId: params.requestId,
    failure: params.result.failure ?? null,
    result: params.result,
    priorTurns: params.turns,
    planningState: params.state,
    graph: params.graph,
    trace: params.trace,
  };
  writeFileSync(`${outputDir}/failure.json`, `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(`${outputDir}/transcript.md`, [
    '# Weekly Planning Full Real API Conversation — Failure',
    '',
    ...params.turns.flatMap((turn) => [
      `## Turn ${turn.index}`,
      '',
      `ユーザー: ${turn.userText}`,
      '',
      `アプリ: ${turn.assistantText}`,
      '',
    ]),
    `## Failed Turn ${params.turnIndex}`,
    '',
    `ユーザー: ${params.userText}`,
    '',
    `Failure: ${params.result.failure?.code ?? 'unknown'}`,
    '',
  ].join('\n'));
  console.log('--- FULL CONVERSATION FAILURE DIAGNOSTICS ---');
  console.log(JSON.stringify(payload, null, 2));
}

function writeOutputs(params: {
  turns: ObservedTurn[];
  state: PlanningState;
  graph: WeeklyPlanningFactGraphV5;
}): void {
  mkdirSync(outputDir, { recursive: true });
  const transcript = params.turns.flatMap((turn) => [
    `## Turn ${turn.index}`,
    '',
    `ユーザー: ${turn.userText}`,
    '',
    `アプリ: ${turn.assistantText}`,
    '',
  ]).join('\n');
  writeFileSync(`${outputDir}/transcript.md`, [
    '# Weekly Planning Full Real API Conversation',
    '',
    transcript,
  ].join('\n'));
  writeFileSync(`${outputDir}/result.json`, `${JSON.stringify({
    turns: params.turns,
    graphRevision: params.graph.revision,
    effortEstimates: params.graph.effortEstimates,
    availabilityDeclarations: params.graph.availabilityDeclarations,
    previewCandidates: params.state.previewCandidates ?? [],
    draftGenerationIntent: params.state.intakeState?.draftGenerationIntent ?? null,
  }, null, 2)}\n`);
}

const run = shouldRun ? describe : describe.skip;

run('weekly planning full real API conversation', () => {
  it('runs one production conversation from request through clarifications to preview', async () => {
    const ownerId = requiredEnv('WEEKLY_PLANNING_FULL_CONVERSATION_OWNER_ID');
    const conversationId = requiredEnv('WEEKLY_PLANNING_FULL_CONVERSATION_ID');
    const weekStartDate = requiredEnv('WEEKLY_PLANNING_FULL_CONVERSATION_WEEK_START_DATE');
    const selectedDate = requiredEnv('WEEKLY_PLANNING_FULL_CONVERSATION_SELECTED_DATE');
    const initialUserText = requiredEnv('WEEKLY_PLANNING_FULL_CONVERSATION_INITIAL_USER_TEXT');

    resetRuntime();
    bindWeeklyPlanningStableV5RuntimeSessionScope({ ownerId, weekStartDate, conversationId });
    const store = createStore(createInitialPlanningState(weekStartDate));
    const session = createWeeklyPlanningControllerSession(ownerId, weekStartDate, conversationId);
    const turns: ObservedTurn[] = [];

    const capture: TurnCapture = { result: null, requestId: null };
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

    let userText = initialUserText;
    const maxTurns = 6;
    for (let index = 1; index <= maxTurns; index += 1) {
      capture.result = null;
      capture.requestId = null;
      const submission = await submitWeeklyPlanningApplicationTurn({
        session,
        userId: ownerId,
        ownerId,
        userText,
        selectedDate,
        plans: [],
        scheduleTemplates: [],
        weekStartsOn: 'monday',
        getState: store.getState,
        dispatch: store.dispatch,
      }, services);

      expect(submission.accepted).toBe(true);
      const { result, requestId } = requireCapturedTurn(capture, index);
      const trace = takeWeeklyPlanningStableV5DebugTrace(requestId);
      if (result.failure) {
        const runtime = getWeeklyPlanningStableV5RuntimeSession(conversationId);
        writeFailureOutput({
          turnIndex: index,
          userText,
          requestId,
          result,
          trace,
          turns,
          state: store.getState(),
          graph: runtime?.graph ?? null,
        });
        throw new Error(
          `Turn ${index} failed: ${result.failure.code} ${result.failure.traceCode}`,
        );
      }
      const assistantText = store.getState().lastAssistantMessage ?? '';
      if (!assistantText.trim()) throw new Error(`Turn ${index} assistant response was empty.`);
      const runtime = getWeeklyPlanningStableV5RuntimeSession(conversationId);
      if (!runtime) throw new Error(`Turn ${index} runtime session disappeared.`);
      turns.push({
        index,
        userText,
        assistantText,
        requestId,
        graphRevision: runtime.graph.revision,
        previewCandidateCount: store.getState().previewCandidates?.length ?? 0,
        trace,
      });

      if ((store.getState().previewCandidates?.length ?? 0) > 0) break;
      userText = nextUserReply({ state: store.getState(), conversationId });
    }

    const finalState = store.getState();
    const runtime = getWeeklyPlanningStableV5RuntimeSession(conversationId);
    if (!runtime) throw new Error('Stable V5 runtime session disappeared after conversation.');
    const candidates = finalState.previewCandidates ?? [];

    expect(turns.length).toBeGreaterThan(1);
    expect(turns.length).toBeLessThanOrEqual(6);
    expect(candidates).toHaveLength(14);
    expect(finalState.intakeState?.draftGenerationIntent).toBe('user_authorized');
    expect(runtime.graph.effortEstimates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'duration_per_unit',
        minutes: 8,
        unitCode: 'problem',
      }),
      expect.objectContaining({
        kind: 'session_duration',
        minutes: 30,
        unitCode: 'word',
      }),
    ]));
    expect(runtime.graph.availabilityDeclarations).toEqual([
      expect.objectContaining({
        kind: 'unavailable',
        dateExpression: 'weekday:tuesday',
        startTime: '18:00',
        endTime: '20:00',
        constraintLevel: 'hard',
      }),
    ]);

    const vocabulary = candidates.filter((candidate) => candidate.field === '英単語');
    const math = candidates.filter((candidate) => candidate.field === '数学');
    expect(vocabulary).toHaveLength(9);
    expect(vocabulary.filter((candidate) => candidate.title.includes('復習'))).toHaveLength(6);
    expect(math).toHaveLength(5);
    expect(math.every((candidate) => candidate.title.includes('8問'))).toBe(true);

    const tuesdayCandidates = candidates.filter((candidate) => candidate.date === '2026-08-18');
    expect(tuesdayCandidates.every((candidate) => !overlaps({
      startTime: candidate.startTime,
      endTime: candidate.endTime,
      blockedStart: '18:00',
      blockedEnd: '20:00',
    }))).toBe(true);

    writeOutputs({ turns, state: finalState, graph: runtime.graph });
  }, timeoutMs());
});
