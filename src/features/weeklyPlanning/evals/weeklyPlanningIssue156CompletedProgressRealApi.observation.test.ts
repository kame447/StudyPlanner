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

function questionTopicId(context: unknown): string | null {
  if (typeof context !== 'object' || context === null || !('topicId' in context)) return null;
  return typeof context.topicId === 'string' ? context.topicId : null;
}

const run = shouldRun ? describe : describe.skip;

run('Issue #156 completed open-ended progress real API gate', () => {
  it('does not ask the same task for progress again after the user says it is 100 percent complete', async () => {
    const ownerId = 'issue156-completed-progress';
    const conversationId = 'issue156-completed-progress';
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
      '夏合宿の発表スライドを完成させたいです',
      '完成を100%とすると、もう100%終わっています',
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
      activeIds.has(fact.id) && fact.title.includes('夏合宿'));
    expect(task).toBeDefined();
    const completedHundred = runtime.graph.workloads.find((fact) =>
      activeIds.has(fact.id)
      && fact.taskId === task?.id
      && fact.quantityRole === 'completed'
      && fact.unitCode === 'custom'
      && fact.unitLabel === '%'
      && fact.amount === 100);
    expect(completedHundred).toBeDefined();
    expect(runtime.graph.workloads.some((fact) =>
      activeIds.has(fact.id)
      && fact.taskId === task?.id
      && fact.quantityRole === 'remaining'
      && fact.unitLabel === '%')).toBe(false);

    const finalTurn = transcript[2];
    expect(questionTopicId(finalTurn.questionContext)).not.toBe(task?.id);
    expect(finalTurn.assistant.replace(/\s+/g, '')).not.toMatch(/夏合宿.{0,30}(何%|100%とすると|どこまで)/);

    mkdirSync(outputDir, { recursive: true });
    writeFileSync(
      `${outputDir}/completed-progress-conversation.json`,
      `${JSON.stringify({ transcript, graph: runtime.graph }, null, 2)}\n`,
    );
    writeFileSync(
      `${outputDir}/completed-progress-conversation.md`,
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
  }, 180_000);
});
