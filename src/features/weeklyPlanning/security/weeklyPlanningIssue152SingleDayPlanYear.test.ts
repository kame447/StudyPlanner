/*
 * Issue #152 O1: retention case single-day-plan through the real runtime path.
 * The semantic call's calendarContext.currentDate comes from the captured request
 * clock (submit `now`), not from selectedDate/weekStartDate. The Real harness pinned
 * neither, so its reference date was the CI wall clock (2026-09-2x) while it asserted
 * a 2026-08-25 window chosen relative to the 2026-08-17 fixture week.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultFixtureProviderResponse } from '../evals/__tests__/weeklyPlanningIssue152StoredRowsFixtures';
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
import { createReadyPlannerDataAvailability } from '../testUtils/plannerDataAvailabilityTest';
import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import type { PlanningState, WeeklyPlanningAction } from '../types';
import {
  createWeeklyPlanningControllerSession,
  submitWeeklyPlanningControlledTurn,
} from '../weeklyPlanningTurnController';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutor';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';

interface ObservedTurn {
  graph: WeeklyPlanningFactGraphV5 | null;
  failureCode: string | null;
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

async function runTurn(params: {
  conversationId: string;
  userText: string;
  now: string;
}): Promise<ObservedTurn> {
  const ownerId = `issue152-single-day-${params.conversationId}`;
  const weekStartDate = '2026-08-17';
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  resetUserPlanningContextRuntimeForTestV1();
  clearWeeklyPlanningSessionRuntime();
  bindWeeklyPlanningStableV5RuntimeSessionScope({
    ownerId,
    weekStartDate,
    conversationId: params.conversationId,
  });

  const store = createStore(createInitialPlanningState(weekStartDate));
  const session = createWeeklyPlanningControllerSession(
    ownerId,
    weekStartDate,
    params.conversationId,
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
    selectedDate: '2026-08-17',
    now: () => params.now,
    plans: [],
    scheduleTemplates: [],
    plannerDataAvailability: createReadyPlannerDataAvailability(ownerId),
    weekStartsOn: 'monday',
    getState: store.getState,
    dispatch: store.dispatch,
  }, services);
  expect(submission.accepted).toBe(true);
  if (!capturedResult) throw new Error(`runtime result missing: ${params.conversationId}`);
  const result: WeeklyPlanningTurnExecutionResult = capturedResult;
  return {
    graph: getWeeklyPlanningStableV5RuntimeSession(params.conversationId)?.graph ?? null,
    failureCode: result.failure?.code ?? null,
  };
}

const USER_TEXT = '8月25日だけの計画を作りたいです。数学を20問進めたいです。';

function semanticDocument(): string {
  return JSON.stringify({
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'create_plan',
    planningWindow: {
      localId: 'planning-window-1',
      kind: 'absolute',
      value: '--08-25/--08-25',
      start: '--08-25',
      end: '--08-25',
      sourceText: '8月25日だけの計画',
    },
    tasks: [{
      localId: 'task-math',
      category: 'study',
      title: '数学',
      study: { purpose: 'self_study', contextLabel: '数学', components: [] },
      workloads: [{
        localId: 'workload-math',
        quantityRole: 'target',
        amount: 20,
        unitCode: 'problem',
        unitLabel: '問',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText: '数学を20問',
      }],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '数学を20問進めたい',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  });
}

interface CapturedBody {
  messages?: Array<{ role: string; content: string }>;
  response_format?: { json_schema?: { name?: string } };
}

function isSemanticRequest(body: CapturedBody): boolean {
  return body.response_format?.json_schema?.name?.includes('weekly_planning_semantic') ?? false;
}

function stubProvider(): CapturedBody[] {
  vi.stubEnv('VITE_AI_PROVIDER', 'openai');
  vi.stubEnv('VITE_AI_BASE_URL', 'https://issue152.fixture.test/v1');
  vi.stubEnv('VITE_AI_MODEL', 'issue152-single-day-year');
  vi.stubEnv('VITE_AI_API_KEY', 'issue152-fixture-key');
  const semanticBodies: CapturedBody[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? 'null')) as CapturedBody;
    let content: string;
    if (isSemanticRequest(body)) {
      semanticBodies.push(body);
      content = semanticDocument();
    } else if (body.response_format?.json_schema?.name === 'weekly_planning_focused_authorization_v5') {
      content = JSON.stringify({ decision: 'create_plan' });
    } else {
      content = defaultFixtureProviderResponse({ purpose: undefined, messages: body.messages ?? [] });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  return semanticBodies;
}

function calendarContextOf(body: CapturedBody | undefined): Record<string, unknown> {
  const user = body?.messages?.find((message) => message.role === 'user');
  return JSON.parse(user?.content ?? '{}').publicStateSummary?.calendarContext ?? {};
}

describe('Issue #152 O1 single-day-plan year through the runtime', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    clearWeeklyPlanningSessionRuntime();
    resetUserPlanningContextRuntimeForTestV1();
  });

  it('commits 2026-08-25 when the request clock matches the fixture week', async () => {
    const semanticBodies = stubProvider();
    const turn = await runTurn({
      conversationId: 'single-day-plan',
      userText: USER_TEXT,
      now: '2026-08-17T00:00:00.000Z',
    });
    expect(calendarContextOf(semanticBodies[0]).currentDate).toBe('2026-08-17');
    expect(turn.failureCode).toBeNull();
    expect(turn.graph?.planningWindows).toEqual([expect.objectContaining({
      kind: 'absolute',
      start: '2026-08-25',
      end: '2026-08-25',
      value: '2026-08-25/2026-08-25',
    })]);
  });

  it('uses the captured request clock, not selectedDate, as the reference date', async () => {
    const semanticBodies = stubProvider();
    const turn = await runTurn({
      conversationId: 'single-day-plan-late-clock',
      userText: USER_TEXT,
      now: '2026-09-25T15:00:00.000Z',
    });
    const currentDate = calendarContextOf(semanticBodies[0]).currentDate;
    expect(currentDate === '2026-09-25' || currentDate === '2026-09-26').toBe(true);
    expect(turn.failureCode).toBeNull();
    expect(turn.graph?.planningWindows[0]).toMatchObject({
      start: '2027-08-25',
      end: '2027-08-25',
    });
  });
});
