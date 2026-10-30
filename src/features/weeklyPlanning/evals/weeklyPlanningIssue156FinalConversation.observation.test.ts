import { createReadyPlannerDataAvailability } from '../testUtils/plannerDataAvailabilityTest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import {
  questionIntentFromRendererCapture,
  hasAcceptedBusyInterval,
  hasTomorrowOnePmDeadline,
  runIndependentEvalCases,
  withRendererInputCapture,
} from './testUtils/issue881IndependentEval';
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

const rendererInputCaptures = vi.hoisted(() => [] as unknown[]);

vi.mock('../dialogue/weeklyPlanningStableV5AiDialogueRenderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../dialogue/weeklyPlanningStableV5AiDialogueRenderer')>();
  return {
    ...actual,
    createAiWeeklyPlanningStableV5DialogueRenderer(...args: Parameters<typeof actual.createAiWeeklyPlanningStableV5DialogueRenderer>) {
      const renderer = actual.createAiWeeklyPlanningStableV5DialogueRenderer(...args);
      return withRendererInputCapture({
        renderer,
        capture(input) { rendererInputCaptures.push(input); },
      });
    },
  };
});

const shouldRun = process.env.WEEKLY_PLANNING_ISSUE156_REAL_API === '1';
const outputDir = process.env.WEEKLY_PLANNING_ISSUE156_OUTPUT_DIR
  ?? 'artifacts/issue156-real-api';

interface ObservedTurn {
  index: number;
  status: 'passed' | 'failed';
  userText: string;
  assistantText: string;
  responseSource: string | null;
  questionContext: unknown;
  graph: WeeklyPlanningFactGraphV5;
  requestId: string;
  debugTrace: unknown[];
  validationErrors: string[];
  failure: string | null;
  progressPhraseObserved: boolean;
  boundedUnitPhraseObserved: boolean;
  oldRemainingTenPhraseObserved: boolean;
  correctedTwelvePhraseObserved: boolean;
  taskIdentityInsteadOfProgressObserved: boolean;
  clockAcknowledgementObserved: boolean | null;
  deadlineAcknowledgementObserved: boolean | null;
  questionIntent: unknown;
}

