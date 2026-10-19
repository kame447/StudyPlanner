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
import { submitWeeklyPlanningControlledTurn } from '../weeklyPlanningTurnController';
import { weeklyPlanningTurnRuntimeGateway } from '../application/weeklyPlanningTurnRuntimeGateway';
import { weeklyPlanningTurnStagingLifecycle } from '../application/weeklyPlanningTurnSideEffects';
import { weeklyPlanningTurnOutcomeLifecycle } from '../application/weeklyPlanningTurnOutcomeLifecycle';
import { registerControlledCandidateDomain } from '../application/weeklyPlanningControlledCandidateRegistry';
import type { ControlledCandidateStageContext } from '../application/weeklyPlanningControlledCandidateDomains';
import { createNumericPendingRegisteredDomainV5 } from './weeklyPlanningNumericRegisteredDomainV5';
import { normalizedChoice } from './weeklyPlanningNumericPendingChoiceV5.testUtils';
import type { WeeklyPlanningTurnApplicationServices } from '../application/weeklyPlanningTurnApplication';
import type { PlanningState, WeeklyPlanningAction } from '../types';

const owner = 'j2b-fixture-owner'; const week = '2026-10-12'; const conversation = 'j2b-real-conversation';
let restore: (() => void) | undefined;
const schemas: string[] = [];
let setup: Record<string, unknown>;
const mathOnly = { schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan',
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
  setup = mathOnly;
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
        text: prompt.applicationDecision.questionCode === 'missing_schedulable_work' ? '今週は何に取り組みますか？' : '数学の問題は1問に何分かかりますか？' };
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


it('configured D5 reaches a real two-turn question and replaces the focused Luna semantic request', async () => {
  let state = createInitialPlanningState(week);
  const session = createWeeklyPlanningControllerSession(owner, week, conversation);
  const choice = vi.fn(async (request: Parameters<ControlledCandidateStageContext['choose']>[0], beforeDispatch: () => void) => {
    beforeDispatch();
    return normalizedChoice(request, 'leaf:1');
  });
  const services: WeeklyPlanningTurnApplicationServices = {
    submitControlledTurn: submitWeeklyPlanningControlledTurn,
    runtimeGateway: weeklyPlanningTurnRuntimeGateway,
    stagingLifecycle: weeklyPlanningTurnStagingLifecycle,
    outcomeLifecycle: weeklyPlanningTurnOutcomeLifecycle,
    candidateDomains: host => {
      const domain = createNumericPendingRegisteredDomainV5([2, 3, 5], 'fixture-question-domain-v1');
      return [registerControlledCandidateDomain(domain, {
        sourceAccess: host.sourceAccess, inputForTurn: host.inputForTurn,
        requestContextForTurn: host.requestContextForTurn,
        continueSelectedTurn: host.continueSelectedTurn,
        policy: { id: 'synthetic-only', calibrationEvidenceId: 'synthetic-only', rules: [
          { menuKind: 'leaves', optionCount: 4, depth: 0, minimumTopProbability: 0.98, minimumMargin: 0.90 },
        ] },
        maximumChildrenPerMenu: 16, maximumDecisions: 1, choose: choice,
      })];
    },
  };
  const submit = (userText: string) => submitWeeklyPlanningApplicationTurn({ session, userId: owner, ownerId: owner,
    userText, selectedDate: week, plans: [], scheduleTemplates: [],
    plannerDataAvailability: createReadyPlannerDataAvailability(owner),
    isPlannerDataSnapshotCurrent: () => true,
    getState: () => state, dispatch: (action: WeeklyPlanningAction): PlanningState => state = weeklyPlanningReducer(state, action),
  }, services);
  expect((await submit('今週、数学の問題を10問進めたい')).accepted).toBe(true);
  const first = state.intakeState!.lastQuestionContext!;
  expect(first.actionId).toMatch(/^candidate-question:d5_numeric:/);
  expect(first.controlledCandidate).toBeDefined();
  const before = schemas.length;
  expect((await submit('1問3分です')).accepted).toBe(true);
  expect(choice).toHaveBeenCalledTimes(1);
  expect(schemas.slice(before).filter(name => name.includes('semantic') || name.includes('focused_contextual'))).toEqual([]);
  const saved = loadWeeklyPlanningStableV5PersistedSession({ ownerId: owner, weekStartDate: week })!;
  expect(saved.graph.effortEstimates).toMatchObject([{ minutes: 3, kind: 'duration_per_unit', unitCode: 'problem' }]);
  expect(saved.graph.workloads).toHaveLength(1);
});

