import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AiPlanningView } from './AiPlanningView';
import { useWeeklyPlanningApplication, type WeeklyPlanningApplication } from '../features/weeklyPlanning/application/useWeeklyPlanningApplication';
import { createMemoryStorageHarness } from '../features/weeklyPlanning/testUtils/weeklyPlanningApplicationTestHarness';
import { createReadyPlannerDataAvailability } from '../features/weeklyPlanning/testUtils/plannerDataAvailabilityTest';
import { normalizedChoice } from '../features/weeklyPlanning/semantic/weeklyPlanningNumericPendingChoiceV5.testUtils';
import { weeklyPlanningTurnRuntimeGateway } from '../features/weeklyPlanning/application/weeklyPlanningTurnRuntimeGateway';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from '../features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeSession';
import { loadWeeklyPlanningStableV5PersistedSession } from '../features/weeklyPlanning/application/weeklyPlanningStableV5SessionStorage';
import { readDurableWeeklyTurnReceipt } from '../features/weeklyPlanning/application/weeklyPlanningDurableTurnClient';
import { loadAiPlanningChatSnapshot } from '../features/weeklyPlanning/chat/aiPlanningChatStore';
import { createWeeklyPlanningStableV5DialogueRendererCore } from '../features/weeklyPlanning/dialogue/weeklyPlanningStableV5AiDialogueRendererCore';
import { successfulWeeklyPlanningRendererCompletion } from '../features/weeklyPlanning/testUtils/__tests__/weeklyPlanningRendererCompletionFixture';
import * as rendererFactory from '../features/weeklyPlanning/dialogue/weeklyPlanningStableV5AiDialogueRenderer';
import * as aiConfig from '../lib/aiConfig';
import * as firebase from '../lib/firebaseClient';
import { CANDIDATE_CHOICE_CATALOG_VERSION } from '../../shared/candidateChoiceDecision';
import { DurableTurnJob, type DurableTurnRecord } from '../../workers/ai-proxy/src/durableTurns/durableTurnJob';
import { executeIsolatedWeeklyPlanningTurn, type IsolatedWeeklyPlanningTurnInput } from '../features/weeklyPlanning/application/weeklyPlanningIsolatedTurn';

vi.mock('../repositories', () => ({ plannerRepository: { getTodos: async () => [], getStudyMaterials: async () => [] } }));
const OWNER = 'durable-choice-owner';
const DATE = '2026-10-05';
const mathSetup = { schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan',
  planningWindow: { localId: 'window', kind: 'absolute', value: DATE, start: DATE, end: DATE, sourceText: '10月5日' },
  tasks: [{ localId: 'task-math', existingPublicId: null, category: 'study', title: '数学', decompositionStatus: 'atomic',
    study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [] },
    workloads: [{ localId: 'workload-math', quantityRole: 'target', amount: 10, unitCode: 'problem', unitLabel: '問',
      rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '数学10問' }],
    effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [], sourceText: '数学10問' }],
  relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [] };
let app: WeeklyPlanningApplication;
let renderer: ReactTestRenderer | undefined;
const ready = createReadyPlannerDataAvailability(OWNER);
function Harness() {
  app = useWeeklyPlanningApplication({ userId: OWNER, selectedDate: DATE, plans: [], scheduleTemplates: [],
    isPlannerDataSnapshotCurrent: () => true, plannerDataAvailability: ready, saveWeeklyApprovedPlan: vi.fn() });
  return <AiPlanningView application={app} userId={OWNER} selectedDate={DATE} plans={[]} />;
}
const chatSnapshot = () => loadAiPlanningChatSnapshot(OWNER, app.chat.index.chats.find(chat => chat.id === app.chat.index.activeChatId)!);
beforeEach(() => {
  const memory = createMemoryStorageHarness();
  vi.stubGlobal('window', { localStorage: memory.storage, sessionStorage: memory.storage, matchMedia: () => ({ matches: false }), confirm: () => true });
  vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'false');
  vi.spyOn(aiConfig, 'getCloudflareAiProxyUrl').mockReturnValue('https://fixture.test');
  vi.spyOn(aiConfig, 'getAiConfig').mockReturnValue({ provider: 'openai', baseUrl: 'https://fixture.test/v1', model: 'fixture', apiKey: 'synthetic' });
  vi.spyOn(firebase, 'getFirebaseAuth').mockReturnValue({ currentUser: { uid: OWNER, getIdToken: async () => 'synthetic' } } as never);
  vi.spyOn(rendererFactory, 'createAiWeeklyPlanningStableV5DialogueRenderer').mockImplementation(() =>
    createWeeklyPlanningStableV5DialogueRendererCore({ createChatCompletion: successfulWeeklyPlanningRendererCompletion }));
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
});