export interface ConversationObservation {
  name: string;
  turns: ObservedTurn[];
  unreachedTurns: number;
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

function activeUncertainties(graph: WeeklyPlanningFactGraphV5) {
  const ids = activeIds(graph);
  return graph.uncertainties.filter((fact) => ids.has(fact.id));
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

function mentionsBoundedUnit(text: string): boolean {
  return /何\s*枚|何\s*ページ|何\s*問|全部で.{0,10}(枚|ページ|問)|全体で.{0,10}(枚|ページ|問)/.test(text);
}

function mentionsOldRemainingTen(text: string): boolean {
  return /残り\s*10\s*枚/.test(text);
}

function mentionsCorrectedTwelve(text: string): boolean {
  return /12\s*枚/.test(text);
}

function asksForTaskIdentityInsteadOfProgress(text: string): boolean {
  return /どんな作業|どのような作業|何の作業|何をする作業/.test(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validationErrorsFromTrace(events: unknown[]): string[] {
  return events.flatMap((event) => {
    if (!isRecord(event) || event.stage !== 'semantic_validation_result' || !isRecord(event.data)) return [];
    const errors = event.data.errors;
    return Array.isArray(errors) ? errors.filter((entry): entry is string => typeof entry === 'string') : [];
  });
}

export async function conversation(params: {
  name: string;
  ownerId: string;
  conversationId: string;
  userTurns: string[];
  runtimeGateway?: WeeklyPlanningTurnApplicationServices['runtimeGateway'];
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
        capturedResult = await (params.runtimeGateway ?? weeklyPlanningTurnRuntimeGateway).execute(runtimeParams);
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
  let unreachedTurns = 0;
  for (let index = 0; index < params.userTurns.length; index += 1) {
    capturedResult = null;
    capturedRequestId = null;
    const userText = params.userTurns[index];
    let capturedTrace: unknown[] = [];
    const captureStart = rendererInputCaptures.length;
    try {
    const submission = await submitWeeklyPlanningApplicationTurn({
      session,
      userId: params.ownerId,
      ownerId: params.ownerId,
      plannerDataAvailability: createReadyPlannerDataAvailability(params.ownerId),
      userText,
      selectedDate: '2026-08-17',
      plans: [],
      scheduleTemplates: [],
      weekStartsOn: 'monday',
      getState: store.getState,
      dispatch: store.dispatch,
    }, services);
    if (!submission.accepted) throw new Error(`${params.name} turn ${index + 1}: submission rejected`);
    if (capturedResult === null || capturedRequestId === null) {
      throw new Error(`${params.name} turn ${index + 1} did not produce a runtime result`);
    }
    const result: WeeklyPlanningTurnExecutionResult = capturedResult;
    const requestId: string = capturedRequestId;
    const debugTrace = takeWeeklyPlanningStableV5DebugTrace(requestId);
    capturedTrace = debugTrace;
    if (result.failure) throw new Error(`${result.failure.code} ${result.failure.traceCode}`);
    const runtime = getWeeklyPlanningStableV5RuntimeSession(params.conversationId);
    if (!runtime) throw new Error(`${params.name} turn ${index + 1}: runtime missing`);
    const assistantText = store.getState().lastAssistantMessage ?? result.message;
    const capturedInputs = rendererInputCaptures.slice(captureStart);
    const capturedRendererInput = capturedInputs[capturedInputs.length - 1] ?? null;
    turns.push({
      index: index + 1,
      status: 'passed',
      userText,
      assistantText,
      responseSource: result.responseSource ?? null,
      questionContext: store.getState().intakeState?.lastQuestionContext ?? null,
      graph: structuredClone(runtime.graph),
      requestId,
      debugTrace,
      validationErrors: validationErrorsFromTrace(debugTrace),
      failure: null,
      progressPhraseObserved: hasProgressExplanation(assistantText),
      boundedUnitPhraseObserved: mentionsBoundedUnit(assistantText),
      oldRemainingTenPhraseObserved: mentionsOldRemainingTen(assistantText),
      correctedTwelvePhraseObserved: mentionsCorrectedTwelve(assistantText),
      taskIdentityInsteadOfProgressObserved: asksForTaskIdentityInsteadOfProgress(assistantText),
      clockAcknowledgementObserved: null,
      deadlineAcknowledgementObserved: null,
      questionIntent: questionIntentFromRendererCapture(capturedRendererInput),
    });
    } catch (error) {
      const requestId = capturedRequestId ?? '';
      const debugTrace = capturedTrace.length > 0
        ? capturedTrace
        : requestId ? takeWeeklyPlanningStableV5DebugTrace(requestId) : [];
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      const failedResult = capturedResult as WeeklyPlanningTurnExecutionResult | null;
      const capturedInputs = rendererInputCaptures.slice(captureStart);
      const capturedRendererInput = capturedInputs[capturedInputs.length - 1] ?? null;
      if (failedResult?.failure) {
        const rawFailure = JSON.stringify(failedResult.failure);
        turns.push({
          index: index + 1,
          status: 'failed',
          userText,
          assistantText: store.getState().lastAssistantMessage ?? failedResult.message ?? '',
          responseSource: failedResult.responseSource ?? null,
          questionContext: store.getState().intakeState?.lastQuestionContext ?? null,
          graph: getWeeklyPlanningStableV5RuntimeSession(params.conversationId)?.graph
            ?? createEmptyWeeklyPlanningFactGraphV5(),
          requestId,
          debugTrace,
          validationErrors: validationErrorsFromTrace(debugTrace),
          failure: `${message}; result.failure=${rawFailure}`,
          progressPhraseObserved: false,
          boundedUnitPhraseObserved: false,
          oldRemainingTenPhraseObserved: false,
          correctedTwelvePhraseObserved: false,
          taskIdentityInsteadOfProgressObserved: false,
          clockAcknowledgementObserved: null,
          deadlineAcknowledgementObserved: null,
          questionIntent: questionIntentFromRendererCapture(capturedRendererInput),
        });
      } else {
        turns.push({
          index: index + 1,
          status: 'failed',
          userText,
          assistantText: store.getState().lastAssistantMessage ?? '',
          responseSource: null,
          questionContext: store.getState().intakeState?.lastQuestionContext ?? null,
          graph: getWeeklyPlanningStableV5RuntimeSession(params.conversationId)?.graph
            ?? createEmptyWeeklyPlanningFactGraphV5(),
          requestId,
          debugTrace,
          validationErrors: validationErrorsFromTrace(debugTrace),
          failure: message,
          progressPhraseObserved: false,
          boundedUnitPhraseObserved: false,
          oldRemainingTenPhraseObserved: false,
          correctedTwelvePhraseObserved: false,
          taskIdentityInsteadOfProgressObserved: false,
          clockAcknowledgementObserved: null,
          deadlineAcknowledgementObserved: null,
          questionIntent: questionIntentFromRendererCapture(capturedRendererInput),
        });
      }
      unreachedTurns = params.userTurns.length - index - 1;
      break;
    }
  }
  return { name: params.name, turns, unreachedTurns };
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
      `typed question intent: ${JSON.stringify(turn.questionIntent)}`,
      '',
      `failure: ${turn.failure ?? 'none'}`,
      '',
      `validation errors: ${JSON.stringify(turn.validationErrors)}`,
      '',
      `quality observation: progress phrase seen=${turn.progressPhraseObserved}`,
      `quality observations: ${JSON.stringify({ boundedUnitPhraseObserved: turn.boundedUnitPhraseObserved, oldRemainingTenPhraseObserved: turn.oldRemainingTenPhraseObserved, correctedTwelvePhraseObserved: turn.correctedTwelvePhraseObserved, taskIdentityInsteadOfProgressObserved: turn.taskIdentityInsteadOfProgressObserved, clockAcknowledgementObserved: turn.clockAcknowledgementObserved, deadlineAcknowledgementObserved: turn.deadlineAcknowledgementObserved })}`,
      '',
      `response source: ${turn.responseSource ?? 'unknown'}`,
      '',
    ]),
  ]).join('\n');
}

const run = shouldRun ? describe : describe.skip;

run('Issue #156 final real API conversation gate', () => {
  it('keeps adaptive progress, grounding, corrections, effort measurement, and execution state coherent', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-26T12:00:00.000Z'));
    const caseDefinitions = [
      {
        name: 'A',
        run: () => conversation({
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
        }),
        validate: (observation: ConversationObservation) => validateA(observation),
      },
      {
        name: 'B',
        run: () => conversation({
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
        }),
        validate: (observation: ConversationObservation) => validateB(observation),
      },
      {
        name: 'C',
        run: () => conversation({
      name: 'C explicitly bounded slides correction plus alternate effort measurement',
      ownerId: 'issue156-final-c',
      conversationId: 'issue156-final-c',
      userTurns: [
        '明日の予定を立てたいです',
        '夏合宿のスライドは全部20枚で、今10枚までできています。明日残りを終わらせたいです',
        '訂正です、今は12枚までできています',
        '1枚あたりだいたい8分くらいです',
      ],
        }),
        validate: (observation: ConversationObservation) => validateC(observation),
      },
      {
        name: 'D',
        run: () => conversation({
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
        }),
        validate: (observation: ConversationObservation) => validateD(observation),
      },
    ];
    let observations: ConversationObservation[] = [];
    let caseResults: unknown[] = [];
    try {
      const results = await runIndependentEvalCases({
        cases: caseDefinitions.map((definition) => ({
          name: definition.name,
          run: definition.run,
          validate: definition.validate,
        })),
        persist: (results) => {
          observations = results.flatMap((result) => result.value ? [result.value] : []);
          caseResults = results;
          persistFinalConversationArtifacts(outputDir, caseResults, observations);
        },
      });
      expect(results).toHaveLength(4);
      expect(results.map(({ name, status }) => ({ name, status }))).toEqual([
        { name: 'A', status: 'passed' },
        { name: 'B', status: 'passed' },
        { name: 'C', status: 'passed' },
        { name: 'D', status: 'passed' },
      ]);
    } finally {
      vi.useRealTimers();
    }
  }, 420_000);
});