const studyTask = (key: string, title: string, workloads: unknown[], components: unknown[] = []) => ({
  localId: `task-${key}`, existingPublicId: null, category: 'study', title, decompositionStatus: 'atomic',
  study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components },
  workloads, effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: title });
const workload = (key: string, amount: number, unitCode: string, unitLabel: string) => ({ localId: `workload-${key}`, quantityRole: 'target',
  amount, unitCode, unitLabel, rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: `${amount}${unitLabel}` });
const mathWorkload = workload('math', 10, 'problem', '問');
const withTasks = (...tasks: unknown[]) => ({ ...mathOnly, tasks });
const englishListening = studyTask('english', '英語のリスニング', [workload('english', 30, 'minute', '分')]);
const absoluteWindow = { localId: 'window', kind: 'absolute', value: '2026-10-12/2026-10-18', start: '2026-10-12', end: '2026-10-18', sourceText: '10月12日から18日' };
/** The settled sibling is accepted in an earlier turn, so the effort question's turn ACKs only its own target. */
async function settledSiblingThenMath(run: ReturnType<typeof configuredRun>) {
  setup = withTasks(englishListening);
  expect((await run.submit('今週、英語のリスニングを30分やりたい')).accepted).toBe(true);
  setup = { ...withTasks(studyTask('math', '数学の問題', [mathWorkload])), planningWindow: null };
  expect((await run.submit('数学の問題も10問やりたい')).accepted).toBe(true);
}

function configuredRun(optionId: string) {
  let state = createInitialPlanningState(week);
  const session = createWeeklyPlanningControllerSession(owner, week, conversation);
  const choice = vi.fn(async (request: Parameters<ControlledCandidateStageContext['choose']>[0], beforeDispatch: () => void) => {
    beforeDispatch();
    return normalizedChoice(request, optionId);
  });
  const services: WeeklyPlanningTurnApplicationServices = {
    submitControlledTurn: submitWeeklyPlanningControlledTurn,
    runtimeGateway: weeklyPlanningTurnRuntimeGateway,
    stagingLifecycle: weeklyPlanningTurnStagingLifecycle,
    outcomeLifecycle: weeklyPlanningTurnOutcomeLifecycle,
    candidateDomains: host => [registerControlledCandidateDomain(createNumericPendingRegisteredDomainV5([2, 3, 5], 'fixture-question-domain-v1'), {
      sourceAccess: host.sourceAccess, inputForTurn: host.inputForTurn,
      requestContextForTurn: host.requestContextForTurn,
      continueSelectedTurn: host.continueSelectedTurn,
      policy: { id: 'synthetic-only', calibrationEvidenceId: 'synthetic-only', rules: [
        { menuKind: 'leaves', optionCount: 4, depth: 0, minimumTopProbability: 0.98, minimumMargin: 0.90 },
      ] },
      maximumChildrenPerMenu: 16, maximumDecisions: 1, choose: choice,
    })],
  };
  const submit = (userText: string) => submitWeeklyPlanningApplicationTurn({ session, userId: owner, ownerId: owner,
    userText, selectedDate: week, plans: [], scheduleTemplates: [],
    plannerDataAvailability: createReadyPlannerDataAvailability(owner),
    isPlannerDataSnapshotCurrent: () => true,
    getState: () => state, dispatch: (action: WeeklyPlanningAction): PlanningState => state = weeklyPlanningReducer(state, action),
  }, services);
  const semanticSchemasSince = (start: number) => schemas.slice(start).filter(name => name.includes('semantic') || name.includes('focused_contextual'));
  const saved = () => loadWeeklyPlanningStableV5PersistedSession({ ownerId: owner, weekStartDate: week })!;
  return { submit, choice, semanticSchemasSince, saved, get state() { return state; } };
}

