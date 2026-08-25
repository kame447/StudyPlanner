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
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';

const shouldRun = process.env.WEEKLY_PLANNING_ISSUE156_REAL_API === '1';
const outputDir = process.env.WEEKLY_PLANNING_ISSUE156_OUTPUT_DIR
  ?? 'artifacts/issue156-real-api';
const timeoutMs = Number(process.env.WEEKLY_PLANNING_ISSUE156_TIMEOUT_MS ?? '300000');

interface Observation {
  name: string;
  userText: string;
  assistantText: string;
  questionContext: unknown;
  graph: WeeklyPlanningFactGraphV5;
  draftCandidateCount: number;
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

function activeIds(graph: WeeklyPlanningFactGraphV5): Set<string> {
  return new Set(graph.factLifecycles
    .filter((entry) => entry.status === 'active')
    .map((entry) => entry.factId));
}

function activeWorkloads(graph: WeeklyPlanningFactGraphV5) {
  const ids = activeIds(graph);
  return graph.workloads.filter((fact) => ids.has(fact.id));
}

function activeRecurrences(graph: WeeklyPlanningFactGraphV5) {
  const ids = activeIds(graph);
  return graph.recurrences.filter((fact) => ids.has(fact.id));
}

function timeAmountMinutes(workload: WeeklyPlanningFactGraphV5['workloads'][number]): number | null {
  if (workload.unitCode === 'minute') return workload.amount;
  if (workload.unitCode === 'hour') return workload.amount * 60;
  return null;
}

function machineQuestionCode(context: unknown): string | null {
  if (
    typeof context !== 'object'
    || context === null
    || !('targetSlot' in context)
    || typeof context.targetSlot !== 'string'
  ) return null;
  return context.targetSlot.startsWith('stable_v5:')
    ? context.targetSlot.slice('stable_v5:'.length)
    : null;
}

function asksForContentProgress(text: string): boolean {
  return /完成を?100%|何%|進捗|どこまで|何ページ|何語|何問|全体の範囲|残り.{0,8}(ページ|語|問)/.test(text);
}

async function singleTurn(params: {
  name: string;
  userText: string;
}): Promise<Observation> {
  const weekStartDate = '2026-08-24';
  const ownerId = `issue156-timebox-${params.name}`;
  const conversationId = `issue156-timebox-${params.name}`;

  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  clearWeeklyPlanningSessionRuntime();
  resetUserPlanningContextRuntimeForTestV1();
  bindWeeklyPlanningStableV5RuntimeSessionScope({
    ownerId,
    weekStartDate,
    conversationId,
  });

  const store = createStore(createInitialPlanningState(weekStartDate));
  const session = createWeeklyPlanningControllerSession(
    ownerId,
    weekStartDate,
    conversationId,
  );
  let capturedResult: WeeklyPlanningTurnExecutionResult | null = null;
  const services: WeeklyPlanningTurnApplicationServices = {
    submitControlledTurn: submitWeeklyPlanningControlledTurn,
    runtimeGateway: {
      async execute(runtimeParams) {
        capturedResult = await weeklyPlanningTurnRuntimeGateway.execute(runtimeParams);
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

  const submission = await submitWeeklyPlanningApplicationTurn({
    session,
    userId: ownerId,
    ownerId,
    userText: params.userText,
    selectedDate: '2026-08-26',
    plans: [],
    scheduleTemplates: [],
    weekStartsOn: 'monday',
    getState: store.getState,
    dispatch: store.dispatch,
  }, services);

  expect(submission.accepted, params.name).toBe(true);
  if (capturedResult === null) throw new Error(`${params.name}: runtime result missing`);
  const result: WeeklyPlanningTurnExecutionResult = capturedResult;
  if (result.failure) {
    throw new Error(`${params.name}: ${result.failure.code} ${result.failure.traceCode}`);
  }
  const runtime = getWeeklyPlanningStableV5RuntimeSession(conversationId);
  if (!runtime) throw new Error(`${params.name}: runtime session missing`);

  return {
    name: params.name,
    userText: params.userText,
    assistantText: store.getState().lastAssistantMessage ?? result.message,
    questionContext: store.getState().intakeState?.lastQuestionContext ?? null,
    graph: structuredClone(runtime.graph),
    draftCandidateCount: result.draftCandidates.length,
  };
}

function expectDirectTimebox(params: {
  observation: Observation;
  expectedMinutes: number;
  expectedRecurrence?: 'daily' | 'weekdays' | null;
  expectedRole?: 'target' | 'remaining';
}): void {
  const { observation } = params;
  expect(
    machineQuestionCode(observation.questionContext),
    `${observation.name}: ${observation.assistantText}`,
  ).toBeNull();
  expect(
    asksForContentProgress(observation.assistantText),
    `${observation.name}: ${observation.assistantText}`,
  ).toBe(false);
  expect(observation.draftCandidateCount, observation.name).toBeGreaterThan(0);

  const timeWorkloads = activeWorkloads(observation.graph).filter((workload) =>
    timeAmountMinutes(workload) === params.expectedMinutes
    && workload.quantityRole !== 'completed'
    && workload.quantityRole !== 'scope_total');
  expect(timeWorkloads, observation.name).not.toHaveLength(0);
  if (params.expectedRole) {
    expect(timeWorkloads.some((workload) => workload.quantityRole === params.expectedRole), observation.name)
      .toBe(true);
  }

  if (params.expectedRecurrence) {
    expect(timeWorkloads.some((workload) => workload.perOccurrence), observation.name).toBe(true);
    expect(
      activeRecurrences(observation.graph).some(
        (recurrence) => recurrence.kind === params.expectedRecurrence,
      ),
      observation.name,
    ).toBe(true);
  }
}

const run = shouldRun ? describe : describe.skip;

run('Issue #156 timeboxed planning overasking real API gate', () => {
  it('does not ask progress when time already determines the plan', async () => {
    const observations = [
      await singleTurn({
        name: 'gold-frase-daily-hour',
        userText: '明日から9/7までTOEIC対策に金フレをやりたいです。1日1時間やりたいです',
      }),
      await singleTurn({
        name: 'reading-daily-thirty',
        userText: '8/27から9/7まで、毎日30分だけ本を読みたいです。読み切れなくても大丈夫です',
      }),
      await singleTurn({
        name: 'thesis-three-hours',
        userText: '明日は卒論を3時間進めたいです。内容の区切りは決めなくて大丈夫です',
      }),
      await singleTurn({
        name: 'vocabulary-weekdays',
        userText: '8/27から9/4までの平日は、英単語を45分ずつやりたいです',
      }),
      await singleTurn({
        name: 'report-remaining-two-hours',
        userText: '明日はレポートの残り2時間ぶんの作業を終わらせたいです',
      }),
    ];

    expectDirectTimebox({
      observation: observations[0],
      expectedMinutes: 60,
      expectedRecurrence: 'daily',
      expectedRole: 'target',
    });
    expectDirectTimebox({
      observation: observations[1],
      expectedMinutes: 30,
      expectedRecurrence: 'daily',
      expectedRole: 'target',
    });
    expectDirectTimebox({
      observation: observations[2],
      expectedMinutes: 180,
      expectedRecurrence: null,
      expectedRole: 'target',
    });
    expectDirectTimebox({
      observation: observations[3],
      expectedMinutes: 45,
      expectedRecurrence: 'weekdays',
      expectedRole: 'target',
    });
    expectDirectTimebox({
      observation: observations[4],
      expectedMinutes: 120,
      expectedRecurrence: null,
      expectedRole: 'remaining',
    });

    mkdirSync(outputDir, { recursive: true });
    writeFileSync(
      `${outputDir}/timebox-overasking.json`,
      `${JSON.stringify(observations, null, 2)}\n`,
    );
  }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 300_000);
});