export function persistFinalConversationArtifacts(
  directory: string,
  caseResults: unknown[],
  conversations: ConversationObservation[],
): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(`${directory}/final-conversations.md`, `# Issue #156 Final Conversations\n\n${markdown(conversations)}\n`);
  writeFileSync(`${directory}/final-conversations.json`, `${JSON.stringify({ caseResults, conversations }, null, 2)}\n`);
}

function turnsFor(observation: ConversationObservation, expectedCount: number): ObservedTurn[] {
  expect(observation.unreachedTurns).toBe(0);
  expect(observation.turns).toHaveLength(expectedCount);
  expect(observation.turns.every((turn) => turn.status === 'passed')).toBe(true);
  return observation.turns;
}

function expectOpenEndedSession(turn: ObservedTurn): void {
  expect(questionCode(turn)).toBe('missing_schedulable_work');
  expect(turn.questionIntent).toMatchObject({
    kind: 'schedulable_work_detail',
    mode: 'open_ended_session',
    requestedInformation: ['session_allocation'],
  });
}

function validateA(observation: ConversationObservation): void {
    const a = turnsFor(observation, 5);
    expectOpenEndedSession(a[1]);
    expect(questionCode(a[2])).toBe('missing_schedulable_work');
    a[2].clockAcknowledgementObserved = hasClockAck(a[2].assistantText);
    expect(hasAcceptedBusyInterval(a[2].graph)).toBe(true);
    const aProgress = activeWorkloads(a[3].graph);
    const aCompleted = aProgress.find((workload) =>
      workload.quantityRole === 'completed' && workload.amount === 60
      && workload.unitCode === 'custom' && workload.unitLabel === '%');
    const aRemaining = aProgress.find((workload) =>
      workload.quantityRole === 'remaining' && workload.amount === 40
      && workload.unitCode === 'custom' && workload.unitLabel === '%');
    expect(aCompleted).toBeDefined();
    expect(aRemaining).toBeDefined();
    expect(questionCode(a[3])).toBe('missing_effort_estimate');
    expect(activeEfforts(a[3].graph)).toHaveLength(0);
    const finalEfforts = activeEfforts(a[4].graph);
    expect(finalEfforts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'total_duration', minutes: 120, targetFactId: aRemaining?.id }),
    ]));
    expect(finalEfforts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'total_duration', minutes: 120, targetFactId: aCompleted?.id }),
    ]));
}

