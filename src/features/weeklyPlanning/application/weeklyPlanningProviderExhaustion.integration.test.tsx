import { createRef, forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createReadyPlannerDataAvailability } from '../testUtils/plannerDataAvailabilityTest';
import { useWeeklyPlanningApplication, type WeeklyPlanningApplication, type UseWeeklyPlanningApplicationInput } from './useWeeklyPlanningApplication';
import { createWeeklyPlanningApprovalMemoryState, createMemoryWeeklyPlanningApprovalPlanRepository } from './weeklyPlanningApprovalMemoryRepository';
import { resetWeeklyPlanningStableV5RuntimeSessionsForTest } from './weeklyPlanningStableV5RuntimeSession';
import { weeklyPlanningTurnRuntimeGateway } from './weeklyPlanningTurnRuntimeGateway';
import { clearWeeklyPlanningSessionRuntime } from '../planning/weeklyPlanningSessionRuntime';
import { resetUserPlanningContextRuntimeForTestV1 } from '../../userPlanningContext/userPlanningContextSpace';
import { resetOpenAiCompatibleClientRequestBudgetForTest } from '../../../services/ai/openAiCompatibleClient';
import { resetWeeklyPlanningStableV5DebugTraceForTest } from '../trace/weeklyPlanningStableV5DebugTrace';
import { setWeeklyPlanningTraceRepositoryForTests } from '../trace/weeklyPlanningTraceRepository';
import { createWeeklyDraftBlocksFromPreviewCandidates } from '../preview/weeklyPlanningPreviewBlocks';
import { WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, type WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticTypesV5';
import { WEEKLY_PLANNING_SEMANTIC_PROVIDER_RESPONSE_FORMAT_V5 } from '../semantic/weeklyPlanningSemanticProviderResponseFormatV5';
import * as aiConfig from '../../../lib/aiConfig';
import * as firebaseClient from '../../../lib/firebaseClient';
import type { FocusedAuthorizationDecisionContext } from '../../../../shared/focusedAuthorizationDecision';
import type { WeeklyPlanningTurnSubmissionResult } from '../weeklyPlanningTurnExecutionTypes';

// Configuration only: every application, HTTP client, Worker, normalizer,
// scheduler and approval boundary remains the production implementation.
vi.hoisted(() => {
  for (const key of ['VITE_CLOUDFLARE_AI_PROXY_URL', 'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID']) vi.stubEnv(key, '');
});
const OWNER = 'provider-exhaustion-owner';
const WEEK = '2026-08-17';
const INITIAL_TEXT = '8月17日から23日で数学20問を1問2分で進めたいです。まず条件を相談したいです';
const AUTHORIZE_TEXT = 'その条件で作成してください';
const PROXY_URL = 'https://proxy.fixture.test/chat/completions';
const UPSTREAM_URL = 'https://provider.fixture.test/v1/chat/completions';
const GENERIC_SCHEMA = WEEKLY_PLANNING_SEMANTIC_PROVIDER_RESPONSE_FORMAT_V5.json_schema.name;
const FOCUSED_SCHEMA = 'weekly_planning_focused_authorization_v5';
const DIALOGUE_SCHEMA = 'weekly_planning_stable_v5_dialogue_response';
const Harness = forwardRef<WeeklyPlanningApplication, UseWeeklyPlanningApplicationInput>((props, ref) => {
  const application = useWeeklyPlanningApplication(props);
  useImperativeHandle(ref, () => application, [application]);
  return null;
});
function initialSemantic(): WeeklyPlanningSemanticDocumentV5 {
  return { schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, planningIntent: 'discuss',
    planningWindow: { localId: 'window', kind: 'absolute', value: '2026-08-17/2026-08-23', start: WEEK, end: '2026-08-23', sourceText: '8月17日から23日' },
    tasks: [{ localId: 'task', category: 'study', title: '数学', study: { purpose: 'self_study', contextLabel: '数学', components: [] },
      workloads: [{ localId: 'work', quantityRole: 'target', amount: 20, unitCode: 'problem', unitLabel: '問', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '数学20問' }],
      effortEstimates: [{ localId: 'effort', targetLocalId: 'work', kind: 'duration_per_unit', minutes: 2, unitCode: 'problem', precision: 'exact', sourceText: '1問2分' }],
      temporalConstraints: [], recurrence: [], sourceText: '数学20問を1問2分' }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [] };
}
const authorizationSemantic = (): WeeklyPlanningSemanticDocumentV5 => ({
  ...initialSemantic(), planningIntent: 'create_plan', planningWindow: null, tasks: [],
});
interface RequestBody {
  messages: Array<{ role: string; content: string }>;
  response_format?: { json_schema?: { name?: string } };
  decisionContext?: FocusedAuthorizationDecisionContext;
}
type GenericOutcome = 'valid' | 'unavailable' | 'repair-exhausted';
let renderer: ReactTestRenderer | undefined;
let restoreStorage: (() => void) | undefined;
let genericOutcome: GenericOutcome;
let responseDocument: WeeklyPlanningSemanticDocumentV5;
let proxyRequests: Array<{ body: RequestBody; authorization: string | null }>;
let jevRequests: Array<{ state: FocusedAuthorizationDecisionContext['state'] }>;
let providerOrder: string[];
let genericRequests: RequestBody[];
let unexpectedRequests: string[];
const gateway = () => vi.spyOn(weeklyPlanningTurnRuntimeGateway, 'execute');
function resetRuntime() {
  resetWeeklyPlanningStableV5RuntimeSessionsForTest(); clearWeeklyPlanningSessionRuntime();
  resetUserPlanningContextRuntimeForTestV1(); resetWeeklyPlanningStableV5DebugTraceForTest();
  resetOpenAiCompatibleClientRequestBudgetForTest(); setWeeklyPlanningTraceRepositoryForTests(undefined);
}
function completion(content: string) {
  return Response.json({ choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
}
function clearRequests() { proxyRequests = []; jevRequests = []; providerOrder = []; genericRequests = []; unexpectedRequests = []; }
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime('2026-08-16T00:00:00Z');
  vi.stubEnv('VITE_AI_PROVIDER', 'openai'); vi.stubEnv('VITE_AI_BASE_URL', 'https://provider.fixture.test/v1');
  vi.stubEnv('VITE_AI_MODEL', 'fixture'); vi.stubEnv('VITE_AI_API_KEY', 'fixture-key'); vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'false');
  resetRuntime(); clearRequests(); genericOutcome = 'valid'; responseDocument = initialSemantic();
  vi.spyOn(aiConfig, 'usesCloudflareOpenAiProxy').mockReturnValue(true);
  vi.spyOn(aiConfig, 'getCloudflareAiProxyUrl').mockReturnValue(PROXY_URL);
  vi.spyOn(firebaseClient, 'getFirebaseAuth').mockReturnValue({ currentUser: { getIdToken: async () => 'fixture-session' } } as ReturnType<typeof firebaseClient.getFirebaseAuth>);
  const env = {
    OPENAI_API_KEY: 'fixture-luna-key', OPENROUTER_API_KEY: 'fixture-jev-key',
    OPENAI_BASE_URL: 'https://provider.fixture.test/v1', FIREBASE_WEB_API_KEY: 'fixture-project',
    JEV_FOCUSED_AUTHORIZATION_MODE: 'canary', JEV_FOCUSED_AUTHORIZATION_CANARY_PERCENT: '100', JEV_MODE: 'canary', JEV_CANARY_PERCENT: '100',
    AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 1 }) }) },
  };
  // Keep the independently typechecked app/Worker ambient environments separate,
  // using the existing real HTTP seam rather than mocking the Worker dispatcher.
  const { default: worker } = await vi.importActual<{
    default: { fetch(request: Request, bindings: typeof env): Promise<Response> };
  }>('../../../../workers/ai-proxy/src/worker');
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const endpoint = String(url);
    if (endpoint === PROXY_URL) {
      proxyRequests.push({ body: JSON.parse(String(init?.body)), authorization: new Headers(init?.headers).get('Authorization') });
      return worker.fetch(new Request(endpoint, init), env);
    }
    // Best-effort product metrics are an external side channel, not semantic input.
    if (endpoint === 'https://proxy.fixture.test/observability/events') return Response.json({ accepted: true }, { status: 202 });
    if (endpoint.startsWith('https://identitytoolkit.googleapis.com/')) return Response.json({ users: [{ localId: OWNER, emailVerified: true }] });
    if (endpoint === 'https://openrouter.ai/api/alpha/decisions') {
      providerOrder.push('jev'); jevRequests.push(JSON.parse(String(init?.body)));
      return Response.json({ error: 'fixture Jev unavailable' }, { status: 503 });
    }
    if (endpoint === UPSTREAM_URL) {
      const body = JSON.parse(String(init?.body)) as RequestBody;
      const schema = body.response_format?.json_schema?.name;
      if (schema === FOCUSED_SCHEMA) {
        providerOrder.push('focused-luna');
        return Response.json({ error: 'fixture focused Luna unavailable' }, { status: 503 });
      }
      if (schema === GENERIC_SCHEMA) {
        providerOrder.push('generic'); genericRequests.push(body);
        if (genericOutcome === 'unavailable') return Response.json({ error: 'fixture generic unavailable' }, { status: 503 });
        return completion(genericOutcome === 'repair-exhausted' ? (genericRequests.length === 1 ? 'not-json' : '{}') : JSON.stringify(responseDocument));
      }
      if (schema === DIALOGUE_SCHEMA) {
        providerOrder.push('dialogue');
        const prompt = JSON.parse(body.messages[body.messages.length - 1].content);
        const decision = prompt.applicationDecision;
        return completion(JSON.stringify({ actionId: prompt.actionId, actionKind: decision.actionKind, questionCode: decision.questionCode,
          groundingAcknowledgement: null, text: `内容を確認してください。${decision.previewPromotionControlLabel ?? ''}` }));
      }
      unexpectedRequests.push(`schema:${schema}`);
    } else unexpectedRequests.push(endpoint);
    // Assertions stay outside this callback: provider error handling must not
    // swallow a failed fixture assertion and turn it into a passing fallback.
    throw new Error('Unexpected fixture request');
  }));
});
afterEach(() => {
  act(() => renderer?.unmount()); renderer = undefined; restoreStorage?.(); restoreStorage = undefined;
  resetRuntime(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers();
});
async function mount() {
  const storage = createMemoryStorageHarness(); restoreStorage = installWeeklyPlanningTestStorage(storage.storage);
  const database = createWeeklyPlanningApprovalMemoryState(); const repository = createMemoryWeeklyPlanningApprovalPlanRepository(database);
  const ref = createRef<WeeklyPlanningApplication>();
  await act(async () => { renderer = create(<Harness ref={ref} userId={OWNER} selectedDate={WEEK} plans={[]} scheduleTemplates={[]}
    isPlannerDataSnapshotCurrent={() => true} plannerDataAvailability={createReadyPlannerDataAvailability(OWNER)}
    saveWeeklyApprovedPlan={repository.saveApprovedPlan} completeWeeklyApprovalOperation={repository.completeOperation} />); });
  const submit = async (text: string) => { let result!: WeeklyPlanningTurnSubmissionResult; await act(async () => { result = await ref.current!.submitTurn(text); }); return result; };
  const unsaved = () => {
    expect(database.metrics).toEqual({ planWrites: 0, itemWrites: 0, operationWrites: 0 });
    expect(database.plans.size).toBe(0); expect(database.operations.size).toBe(0); expect(database.items.size).toBe(0);
  };
  await submit(INITIAL_TEXT);
  expect(ref.current!.state.intakeState?.status).toBe('needs_scope');
  expect(ref.current!.state.previewCandidates).toEqual([]); unsaved();
  expect(unexpectedRequests).toEqual([]);
  const graph = structuredClone(ref.current!.exportConversationSnapshot()!.graph);
  expect(graph.tasks).toHaveLength(1); expect(graph.workloads[0].amount).toBe(20); expect(graph.effortEstimates[0].minutes).toBe(2);
  clearRequests(); responseDocument = authorizationSemantic();
  return { ref, database, submit, unsaved, graph };
}
function expectFocusedCorrelation(requestId: string, inputRevision: number) {
  expect(unexpectedRequests).toEqual([]);
  const focused = proxyRequests.filter(request => request.body.decisionContext?.purpose === 'focused_authorization');
  expect(focused).toHaveLength(1);
  expect(focused[0].authorization).toBe('Bearer fixture-session');
  expect(focused[0].body.decisionContext).toMatchObject({ requestId, inputRevision, previousStatus: 'needs_scope', hasTasks: true,
    hasPendingQuestion: false, state: { currentUserText: AUTHORIZE_TEXT } });
  expect(jevRequests).toHaveLength(1); expect(jevRequests[0].state.currentUserText).toBe(AUTHORIZE_TEXT);
}

it('crosses both focused provider failures into real generic semantics, preview and explicit approval', async () => {
  const spy = gateway(); const { ref, database, submit, unsaved, graph } = await mount();
  expect((await submit(AUTHORIZE_TEXT)).accepted).toBe(true);
  expectFocusedCorrelation(spy.mock.calls[1][0].pending.requestId, graph.revision);
  expect(providerOrder).toEqual(['jev', 'focused-luna', 'generic', 'dialogue']);
  expect(genericRequests).toHaveLength(1);
  expect((await spy.mock.results[1].value).failure).toBeUndefined();
  expect(ref.current!.state.pendingTurn).toBeUndefined();
  for (const key of ['tasks', 'workloads', 'effortEstimates'] as const) expect(ref.current!.exportConversationSnapshot()!.graph[key]).toEqual(graph[key]);
  const candidates = ref.current!.state.previewCandidates!;
  expect(candidates.map(candidate => candidate.title)).toEqual(['数学 20問']);
  expect(candidates.reduce((minutes, candidate) => minutes + candidate.durationMinutes, 0)).toBe(45); unsaved();
  const blocks = createWeeklyDraftBlocksFromPreviewCandidates({ candidates, userId: OWNER, createdAt: new Date().toISOString() });
  await act(async () => { ref.current!.createDraftBlocks(blocks); }); unsaved();
  expect(ref.current!.approvalAvailability.kind).toBe('eligible');
  await act(async () => { await ref.current!.approveDraftBlocks(); });
  expect(database.metrics.planWrites).toBe(candidates.length); expect(database.plans.size).toBe(candidates.length);
  for (const plan of database.plans.values()) expect(candidates).toContainEqual(expect.objectContaining({ title: plan.title, date: plan.date, startTime: plan.startTime, endTime: plan.endTime }));
  await act(async () => { await ref.current!.approveDraftBlocks(); });
  expect(database.metrics.planWrites).toBe(candidates.length);
});

it.each([
  ['legacy_v5', 'unavailable'], ['legacy_v5', 'repair-exhausted'],
  ['interaction_v1', 'unavailable'], ['interaction_v1', 'repair-exhausted'],
] as const)('%s preserves accepted state after both focused failures and generic %s, then admits a healthy retry', async (architecture, outcome) => {
  // Existing conversations hydrate as legacy_v5, so both pinned architectures stay covered.
  vi.stubEnv('VITE_WEEKLY_PLANNING_CONVERSATION_ARCHITECTURE_DEFAULT', architecture);
  const spy = gateway(); const { ref, database, submit, unsaved, graph } = await mount();
  expect(ref.current!.state.conversationArchitecture).toBe(architecture);
  const intake = structuredClone(ref.current!.state.intakeState);
  const preview = structuredClone(ref.current!.state.previewCandidates);
  genericOutcome = outcome;
  const result = await submit(AUTHORIZE_TEXT);
  expectFocusedCorrelation(spy.mock.calls[1][0].pending.requestId, graph.revision);
  expect(result.accepted).toBe(true); expect(result.draftCandidates).toEqual([]);
  // Issue #488: interaction_v1 answers a rejected semantic turn through the renderer from typed
  // recovery context; legacy_v5 keeps its fixed recovery text. A provider outage stays
  // deterministic in both architectures.
  const recoveryRendered = architecture === 'interaction_v1' && outcome === 'repair-exhausted';
  expect(providerOrder).toEqual(outcome === 'unavailable'
    ? ['jev', 'focused-luna', 'generic']
    : ['jev', 'focused-luna', 'generic', 'generic', ...(recoveryRendered ? ['dialogue'] : [])]);
  expect((await spy.mock.results[1].value).failure).toMatchObject({
    code: outcome === 'unavailable' ? 'stable_v5_provider_failure' : 'stable_v5_normalization_rejected',
    diagnostics: { attemptCount: outcome === 'unavailable' ? 1 : 2, repairAttempted: outcome !== 'unavailable' },
  });
  expect(ref.current!.exportConversationSnapshot()!.graph).toEqual(graph);
  expect(ref.current!.state.intakeState).toEqual(intake); expect(ref.current!.state.previewCandidates).toEqual(preview);
  expect(ref.current!.state.pendingTurn).toBeUndefined(); unsaved();
  if (outcome === 'repair-exhausted') {
    expect(genericRequests[1].messages).toContainEqual({ role: 'assistant', content: 'not-json' });
    expect(JSON.stringify(genericRequests[1].messages)).toContain('validationErrors');
  }
  const failedRequestId = spy.mock.calls[1][0].pending.requestId;
  clearRequests(); genericOutcome = 'valid';
  expect((await submit(AUTHORIZE_TEXT)).accepted).toBe(true);
  expectFocusedCorrelation(spy.mock.calls[2][0].pending.requestId, graph.revision);
  expect(spy.mock.calls[2][0].pending.requestId).not.toBe(failedRequestId);
  expect(providerOrder).toEqual(['jev', 'focused-luna', 'generic', 'dialogue']);
  expect((await spy.mock.results[2].value).failure).toBeUndefined();
  expect(ref.current!.state.pendingTurn).toBeUndefined();
  expect(ref.current!.state.previewCandidates!.length).toBeGreaterThan(0); unsaved();
  expect(database.metrics.planWrites).toBe(0);
});
