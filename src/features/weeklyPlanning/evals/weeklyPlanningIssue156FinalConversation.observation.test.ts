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
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';

const shouldRun = process.env.WEEKLY_PLANNING_ISSUE156_REAL_API === '1';
const outputDir = process.env.WEEKLY_PLANNING_ISSUE156_OUTPUT_DIR
  ?? 'artifacts/issue156-real-api';

interface ObservedTurn {
  index: number;
  userText: string;
  assistantText: string;
  responseSource: string | null;
  questionContext: unknown;
  graph: WeeklyPlanningFactGraphV5;
  requestId: string;
  debugTrace: unknown[];
}

interface ConversationObservation {
  name: string;
  turns: ObservedTurn[];
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

function activeEfforts(graph: WeeklyPlanningFactGraphV5) {
  const ids = activeIds(graph);
  return graph.effortEstimates.filter((fact) => ids.has(fact.id));
}

function questionCode(turn: ObservedTurn): string | null {
  const context = turn.questionContext;
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

function hasClockAck(text: string): boolean {
  const compact = text.replace(/\s+/g, '');
  return (compact.includes('14:30') || compact.includes('14時30分') || compact.includes('14時半'))
    && (compact.includes('20:00') || compact.includes('20時'));
}

function hasDeadlineAck(text: string): boolean {
  const compact = text.replace(/\s+/g, '');
  return compact.includes('13:00') || compact.includes('13時');
}

function hasProgressExplanation(text: string): boolean {
  return /進捗|進み|どこまで|完成|100%|何%/.test(text);
}

function inventsBoundedUnit(text: string): boolean {
  return /何\s*枚|何\s*ページ|何\s*問|全部で.{0,10}(枚|ページ|問)|全体で.{0,10}(枚|ページ|問)/.test(text);
}

async function conversation(params: {
  name: string;
  ownerId: string;
  conversationId: string;
  userTurns: string[];
}): Promise<ConversationObservation> {
  const weekStartDate = '2026-08-17';
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  resetWeeklyPlanningStableV5DebugTraceForTest();
  clearWeeklyPlanningSessionRuntime();
  resetUserPlanningContextRuntimeForTestV1();
  bindWeeklyPlanningStableV5RuntimeSessionScope({
    ownerId: params.ownerId,
    weekStartDate,
    conversationId: params.conversationId,
  });

  const store = createStore(createInitialPlanningState(weekStartDate));
  const session = createWeeklyPlanningControllerSession(
    params.ownerId,
    weekStartDate,
    params.conversationId,
  );
  let capturedResult: WeeklyPlanningTurnExecutionResult | null = null;
  let capturedRequestId: string | null = null;
  const services: WeeklyPlanningTurnApplicationServices = {
    submitControlledTurn: submitWeeklyPlanningControlledTurn,
    runtimeGateway: {
      async execute(runtimeParams) {
        capturedRequestId = runtimeParams.pending.requestId;
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

  const turns: ObservedTurn[] = [];
  for (let index = 0; index < params.userTurns.length; index += 1) {
    capturedResult = null;
    capturedRequestId = null;
    const userText = params.userTurns[index];
    const submission = await submitWeeklyPlanningApplicationTurn({
      session,
      userId: params.ownerId,
      ownerId: params.ownerId,
      userText,
      selectedDate: '2026-08-17',
      plans: [],
      scheduleTemplates: [],
      weekStartsOn: 'monday',
      getState: store.getState,
      dispatch: store.dispatch,
    }, services);
    expect(submission.accepted, `${params.name} turn ${index + 1}`).toBe(true);
    if (capturedResult === null || capturedRequestId === null) {
      throw new Error(`${params.name} turn ${index + 1} did not produce a runtime result`);
    }
    const result: WeeklyPlanningTurnExecutionResult = capturedResult;
    const requestId: string = capturedRequestId;
    if (result.failure) {
      throw new Error(`${params.name} turn ${index + 1}: ${result.failure.code} ${result.failure.traceCode}`);
    }
    const runtime = getWeeklyPlanningStableV5RuntimeSession(params.conversationId);
    if (!runtime) throw new Error(`${params.name} turn ${index + 1}: runtime missing`);
    turns.push({
      index: index + 1,
      userText,
      assistantText: store.getState().lastAssistantMessage ?? result.message,
      responseSource: result.responseSource ?? null,
      questionContext: store.getState().intakeState?.lastQuestionContext ?? null,
      graph: structuredClone(runtime.graph),
      requestId,
      debugTrace: takeWeeklyPlanningStableV5DebugTrace(requestId),
    });
  }
  return { name: params.name, turns };
}

function markdown(conversations: ConversationObservation[]): string {
  return conversations.flatMap((item) => [
    `# ${item.name}`,
    '',
    ...item.turns.flatMap((turn) => [
      `## Turn ${turn.index}`,
      '',
      `ユーザー: ${turn.userText}`,
      '',
      `アプリ: ${turn.assistantText}`,
      '',
      `machine question: ${JSON.stringify(turn.questionContext)}`,
      '',
      `response source: ${turn.responseSource ?? 'unknown'}`,
      '',
    ]),
  ]).join('\n');
}

const run = shouldRun ? describe : describe.skip;

run('Issue #156 final real API conversation gate', () => {
  it('keeps adaptive progress, grounding, corrections, effort measurement, and execution state coherent', async () => {
    const observations: ConversationObservation[] = [];

    observations.push(await conversation({
      name: 'A open-ended slides with fixed event interruption',
      ownerId: 'issue156-final-a',
      conversationId: 'issue156-final-a',
      userTurns: [
        '明日の予定を立てたいです',
        '夏合宿の発表スライドを完成させたいです',
        'その前に、14時半から20時まではバイトです',
        '完成を100%とすると、今はだいたい60%くらいです',
        '残りはだいたい2時間くらいかかりそうです',
      ],
    }));

    observations.push(await conversation({
      name: 'B open-ended report with deadline side update',
      ownerId: 'issue156-final-b',
      conversationId: 'issue156-final-b',
      userTurns: [
        '明日の予定を立てたいです',
        '研究室のレポートを仕上げたいです',
        '締切は明日の13時です',
        '完成を100%とすると、今は50%くらいです',
        '残りは1時間半くらいです',
      ],
    }));

    observations.push(await conversation({
      name: 'C explicitly bounded slides correction plus alternate effort measurement',
      ownerId: 'issue156-final-c',
      conversationId: 'issue156-final-c',
      userTurns: [
        '明日の予定を立てたいです',
        '夏合宿のスライドは全部20枚で、今10枚までできています。明日残りを終わらせたいです',
        '訂正です、今は12枚までできています',
        '1枚あたりだいたい8分くらいです',
      ],
    }));

    observations.push(await conversation({
      name: 'D open-ended clarification must explain progress request',
      ownerId: 'issue156-final-d',
      conversationId: 'issue156-final-d',
      userTurns: [
        '明日の予定を立てたいです',
        'ゼミ発表の資料を完成させたいです',
        '何を教えればいいってこと？',
        '完成を100%とすると、今は70%くらいです',
        '残りは45分くらいです',
      ],
    }));

    mkdirSync(outputDir, { recursive: true });
    writeFileSync(`${outputDir}/final-conversations.md`, `# Issue #156 Final Conversations\n\n${markdown(observations)}\n`);
    writeFileSync(`${outputDir}/final-conversations.json`, `${JSON.stringify(observations, null, 2)}\n`);

    const a = observations[0].turns;
    expect(questionCode(a[1])).toBe('missing_schedulable_work');
    expect(inventsBoundedUnit(a[1].assistantText), a[1].assistantText).toBe(false);
    expect(hasProgressExplanation(a[1].assistantText), a[1].assistantText).toBe(true);
    expect(questionCode(a[2])).toBe('missing_schedulable_work');
    expect(hasClockAck(a[2].assistantText), a[2].assistantText).toBe(true);
    expect(inventsBoundedUnit(a[2].assistantText), a[2].assistantText).toBe(false);
    const aProgress = activeWorkloads(a[3].graph);
    expect(aProgress).toEqual(expect.arrayContaining([
      expect.objectContaining({ quantityRole: 'completed', amount: 60, unitCode: 'custom', unitLabel: '%' }),
      expect.objectContaining({ quantityRole: 'remaining', amount: 40, unitCode: 'custom', unitLabel: '%' }),
    ]));
    expect(questionCode(a[3])).toBe('missing_effort_estimate');
    expect(activeEfforts(a[3].graph)).toHaveLength(0);
    expect(activeEfforts(a[4].graph)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'total_duration', minutes: 120 }),
    ]));

    const b = observations[1].turns;
    expect(questionCode(b[1])).toBe('missing_schedulable_work');
    expect(inventsBoundedUnit(b[1].assistantText), b[1].assistantText).toBe(false);
    expect(questionCode(b[2])).toBe('missing_schedulable_work');
    expect(hasDeadlineAck(b[2].assistantText), b[2].assistantText).toBe(true);
    expect(b[2].assistantText).not.toMatch(/どんな作業|工程/);
    expect(inventsBoundedUnit(b[2].assistantText), b[2].assistantText).toBe(false);
    const bProgress = activeWorkloads(b[3].graph);
    expect(bProgress).toEqual(expect.arrayContaining([
      expect.objectContaining({ quantityRole: 'completed', amount: 50, unitCode: 'custom', unitLabel: '%' }),
      expect.objectContaining({ quantityRole: 'remaining', amount: 50, unitCode: 'custom', unitLabel: '%' }),
    ]));

    const c = observations[2].turns;
    expect(c[2].assistantText).toMatch(/12\s*枚/);
    const correctedWorkloads = activeWorkloads(c[2].graph);
    expect(correctedWorkloads).toEqual(expect.arrayContaining([
      expect.objectContaining({ quantityRole: 'completed', amount: 12 }),
      expect.objectContaining({ quantityRole: 'remaining', amount: 8 }),
    ]));
    expect(correctedWorkloads).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ quantityRole: 'remaining', amount: 10 }),
    ]));
    const finalWorkloads = activeWorkloads(c[3].graph);
    const completedTwelve = finalWorkloads.filter((workload) =>
      workload.quantityRole === 'completed' && workload.amount === 12);
    expect(completedTwelve).toHaveLength(1);
    const finalEfforts = activeEfforts(c[3].graph);
    const perUnitEight = finalEfforts.find((effort) =>
      effort.kind === 'duration_per_unit' && effort.minutes === 8);
    expect(perUnitEight).toBeDefined();
    expect(perUnitEight?.taskId).toBe(completedTwelve[0].taskId);
    expect(finalEfforts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'total_duration', minutes: 8 }),
    ]));
    expect(c[3].assistantText).not.toMatch(/残り\s*10\s*枚/);

    const d = observations[3].turns;
    expect(hasProgressExplanation(d[2].assistantText), d[2].assistantText).toBe(true);
    expect(inventsBoundedUnit(d[2].assistantText), d[2].assistantText).toBe(false);
    expect(d[2].assistantText.replace(/\s+/g, '')).not.toBe(d[1].assistantText.replace(/\s+/g, ''));
    const dProgress = activeWorkloads(d[3].graph);
    expect(dProgress).toEqual(expect.arrayContaining([
      expect.objectContaining({ quantityRole: 'completed', amount: 70, unitCode: 'custom', unitLabel: '%' }),
      expect.objectContaining({ quantityRole: 'remaining', amount: 30, unitCode: 'custom', unitLabel: '%' }),
    ]));
  }, 420_000);
});