it('ordinary durable turn also completes through the real client/job/view without relying on a stale view token', async () => {
  vi.stubEnv('VITE_DURABLE_WEEKLY_TURNS', 'enabled');
  let record: DurableTurnRecord | undefined;
  let providerCalls = 0;
  const job = new DurableTurnJob({ read: async () => record && structuredClone(record),
    write: async value => { record = structuredClone(value); }, alarmAt: async () => {} });
  const transport = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (!String(url).includes('/weekly-planning/turns')) return Response.json({ ok: true });
    expect(init?.method).toBe('POST');
    const input = JSON.parse(String(init?.body));
    await job.accept({ ...input, ownerId: OWNER, payload: JSON.stringify(input.payload) });
    await job.run(async (payload, dispatch) => JSON.stringify(await executeIsolatedWeeklyPlanningTurn(JSON.parse(payload) as IsolatedWeeklyPlanningTurnInput,
      { createChatCompletion: request => dispatch(JSON.stringify(request), async () => {
        providerCalls++;
        if (request.purpose === 'weekly_planning_semantic_normalizer') return JSON.stringify({ schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan',
          planningWindow: { localId: 'window', kind: 'absolute', value: DATE, start: DATE, end: DATE, sourceText: '10月5日' },
          tasks: [], relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [] });
        return successfulWeeklyPlanningRendererCompletion(request);
      }) })));
    return Response.json(await job.status({ ownerId: OWNER, conversationId: input.conversationId, requestId: input.requestId }));
  });
  vi.stubGlobal('fetch', transport);
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { renderer!.root.findByType('textarea').props.onChange({ target: { value: '10月5日の計画を相談したい' } }); });
  await act(async () => { renderer!.root.findByProps({ 'aria-label': '送信' }).props.onClick(); });
  await act(async () => { await vi.waitFor(() => {
    expect(app.state.pendingTurn).toBeUndefined(); expect(app.state.messages).toHaveLength(2);
  }, { timeout: 5000 }); });
  expect(providerCalls).toBe(2);
  expect(app.state.messages.slice(-1)[0]?.role).toBe('assistant');
  expect(chatSnapshot()?.planningState.messages).toEqual(app.state.messages);
  expect(renderer!.root.findByType('textarea').props.disabled).toBe(false);
  expect(app.state.pendingApproval).toBeUndefined();
  expect(app.state.draftBlocks).toEqual([]);
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; resetWeeklyPlanningStableV5RuntimeSessionsForTest(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each([false, true])('persists a real D5 selected continuation through view completion and reload (durable=%s)', async durable => {
  vi.stubEnv('VITE_DURABLE_WEEKLY_TURNS', durable ? 'enabled' : '');
  const execute = vi.spyOn(weeklyPlanningTurnRuntimeGateway, 'execute'); // Call through; providers only are synthetic.
  let record: DurableTurnRecord | undefined;
  const job = new DurableTurnJob({ read: async () => record && structuredClone(record),
    write: async value => { record = structuredClone(value); }, alarmAt: async () => {} });
  const transport = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).includes('/weekly-planning/turns')) {
      expect(init?.method).toBe('POST');
      await job.accept({ ...body, ownerId: OWNER, payload: JSON.stringify(body.payload) });
      await job.run(async (payload, dispatch) => JSON.stringify(await executeIsolatedWeeklyPlanningTurn(JSON.parse(payload) as IsolatedWeeklyPlanningTurnInput,
        { createChatCompletion: request => dispatch(JSON.stringify(request), async () => request.purpose === 'weekly_planning_semantic_normalizer'
          ? JSON.stringify(mathSetup) : successfulWeeklyPlanningRendererCompletion(request)) })));
      return Response.json(await job.status({ ownerId: OWNER, conversationId: body.conversationId, requestId: body.requestId }));
    }
    if (body.purpose === 'weekly_planning_semantic_normalizer' && body.decisionContext?.purpose !== 'candidate_choice') return Response.json({ content: JSON.stringify(mathSetup) });
    if (String(url) === 'https://fixture.test/v1/chat/completions') return Response.json({ choices: [{ message: { content: JSON.stringify(mathSetup) } }] });
    if (!body.decisionContext) return Response.json({ ok: true });
    const r = body.decisionContext.request;
    const id = r.menu.options.find((option: { kind: string }) => option.kind === 'leaf').id;
    const { semanticSufficiency: _, ...response } = normalizedChoice(r, id);
    return Response.json({ ...response, status: 'evaluated', catalogVersion: CANDIDATE_CHOICE_CATALOG_VERSION, conditionChange: 0, independentMeaning: 0 });
  });
  vi.stubGlobal('fetch', transport);
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { renderer!.root.findByType('textarea').props.onChange({ target: { value: '10月5日に数学10問を計画したい' } }); });
  await act(async () => { renderer!.root.findByProps({ 'aria-label': '送信' }).props.onClick(); });
  await act(async () => { await vi.waitFor(() => {
    expect(app.state.pendingTurn).toBeUndefined(); expect(app.state.messages).toHaveLength(2);
  }, { timeout: 5000 }); });
  // Let the ordinary durable receipt's passive reconciliation flush before checking its saved setup.
  expect(chatSnapshot()?.planningState.messages).toHaveLength(2);
  expect(app.state.intakeState?.lastQuestionContext?.controlledCandidate?.domainId,
    JSON.stringify({ message: app.state.messages.slice(-1)[0]?.content, question: app.state.intakeState?.lastQuestionContext,
      requests: transport.mock.calls.map(([url, init]) => { const body = JSON.parse(String(init?.body)); return { url, keys: Object.keys(body), purpose: body.purpose }; }) })).toBe('d5_numeric');
  const before = app.chat.index;
  await act(async () => { renderer!.root.findByType('textarea').props.onChange({ target: { value: '15' } }); });
  await act(async () => { await renderer!.root.findByProps({ 'aria-label': '送信' }).props.onClick(); });
  await act(async () => { await vi.waitFor(() => expect(app.state.pendingTurn).toBeUndefined(), { timeout: 5000 }); });
  const choices = () => transport.mock.calls.filter(([, init]) => JSON.parse(String(init?.body)).decisionContext?.purpose === 'candidate_choice');
  expect(choices()).toHaveLength(1);
  expect(execute).toHaveBeenCalledOnce(); // Selected continuation never creates an AI_TURNS receipt.
  expect(readDurableWeeklyTurnReceipt(OWNER)).toBeNull();
  if (durable) expect(app.chat.index).not.toBe(before);
  const owned = loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: app.state.weekStartDate })!;
  expect(app.state.messages.slice(-1)[0]?.content).toContain('15分');
  expect(owned.planningState.intakeState?.c5SelectionLedger?.consumed).toHaveLength(1);
  expect(app.state.messages.slice(-1)[0]?.role).toBe('assistant');
  expect(JSON.stringify(renderer!.toJSON())).toContain('15分');
  const saved = chatSnapshot()!;
  expect(saved.planningState, 'chat checkpoint must retain the complete committed state').toEqual(owned.planningState);
  expect(saved.graph).toEqual(owned.graph);
  expect(saved.planningState.intakeState?.c5SelectionLedger?.consumed).toHaveLength(1);
  act(() => renderer!.unmount()); renderer = undefined; resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  await act(async () => { renderer = create(<Harness />); });
  expect(app.state.messages).toEqual(owned.planningState.messages);
  expect(app.state.intakeState?.c5SelectionLedger?.consumed).toHaveLength(1);
  expect(JSON.stringify(renderer!.toJSON())).toContain('15分');
  expect(choices()).toHaveLength(1);
});