it('configured D5 commits the one pending target beside a settled intrinsic-time workload without semantic Luna', async () => {
  const run = configuredRun('leaf:1');
  await settledSiblingThenMath(run);
  const question = run.state.intakeState!.lastQuestionContext!;
  expect(question.actionId).toMatch(/^candidate-question:d5_numeric:/);
  const math = run.saved().graph.workloads.find(fact => fact.unitCode === 'problem')!;
  expect(question.topicId).toBe(math.id);
  const before = schemas.length;
  expect((await run.submit('1問3分です')).accepted).toBe(true);
  expect(run.choice).toHaveBeenCalledTimes(1);
  expect(run.semanticSchemasSince(before)).toEqual([]);
  const graph = run.saved().graph;
  expect(graph.effortEstimates).toMatchObject([{ targetFactId: math.id, minutes: 3, kind: 'duration_per_unit', unitCode: 'problem' }]);
  expect(graph.workloads).toHaveLength(2);
});

it('configured D5 leaves two open effort targets to the existing focused Luna route', async () => {
  setup = withTasks(studyTask('math', '数学の問題', [mathWorkload]),
    studyTask('english', '英語の長文', [workload('english', 20, 'page', 'ページ')]));
  const run = configuredRun('leaf:1');
  expect((await run.submit('今週、数学の問題を10問と英語の長文を20ページ進めたい')).accepted).toBe(true);
  const question = run.state.intakeState!.lastQuestionContext!;
  expect(question.targetSlot).toBe('stable_v5:missing_effort_estimate');
  expect(question.controlledCandidate).toBeUndefined();
  const before = schemas.length;
  expect((await run.submit('1問3分です')).accepted).toBe(true);
  expect(run.choice).not.toHaveBeenCalled();
  expect(run.semanticSchemasSince(before)).toEqual(['weekly_planning_focused_contextual_answer_v5']);
});

it('configured D5 falls back to the unchanged Luna route when the chooser selects none', async () => {
  const run = configuredRun('none');
  await settledSiblingThenMath(run);
  expect(run.state.intakeState!.lastQuestionContext!.controlledCandidate).toBeDefined();
  const before = schemas.length;
  expect((await run.submit('1問3分です')).accepted).toBe(true);
  expect(run.choice).toHaveBeenCalledTimes(1);
  expect(run.semanticSchemasSince(before)).toEqual(['weekly_planning_focused_contextual_answer_v5']);
  expect(run.saved().graph.effortEstimates).toMatchObject([{ minutes: 3, kind: 'duration_per_unit', unitCode: 'problem' }]);
});

it('configured D5 commits a component-linked workload through answer-stage ancestry revalidation', async () => {
  setup = withTasks(studyTask('math', '数学', [], [{ localId: 'component-algebra', existingPublicId: null, parentLocalId: null,
    role: 'subject', label: '代数', workloads: [mathWorkload], durableContextSignals: [], sourceText: '代数' }]));
  const run = configuredRun('leaf:1');
  expect((await run.submit('今週、数学の代数の問題を10問進めたい')).accepted).toBe(true);
  const graph = run.saved().graph;
  expect(graph.workloads[0].componentId).toBe(graph.components[0].id);
  expect(run.state.intakeState!.lastQuestionContext!.actionId).toMatch(/^candidate-question:d5_numeric:/);
  const before = schemas.length;
  expect((await run.submit('1問3分です')).accepted).toBe(true);
  expect(run.choice).toHaveBeenCalledTimes(1);
  expect(run.semanticSchemasSince(before)).toEqual([]);
  expect(run.saved().graph.effortEstimates).toMatchObject([{ targetFactId: graph.workloads[0].id, minutes: 3, kind: 'duration_per_unit' }]);
});

