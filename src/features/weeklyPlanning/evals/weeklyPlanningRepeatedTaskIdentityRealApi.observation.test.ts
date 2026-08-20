import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
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
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';

const shouldRun = process.env.WEEKLY_PLANNING_ISSUE156_REAL_API === '1';
const outputDir = process.env.WEEKLY_PLANNING_ISSUE156_OUTPUT_DIR
  ?? 'artifacts/weekly-planning-real-api';
const timeoutMs = Number(process.env.WEEKLY_PLANNING_ISSUE156_TIMEOUT_MS ?? '180000');

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

function activeFactIds(graph: NonNullable<ReturnType<typeof getWeeklyPlanningStableV5RuntimeSession>>['graph']) {
  return new Set(
    graph.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId),
  );
}

const run = shouldRun ? describe : describe.skip;

run('real API reproduction: repeated task-identity question', () => {
  it('accepts newly named work instead of repeatedly asking what to plan', async () => {
    const ownerId = 'repeated-task-identity-observation-user';
    const conversationId = 'repeated-task-identity-observation';
    const weekStartDate = '2026-08-17';
    const selectedDate = '2026-08-21';
    const userTurns = [
      '8/24〜29の予定を組みたい',
      'とりあえず飲み会が二個あるのとバイトがあるのと、合宿曲の練習しないといけない',
      'アプリ開発と学会用資料作成かな',
    ];

    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    clearWeeklyPlanningSessionRuntime();
    bindWeeklyPlanningStableV5RuntimeSessionScope({ ownerId, weekStartDate, conversationId });

    const store = createStore(createInitialPlanningState(weekStartDate));
    const session = createWeeklyPlanningControllerSession(ownerId, weekStartDate, conversationId);
    const services: WeeklyPlanningTurnApplicationServices = {
      submitControlledTurn: submitWeeklyPlanningControlledTurn,
      runtimeGateway: weeklyPlanningTurnRuntimeGateway,
      stagingLifecycle: weeklyPlanningTurnStagingLifecycle,
      outcomeLifecycle: {
        committed: () => undefined,
        discarded: () => undefined,
        failed: () => undefined,
      },
    };

    const observations: Array<Record<string, unknown>> = [];

    for (const userText of userTurns) {
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

      const runtime = getWeeklyPlanningStableV5RuntimeSession(conversationId);
      if (!runtime) throw new Error('Stable V5 runtime session missing');
      const activeIds = activeFactIds(runtime.graph);
      const activeTasks = runtime.graph.tasks.filter((task) => activeIds.has(task.id));
      const activeWorkloads = runtime.graph.workloads.filter((workload) => activeIds.has(workload.id));

      observations.push({
        userText,
        assistantText: store.getState().lastAssistantMessage,
        questionContext: store.getState().intakeState?.lastQuestionContext ?? null,
        activeTasks,
        activeWorkloads,
        graph: runtime.graph,
      });
    }

    mkdirSync(outputDir, { recursive: true });
    writeFileSync(
      `${outputDir}/repeated-task-identity-observation.json`,
      `${JSON.stringify(observations, null, 2)}\n`,
    );
    writeFileSync(
      `${outputDir}/repeated-task-identity-observation.md`,
      observations.map((turn, index) => [
        `## Turn ${index + 1}`,
        '',
        `User: ${String(turn.userText)}`,
        '',
        `Assistant: ${String(turn.assistantText ?? '')}`,
        '',
        `Question context: ${JSON.stringify(turn.questionContext)}`,
        '',
        `Active task count: ${(turn.activeTasks as unknown[]).length}`,
        '',
      ].join('\n')).join('\n'),
    );

    const final = observations[observations.length - 1];
    if (!final) throw new Error('final observation missing');
    const finalTasks = final.activeTasks as Array<{ title?: string }>;
    const normalizedTitles = finalTasks.map((task) => task.title?.replace(/\s+/g, '') ?? '');

    expect(finalTasks.length, JSON.stringify(observations, null, 2)).toBeGreaterThanOrEqual(2);
    expect(
      normalizedTitles.some((title) => title.includes('アプリ') || title.includes('開発')),
      JSON.stringify(normalizedTitles),
    ).toBe(true);
    expect(
      normalizedTitles.some((title) => title.includes('学会') || title.includes('資料')),
      JSON.stringify(normalizedTitles),
    ).toBe(true);
  }, timeoutMs);
});