function validateB(observation: ConversationObservation): void {
    const b = turnsFor(observation, 5);
    expectOpenEndedSession(b[1]);
    expect(questionCode(b[2])).toBe('missing_schedulable_work');
    b[2].deadlineAcknowledgementObserved = hasDeadlineAck(b[2].assistantText);
    expect(hasTomorrowOnePmDeadline(b[2].graph)).toBe(true);
    const bProgress = activeWorkloads(b[3].graph);
    const bCompleted = bProgress.find((workload) =>
      workload.quantityRole === 'completed' && workload.amount === 50
      && workload.unitCode === 'custom' && workload.unitLabel === '%');
    const bRemaining = bProgress.find((workload) =>
      workload.quantityRole === 'remaining' && workload.amount === 50
      && workload.unitCode === 'custom' && workload.unitLabel === '%');
    expect(bCompleted).toBeDefined();
    expect(bRemaining).toBeDefined();
    expect(activeUncertainties(b[3].graph)).toHaveLength(0);
    expect(questionCode(b[3])).toBe('missing_effort_estimate');
    const finalEfforts = activeEfforts(b[4].graph);
    expect(finalEfforts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'total_duration', minutes: 90, targetFactId: bRemaining?.id }),
    ]));
    expect(finalEfforts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'total_duration', minutes: 90, targetFactId: bCompleted?.id }),
    ]));
}

