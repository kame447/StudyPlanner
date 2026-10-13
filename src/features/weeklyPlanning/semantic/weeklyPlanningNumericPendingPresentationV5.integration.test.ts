import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetWeeklyPlanningStableV5TraceRuntimeForTest } from '../trace/weeklyPlanningStableV5TraceRuntime';
import { submitWeeklyPlanningApplicationTurn } from '../application/weeklyPlanningTurnApplication';
import { createWeeklyPlanningControllerSession } from '../weeklyPlanningTurnController';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';
import { loadWeeklyPlanningStableV5PersistedSession } from '../application/weeklyPlanningStableV5SessionStorage';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from '../application/weeklyPlanningStableV5RuntimeSession';
import { createStableV5SemanticPublicStateSummary } from '../application/weeklyPlanningStableV5SemanticContext';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createReadyPlannerDataAvailability } from '../testUtils/plannerDataAvailabilityTest';
import type { PlanningState, WeeklyPlanningAction } from '../types';

const owner = 'j2b-fixture-owner'; const week = '2026-10-12'; const conversation = 'j2b-real-conversation';
let restore: (() => void) | undefined;
const schemas: string[] = [];
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
  resetWeeklyPlanningStableV5RuntimeSessionsForTest(); resetWeeklyPlanningStableV5TraceRuntimeForTest(); schemas.length = 0;
  for (const field of ['VITE_CLOUDFLARE_AI_PROXY_URL', 'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID']) vi.stubEnv(field, '');
  vi.stubEnv('VITE_AI_PROVIDER', 'openai'); vi.stubEnv('VITE_AI_BASE_URL', 'https://j2b-luna.fixture/v1');
  vi.stubEnv('VITE_AI_MODEL', 'fixture'); vi.stubEnv('VITE_AI_API_KEY', 'fixture');
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (!String(url).startsWith('https://j2b-luna.fixture/')) throw new Error('No real provider permitted in J2b fixture');
    const body = JSON.parse(String(init?.body)); const schema = body.response_format?.json_schema?.name;
    schemas.push(schema);
    let content;
    if (schema === 'weekly_planning_semantic_document_v5') content = setup;
    else if (schema === 'weekly_planning_focused_contextual_answer_v5') content = {
      decision: 'effort_answer', effortTarget: 'question_target', effortMeasurement: 'duration_per_unit',
      minutes: 3, precision: 'exact', quantityRole: null,
    };
    else if (schema === 'weekly_planning_stable_v5_dialogue_response') {
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

it('default unconfigured D5 stays inert while a real two-turn effort answer reaches existing Luna', async () => {
  let state = createInitialPlanningState(week);
  const session = createWeeklyPlanningControllerSession(owner, week, conversation);
  const submit = (userText: string) => submitWeeklyPlanningApplicationTurn({ session, userId: owner, ownerId: owner,
    userText, selectedDate: week, plans: [], scheduleTemplates: [], plannerDataAvailability: createReadyPlannerDataAvailability(owner),
    getState: () => state, dispatch: (action: WeeklyPlanningAction): PlanningState => state = weeklyPlanningReducer(state, action) });
  expect((await submit('今週、数学の問題を10問進めたい')).accepted).toBe(true);
  const saved = loadWeeklyPlanningStableV5PersistedSession({ ownerId: owner, weekStartDate: week });
  expect(saved).not.toBeNull();
  const question = state.intakeState!.lastQuestionContext!;
  expect(question.targetSlot).toBe('stable_v5:missing_effort_estimate');
  expect(question.presentation?.content.responseSource).toBe('ai');
  const summary = createStableV5SemanticPublicStateSummary({ graph: saved!.graph, previousState: state.intakeState,
    messages: state.messages, inputStateRevision: state.revision });
  expect(summary.pendingQuestion).toMatchObject({ questionCode: 'missing_effort_estimate', effortMeasurement: 'duration_per_unit' });
  // Default calibration is absent, so there is intentionally no D5 capture.
  // Keep the original RED receipt as unconnected-path evidence, not a product defect.
  // Configured registration will get its identity from the same presenting commit.
  expect(question.actionId).toBeUndefined();
  const beforeAnswer = schemas.length;
  expect((await submit('1問3分です')).accepted).toBe(true);
  expect(schemas.slice(beforeAnswer).filter(name => name.includes('semantic') || name.includes('focused_contextual')))
    .toEqual(['weekly_planning_focused_contextual_answer_v5']);
  const answered = loadWeeklyPlanningStableV5PersistedSession({ ownerId: owner, weekStartDate: week })!;
  expect(answered.graph.effortEstimates).toMatchObject([{ kind: 'duration_per_unit', minutes: 3, precision: 'exact', unitCode: 'problem' }]);
  expect(answered.graph.workloads).toHaveLength(1);
  expect(answered.graph.workloads[0].amount).toBe(10);
});