async function expectCapturedAndCommitted(run: ReturnType<typeof configuredRun>) {
  const question = run.state.intakeState!.lastQuestionContext!;
  expect(question.targetSlot).toBe('stable_v5:missing_effort_estimate');
  expect(question.presentation?.content).toMatchObject({ currentTurnGrounding: 'recommended', groundingContext: { proposed: 0 } });
  expect(question.actionId).toMatch(/^candidate-question:d5_numeric:/);
  const before = schemas.length;
  expect((await run.submit('1問3分です')).accepted).toBe(true);
  expect(run.choice).toHaveBeenCalledTimes(1);
  expect(run.semanticSchemasSince(before)).toEqual([]);
  expect(run.saved().graph.effortEstimates).toMatchObject([{ minutes: 3, kind: 'duration_per_unit', unitCode: 'problem' }]);
}

it('configured D5 captures a first question grounded with an absolute window (recommended, no proposal)', async () => {
  setup = { ...mathOnly, planningWindow: absoluteWindow };
  const run = configuredRun('leaf:1');
  expect((await run.submit('10月12日から18日に数学の問題を10問進めたい')).accepted).toBe(true);
  await expectCapturedAndCommitted(run);
});

it('configured D5 captures the effort question after a relative week was continued with work', async () => {
  setup = { ...mathOnly, tasks: [] };
  const run = configuredRun('leaf:1');
  expect((await run.submit('今週の計画を立てたい')).accepted).toBe(true);
  setup = { ...mathOnly, planningWindow: null };
  expect((await run.submit('数学の問題を10問')).accepted).toBe(true);
  expect(run.state.intakeState!.groundingRecords?.map(record => record.status)).toEqual(['continuation_accepted']);
  await expectCapturedAndCommitted(run);
});

it('configured D5 captures the effort question after an absolute window turn', async () => {
  setup = { ...mathOnly, planningWindow: absoluteWindow, tasks: [] };
  const run = configuredRun('leaf:1');
  await run.submit('10月12日から18日の計画を立てたい');
  setup = { ...mathOnly, planningWindow: null };
  expect((await run.submit('数学の問題を10問')).accepted).toBe(true);
  await expectCapturedAndCommitted(run);
});

it.each([
  ['a settled time-unit sibling', '今週、数学の問題を10問と英語のリスニングを30分やりたい', () => withTasks(studyTask('math', '数学の問題', [mathWorkload]), englishListening)],
  ['a sibling settled by a same-turn estimate', '今週、数学の問題を10問と英語の長文を20ページ、英語は1ページ5分', () => withTasks(studyTask('math', '数学の問題', [mathWorkload]),
    { ...studyTask('english', '英語の長文', [workload('english', 20, 'page', 'ページ')]), effortEstimates: [{ localId: 'english-effort',
      targetLocalId: 'workload-english', kind: 'duration_per_unit', minutes: 5, unitCode: 'page', precision: 'exact', sourceText: '1ページ5分' }] })],
])('configured D5 leaves an effort question co-presented with %s to the existing Luna route', async (_label, userText, doc) => {
  setup = doc();
  const run = configuredRun('leaf:1');
  expect((await run.submit(userText)).accepted).toBe(true);
  const question = run.state.intakeState!.lastQuestionContext!;
  expect(question.targetSlot).toBe('stable_v5:missing_effort_estimate');
  expect(question.controlledCandidate).toBeUndefined();
  const before = schemas.length;
  expect((await run.submit('1問3分です')).accepted).toBe(true);
  expect(run.choice).not.toHaveBeenCalled();
  expect(run.semanticSchemasSince(before)).toEqual(['weekly_planning_focused_contextual_answer_v5']);
});