function validateC(observation: ConversationObservation): void {
    const c = turnsFor(observation, 4);
    const original = activeWorkloads(c[1].graph);
    expect(original.filter((workload) => workload.quantityRole === 'target' && workload.amount === 20)).toHaveLength(1);
    expect(original.filter((workload) => workload.quantityRole === 'completed' && workload.amount === 10)).toHaveLength(1);
    expect(original.filter((workload) => workload.quantityRole === 'remaining' && workload.amount === 10)).toHaveLength(1);
    const corrected = activeWorkloads(c[2].graph);
    expect(corrected.filter((workload) => workload.quantityRole === 'completed' && workload.amount === 12)).toHaveLength(1);
    expect(corrected.filter((workload) => workload.quantityRole === 'remaining' && workload.amount === 8)).toHaveLength(1);
    expect(corrected.filter((workload) => workload.quantityRole === 'remaining' && workload.amount === 10)).toHaveLength(0);
    expect(corrected.some((workload) => workload.quantityRole === 'target' && workload.amount === 10)).toBe(false);
    const finalWorkloads = activeWorkloads(c[3].graph);
    const completedTwelve = finalWorkloads.filter((workload) => workload.quantityRole === 'completed' && workload.amount === 12);
    const remainingEight = finalWorkloads.filter((workload) => workload.quantityRole === 'remaining' && workload.amount === 8);
    expect(completedTwelve).toHaveLength(1);
    expect(remainingEight).toHaveLength(1);
    expect(finalWorkloads.filter((workload) => workload.quantityRole === 'remaining' && workload.amount === 10)).toHaveLength(0);
    expect(finalWorkloads.some((workload) => workload.quantityRole === 'target' && workload.amount === 10)).toBe(false);
    const finalEfforts = activeEfforts(c[3].graph);
    const perUnitEight = finalEfforts.find((effort) => effort.kind === 'duration_per_unit' && effort.minutes === 8);
    expect(perUnitEight).toBeDefined();
    expect(perUnitEight?.taskId).toBe(completedTwelve[0].taskId);
    expect(perUnitEight?.targetFactId).toBe(remainingEight[0].id);
    expect(perUnitEight?.targetFactId).not.toBe(completedTwelve[0].id);
    expect(finalEfforts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'total_duration', minutes: 8 }),
    ]));
    expect(questionCode(c[3])).toBeNull();
}

function validateD(observation: ConversationObservation): void {
    const d = turnsFor(observation, 5);
    expectOpenEndedSession(d[2]);
    const dProgress = activeWorkloads(d[3].graph);
    const dCompleted = dProgress.find((workload) =>
      workload.quantityRole === 'completed' && workload.amount === 70
      && workload.unitCode === 'custom' && workload.unitLabel === '%');
    const dRemaining = dProgress.find((workload) =>
      workload.quantityRole === 'remaining' && workload.amount === 30
      && workload.unitCode === 'custom' && workload.unitLabel === '%');
    expect(dCompleted).toBeDefined();
    expect(dRemaining).toBeDefined();
    const finalEfforts = activeEfforts(d[4].graph);
    expect(finalEfforts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'total_duration', minutes: 45, targetFactId: dRemaining?.id }),
    ]));
    expect(finalEfforts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'total_duration', minutes: 45, targetFactId: dCompleted?.id }),
    ]));
}
