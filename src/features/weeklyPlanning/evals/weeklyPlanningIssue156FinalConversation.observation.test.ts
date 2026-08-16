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
  questionContext: PlanningState['lastQuestionContext'];
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
  const slot = turn.questionContext?.targetSlot;
  return slot?.startsWith('stable_v5:') ? slot.slice('stable_v5:'.length) : null;
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

function hasRangeAndProgressExplanation(text: string): boolean {
  return /全体|範囲/.test(text) && /進捗|どこまで|今|現在/.test(text);
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
  it('keeps grounding, question meaning, corrections, effort measurement, and execution state coherent', async () => {
    const observations: ConversationObservation[] = [];

    observations.push(await conversation({
      name: 'A fixed event while workload detail remains pending',
      ownerId: 'issue156-final-a',
      conversationId: 'issue156-final-a',
      userTurns: [
        '明日の予定を立てたいです',
        '夏合宿の発表スライドを完成させたいです',
        'その前に、14時半から20時まではバイトです',
        'スライドは全部で20枚で、今10枚まで終わっています',
      ],
    }));

    observations.push(await conversation({
      name: 'B deadline side update',
      ownerId: 'issue156-final-b',
      conversationId: 'issue156-final-b',
      userTurns: [
        '明日の予定を立てたいです',
        '研究室のレポートを仕上げたいです',
        '締切は明日の13時です',
        '全体で12ページで、今6ページまで書けています',
      ],
    }));

    observations.push(await conversation({
      name: 'C correction plus alternate effort measurement',
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
      name: 'D clarification must explain all requested information',
      ownerId: 'issue156-final-d',
      conversationId: 'issue156-final-d',
      userTurns: [
        '明日の予定を立てたいです',
        'ゼミ発表の資料を完成させたいです',
        '何を教えればいいってこと？',
        '全部で15枚あって、今7枚までできています',
      ],
    }));

    mkdirSync(outputDir, { recursive: true });
    writeFileSync(`${outputDir}/final-conversations.md`, `# Issue #156 Final Conversations\n\n${markdown(observations)}\n`);
    writeFileSync(`${outputDir}/final-conversations.json`, `${JSON.stringify(observations, null, 2)}\n`);

    const a = observations[0].turns;
    expect(questionCode(a[2])).toBe('missing_schedulable_work');
    expect(hasClockAck(a[2].assistantText), a[2].assistantText).toBe(true);

    const b = observations[1].turns;
    expect(questionCode(b[2])).toBe('missing_schedulable_work');
    expect(hasDeadlineAck(b[2].assistantText), b[2].assistantText).toBe(true);
    expect(b[2].assistantText).not.toMatch(/どんな作業|工程/);
    expect(b[1].assistantText).not.toMatch(/予定.{0,20}入れます/);

    const c = observations[2].turns;
    expect(c[2].assistantText).toMatch(/12\s*枚/);
    const correctedWorkloads = activeWorkloads(c[2].graph);
    expect(correctedWorkloads).toEqual(expect.arrayContaining([
      expect.objectContaining({ quantityRole: 'completed', amount: 12 }),
      expect.objectContaining({ quantityRole: 'remaining', amount: 8 }),
      expect.objectContaining({ quantityRole: 'target', amount: 8, periodExpression: 'tomorrow' }),
    ]));
    expect(correctedWorkloads).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ quantityRole: 'remaining', amount: 10 }),
      expect.objectContaining({ quantityRole: 'target', amount: 10 }),
    ]));
    const finalEfforts = activeEfforts(c[3].graph);
    expect(finalEfforts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'duration_per_unit', minutes: 8 }),
    ]));
    expect(finalEfforts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'total_duration', minutes: 8 }),
    ]));
    expect(c[3].assistantText).not.toMatch(/残り\s*10\s*枚/);

    const d = observations[3].turns;
    expect(hasRangeAndProgressExplanation(d[2].assistantText), d[2].assistantText).toBe(true);
    expect(d[2].assistantText.replace(/\s+/g, '')).not.toBe(d[1].assistantText.replace(/\s+/g, ''));
  }, 420_000);
});
