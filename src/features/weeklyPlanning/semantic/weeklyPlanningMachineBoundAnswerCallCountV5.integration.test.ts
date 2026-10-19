import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetWeeklyPlanningStableV5TraceRuntimeForTest } from '../trace/weeklyPlanningStableV5TraceRuntime';
import { submitWeeklyPlanningApplicationTurn } from '../application/weeklyPlanningTurnApplication';
import { createWeeklyPlanningControllerSession } from '../weeklyPlanningTurnController';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';
import { loadWeeklyPlanningStableV5PersistedSession } from '../application/weeklyPlanningStableV5SessionStorage';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from '../application/weeklyPlanningStableV5RuntimeSession';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createReadyPlannerDataAvailability } from '../testUtils/plannerDataAvailabilityTest';
import { buildMachineBoundEffortAnswerOptions } from '../ui/machineBoundEffortAnswerOptions';
import type { WeeklyPlanningMachineBoundEffortAnswerV5 } from './weeklyPlanningMachineBoundAnswerV5';
import type { PlanningState, WeeklyPlanningAction } from '../types';

// #735 offline call-count measurement. Every provider send is recorded by its response
// schema; the fixture is the same two-turn effort question as the numeric pending test.
const owner = 'i735-typed-owner'; const week = '2026-10-12'; const conversation = 'i735-typed-conversation';
const FOCUSED = 'weekly_planning_focused_contextual_answer_v5';
const SEMANTIC = 'weekly_planning_semantic_document_v5';
const RENDERER = 'weekly_planning_stable_v5_dialogue_response';
let restore: (() => void) | undefined;
const sends: string[] = [];
const setup = { schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan',
  planningWindow: { localId: 'window', kind: 'relative_week', value: 'this_week', start: null, end: null, sourceText: '今週' },
  tasks: [{ localId: 'task-math', existingPublicId: null, category: 'study', title: '数学の問題', decompositionStatus: 'atomic',
    study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [] },
    workloads: [{ localId: 'workload-math', quantityRole: 'target', amount: 10, unitCode: 'problem', unitLabel: '問',
      rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '数学の問題を10問' }],
    effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: '数学の問題を10問' }],
  relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [] };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-10-13T10:00:00Z');
  restore = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
  resetWeeklyPlanningStableV5RuntimeSessionsForTest(); resetWeeklyPlanningStableV5TraceRuntimeForTest(); sends.length = 0;
  for (const field of ['VITE_CLOUDFLARE_AI_PROXY_URL', 'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID']) vi.stubEnv(field, '');
  vi.stubEnv('VITE_AI_PROVIDER', 'openai'); vi.stubEnv('VITE_AI_BASE_URL', 'https://i735-typed.fixture/v1');
  vi.stubEnv('VITE_AI_MODEL', 'fixture'); vi.stubEnv('VITE_AI_API_KEY', 'fixture');
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (!String(url).startsWith('https://i735-typed.fixture/')) throw new Error('No real provider permitted in #735 fixture');
    const body = JSON.parse(String(init?.body)); const schema = body.response_format?.json_schema?.name;
    sends.push(schema);
    let content;
    if (schema === SEMANTIC) content = setup;
    else if (schema === FOCUSED) content = {
      decision: 'effort_answer', effortTarget: 'question_target', effortMeasurement: 'duration_per_unit',
      minutes: 3, precision: 'exact', quantityRole: null,
    };
    else if (schema === RENDERER) {
      const prompt = JSON.parse(body.messages[1].content);
      content = { actionId: prompt.actionId, actionKind: prompt.applicationDecision.actionKind,
        questionCode: prompt.applicationDecision.questionCode, groundingAcknowledgement: null,
        text: '数学の問題は1問に何分かかりますか？' };
    } else throw new Error('Unexpected fixture schema: ' + schema);
    return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  }));
});
afterEach(() => { resetWeeklyPlanningStableV5TraceRuntimeForTest(); restore?.(); resetWeeklyPlanningStableV5RuntimeSessionsForTest(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });

async function presentEffortQuestion() {
  let state = createInitialPlanningState(week);
  const session = createWeeklyPlanningControllerSession(owner, week, conversation);
  const submit = (userText: string, machineBoundAnswer?: WeeklyPlanningMachineBoundEffortAnswerV5) =>
    submitWeeklyPlanningApplicationTurn({ session, userId: owner, ownerId: owner, userText,
      ...(machineBoundAnswer ? { machineBoundAnswer } : {}),
      selectedDate: week, plans: [], scheduleTemplates: [], plannerDataAvailability: createReadyPlannerDataAvailability(owner),
      getState: () => state, dispatch: (action: WeeklyPlanningAction): PlanningState => state = weeklyPlanningReducer(state, action) });
  expect((await submit('今週、数学の問題を10問進めたい')).accepted).toBe(true);
  expect(sends).toEqual([SEMANTIC, RENDERER]);
  sends.length = 0;
  return { submit, getState: () => state };
}

function savedEstimates() {
  return loadWeeklyPlanningStableV5PersistedSession({ ownerId: owner, weekStartDate: week })!.graph.effortEstimates;
}

describe('#735 typed machine-bound effort answer call count', () => {
  it('baseline free-text answer: focused contextual AI send plus renderer', async () => {
    const { submit } = await presentEffortQuestion();
    expect((await submit('1問3分です')).accepted).toBe(true);
    expect(sends).toEqual([FOCUSED, RENDERER]);
    expect(savedEstimates()).toMatchObject([{ kind: 'duration_per_unit', minutes: 3, unitCode: 'problem' }]);
  });

  it('typed chip answer: zero semantic sends, the renderer send remains', async () => {
    const { submit, getState } = await presentEffortQuestion();
    // Default-off product flag: no chip unless VITE_WEEKLY_PLANNING_TYPED_EFFORT_ANSWER=enabled.
    expect(buildMachineBoundEffortAnswerOptions(getState())).toEqual([]);
    expect(buildMachineBoundEffortAnswerOptions(getState(), false)).toEqual([]);
    vi.stubEnv('VITE_WEEKLY_PLANNING_TYPED_EFFORT_ANSWER', 'enabled');
    expect(buildMachineBoundEffortAnswerOptions(getState())).toHaveLength(7);
    const options = buildMachineBoundEffortAnswerOptions(getState(), true);
    expect(options.map(option => option.label)).toEqual([
      '1つあたり約1分', '1つあたり約2分', '1つあたり約3分', '1つあたり約5分',
      '1つあたり約10分', '1つあたり約15分', '1つあたり約30分',
    ]);
    const chosen = options.find(option => option.answer.minutes === 3)!;
    expect((await submit(chosen.label, chosen.answer)).accepted).toBe(true);
    expect(sends).toEqual([RENDERER]);
    const estimates = savedEstimates();
    expect(estimates).toMatchObject([{ kind: 'duration_per_unit', minutes: 3, precision: 'approximate', unitCode: 'problem' }]);
    expect(estimates[0].source.sourceText).toBe('1つあたり約3分');
    const workloads = loadWeeklyPlanningStableV5PersistedSession({ ownerId: owner, weekStartDate: week })!.graph.workloads;
    expect(workloads).toHaveLength(1);
    expect(workloads[0].amount).toBe(10);
    // The question was answered, so no chip is offered for the next message.
    expect(buildMachineBoundEffortAnswerOptions(getState(), true)).toEqual([]);
  });

  it.each([
    ['another assistant message', (answer: WeeklyPlanningMachineBoundEffortAnswerV5) => ({ ...answer, assistantMessageId: 'other-message' })],
    ['another measurement', (answer: WeeklyPlanningMachineBoundEffortAnswerV5) => ({ ...answer, effortMeasurement: 'total_duration' as const, minutes: 30 })],
    ['another target', (answer: WeeklyPlanningMachineBoundEffortAnswerV5) => ({ ...answer, targetFactId: 'workload-other' })],
    ['a stale graph revision', (answer: WeeklyPlanningMachineBoundEffortAnswerV5) => ({ ...answer, graphRevision: answer.graphRevision + 1 })],
    ['a value outside the option set', (answer: WeeklyPlanningMachineBoundEffortAnswerV5) => ({ ...answer, minutes: 4 })],
  ])('a payload bound to %s falls back to the ordinary AI route', async (_name, mutate) => {
    const { submit, getState } = await presentEffortQuestion();
    const chosen = buildMachineBoundEffortAnswerOptions(getState(), true).find(option => option.answer.minutes === 3)!;
    expect((await submit(chosen.label, mutate(chosen.answer))).accepted).toBe(true);
    expect(sends).toEqual([FOCUSED, RENDERER]);
  });

  it('a turn text that is not the generated label falls back to the ordinary AI route', async () => {
    const { submit, getState } = await presentEffortQuestion();
    const chosen = buildMachineBoundEffortAnswerOptions(getState(), true).find(option => option.answer.minutes === 3)!;
    expect((await submit('1問3分です', chosen.answer)).accepted).toBe(true);
    expect(sends).toEqual([FOCUSED, RENDERER]);
    expect(savedEstimates()).toMatchObject([{ minutes: 3, precision: 'exact' }]);
  });
});
