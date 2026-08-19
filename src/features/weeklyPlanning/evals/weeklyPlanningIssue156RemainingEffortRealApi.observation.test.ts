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
import { weeklyPlanningTurnRuntimeGateway } from '../application/weeklyPlanningTurnRuntimeGateway';
import { weeklyPlanningTurnStagingLifecycle } from '../application/weeklyPlanningTurnSideEffects';
import {
  submitWeeklyPlanningApplicationTurn,
  type WeeklyPlanningTurnApplicationServices,
} from '../application/weeklyPlanningTurnApplication';
import { clearWeeklyPlanningSessionRuntime } from '../planning/weeklyPlanningSessionRuntime';
import type { PlanningState, WeeklyPlanningAction } from '../types';
import {
  createWeeklyPlanningControllerSession,
  submitWeeklyPlanningControlledTurn,
} from '../weeklyPlanningTurnController';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutor';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';

const shouldRun = process.env.WEEKLY_PLANNING_ISSUE156_REAL_API === '1';
const outputDir = process.env.WEEKLY_PLANNING_ISSUE156_OUTPUT_DIR
  ?? 'artifacts/issue156-real-api';

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

const run = shouldRun ? describe : describe.skip;

run('Issue #156 remaining-effort real API gate', () => {
  it('binds explicit remaining duration to the remaining progress fact instead of completed progress or a minute workload', async () => {
    const ownerId = 'issue156-remaining-effort';
    const conversationId = 'issue156-remaining-effort';
    const weekStartDate = '2026-08-17';
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    clearWeeklyPlanningSessionRuntime();
    resetUserPlanningContextRuntimeForTestV1();
    bindWeeklyPlanningStableV5RuntimeSessionScope({ ownerId, weekStartDate, conversationId });

    const store = createStore(createInitialPlanningState(weekStartDate));
    const session = createWeeklyPlanningControllerSession(ownerId, weekStartDate, conversationId);
    let capturedResult: WeeklyPlanningTurnExecutionResult | null = null;
    const services: WeeklyPlanningTurnApplicationServices = {
      submitControlledTurn: submitWeeklyPlanningControlledTurn,
      runtimeGateway: {
        async execute(params) {
          capturedResult = await weeklyPlanningTurnRuntimeGateway.execute(params);
          return capturedResult;
        },
      },
      stagingLifecycle: weeklyPlanningTurnStagingLifecycle,
      outcomeLifecycle: {
        committed: () => undefined,
        discarded: () => undefined,
        failed: () => undefined,
      },
    };

    const transcript: Array<{
      user: string;
      assistant: string;
      questionContext: unknown;
    }> = [];
    for (const userText of [
      '明日の予定を立てたいです',
      'ゼミ発表の資料を完成させたいです',
      '完成を100%とすると、今は70%くらいです',
      '残りは45分くらいです',
    ]) {
      capturedResult = null;
      const submission = await submitWeeklyPlanningApplicationTurn({
        session,
        userId: ownerId,
        ownerId,
        userText,
        selectedDate: '2026-08-17',
        plans: [],
        scheduleTemplates: [],
        weekStartsOn: 'monday',
        getState: store.getState,
        dispatch: store.dispatch,
      }, services);
      expect(submission.accepted).toBe(true);
      if (capturedResult === null) throw new Error('runtime result missing');
      const result: WeeklyPlanningTurnExecutionResult = capturedResult;
      if (result.failure) {
        throw new Error(`${result.failure.code} ${result.failure.traceCode}`);
      }
      transcript.push({
        user: userText,
        assistant: store.getState().lastAssistantMessage ?? result.message,
        questionContext: store.getState().intakeState?.lastQuestionContext ?? null,
      });
    }

    const runtime = getWeeklyPlanningStableV5RuntimeSession(conversationId);
    if (!runtime) throw new Error('runtime session missing');
    const activeIds = new Set(runtime.graph.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId));
    const task = runtime.graph.tasks.find((fact) =>
      activeIds.has(fact.id) && fact.title.includes('ゼミ発表'));
    expect(task).toBeDefined();

    const taskWorkloads = runtime.graph.workloads.filter((fact) =>
      activeIds.has(fact.id) && fact.taskId === task?.id);
    const completed = taskWorkloads.find((fact) =>
      fact.quantityRole === 'completed'
      && fact.unitCode === 'custom'
      && fact.unitLabel === '%'
      && fact.amount === 70);
    const remaining = taskWorkloads.find((fact) =>
      fact.quantityRole === 'remaining'
      && fact.unitCode === 'custom'
      && fact.unitLabel === '%'
      && fact.amount === 30);
    expect(completed).toBeDefined();
    expect(remaining).toBeDefined();
    expect(taskWorkloads.some((fact) =>
      (fact.unitCode === 'minute' || fact.unitCode === 'hour')
      && fact.amount === 45)).toBe(false);

    const taskEfforts = runtime.graph.effortEstimates.filter((fact) =>
      activeIds.has(fact.id) && fact.taskId === task?.id);
    const remainingEffort = taskEfforts.find((fact) =>
      fact.kind === 'total_duration'
      && fact.minutes === 45
      && fact.targetFactId === remaining?.id);
    expect(remainingEffort).toBeDefined();
    expect(taskEfforts.some((fact) =>
      fact.kind === 'total_duration'
      && fact.minutes === 45
      && fact.targetFactId === completed?.id)).toBe(false);

    mkdirSync(outputDir, { recursive: true });
    writeFileSync(
      `${outputDir}/remaining-effort-conversation.json`,
      `${JSON.stringify({ transcript, graph: runtime.graph }, null, 2)}\n`,
    );
    writeFileSync(
      `${outputDir}/remaining-effort-conversation.md`,
      transcript.flatMap((turn, index) => [
        `## Turn ${index + 1}`,
        '',
        `ユーザー: ${turn.user}`,
        '',
        `アプリ: ${turn.assistant}`,
        '',
        `machine question: ${JSON.stringify(turn.questionContext)}`,
        '',
      ]).join('\n'),
    );
  }, 240_000);
});
