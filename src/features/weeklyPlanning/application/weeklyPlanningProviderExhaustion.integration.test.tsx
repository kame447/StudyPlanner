import { createRef, forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDeferred, createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createReadyPlannerDataAvailability } from '../testUtils/plannerDataAvailabilityTest';
import { useWeeklyPlanningApplication, type WeeklyPlanningApplication, type UseWeeklyPlanningApplicationInput } from './useWeeklyPlanningApplication';
import { createWeeklyPlanningApprovalMemoryState, createMemoryWeeklyPlanningApprovalPlanRepository } from './weeklyPlanningApprovalMemoryRepository';
import { getWeeklyPlanningStableV5RuntimeSession, hasWeeklyPlanningStableV5StagedGraphForTest, resetWeeklyPlanningStableV5RuntimeSessionsForTest } from './weeklyPlanningStableV5RuntimeSession';
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
import { parseWeeklyPlanningPlanSourceId } from '../planning/weeklyPlanningPlanProvenance';
import type { PlanDraft } from '../../../types/domain';
import * as turnApplication from './weeklyPlanningTurnApplication';
import * as planningReducer from '../weeklyPlanningReducer';

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
let deferredGeneric: { started: ReturnType<typeof createDeferred<void>>; response: ReturnType<typeof createDeferred<Response>> } | undefined;
function deferNextGeneric() {
  const deferred = { started: createDeferred<void>(), response: createDeferred<Response>() };
  deferredGeneric = deferred;
  return deferred;
}
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
  resetRuntime(); clearRequests(); genericOutcome = 'valid'; responseDocument = initialSemantic(); deferredGeneric = undefined;
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
        const deferred = deferredGeneric;
        if (deferred) { deferredGeneric = undefined; deferred.started.resolve(); return deferred.response.promise; }
        if (genericOutcome === 'unavailable') return Response.json({ error: 'fixture generic unavailable' }, { status: 503 });
        // A completeness re-read (an entirely empty reading under an accepted plan, x6) names the exact userText in its
        // instruction: the model reads an acknowledgement as empty again.
        if (body.messages.some(message => message.content.includes('The exact current userText to interpret is'))) {
          return completion(JSON.stringify({ ...initialSemantic(), planningIntent: 'discuss', planningWindow: null, tasks: [] }));
        }
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
type SaveFailure = 'before-commit' | 'response-lost';
async function mount(saveFailure?: SaveFailure) {
  const storage = createMemoryStorageHarness(); restoreStorage = installWeeklyPlanningTestStorage(storage.storage);
  const database = createWeeklyPlanningApprovalMemoryState(); const repository = createMemoryWeeklyPlanningApprovalPlanRepository(database);
  const saveRequests: PlanDraft[] = [];
  const saveApprovedPlan = async (draft: PlanDraft) => {
    saveRequests.push(structuredClone(draft));
    if (saveFailure && saveRequests.length === 1) {
      if (saveFailure === 'response-lost') await repository.saveApprovedPlan(draft);
      throw new Error(saveFailure);
    }
    return repository.saveApprovedPlan(draft);
  };
  const ref = createRef<WeeklyPlanningApplication>();
  const render = async () => { await act(async () => { renderer = create(<Harness ref={ref} userId={OWNER} selectedDate={WEEK} plans={[]} scheduleTemplates={[]}
    isPlannerDataSnapshotCurrent={() => true} plannerDataAvailability={createReadyPlannerDataAvailability(OWNER)}
    saveWeeklyApprovedPlan={saveApprovedPlan} completeWeeklyApprovalOperation={repository.completeOperation} />); }); };
  await render();
  const remount = async () => {
    act(() => renderer?.unmount()); renderer = undefined;
    resetRuntime();
    await render();
  };
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
  return { ref, database, submit, unsaved, graph, saveRequests, remount, storage };
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

it.each([
  ['legacy_v5', 'before-commit'], ['legacy_v5', 'response-lost'],
  ['interaction_v1', 'before-commit'], ['interaction_v1', 'response-lost'],
] as const)('%s recovers a provider-created preview after %s without duplicate approved plans', async (architecture, saveFailure) => {
  vi.stubEnv('VITE_WEEKLY_PLANNING_CONVERSATION_ARCHITECTURE_DEFAULT', architecture);
  const spy = gateway(); const { ref, database, submit, unsaved, graph, saveRequests, remount } = await mount(saveFailure);
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
  const previewSnapshot = ref.current!.exportConversationSnapshot()!;
  const previewIdentity = { previewId: `stable-v5-preview:${previewSnapshot.conversationId}:${previewSnapshot.graph.revision}`,
    conversationId: previewSnapshot.conversationId, stateRevision: previewSnapshot.graph.revision, authorizedUserId: OWNER };
  const blocks = createWeeklyDraftBlocksFromPreviewCandidates({ candidates, userId: OWNER, createdAt: new Date().toISOString() });
  for (const block of blocks) expect(block.behaviorMetadata?.previewMetadata).toMatchObject(previewIdentity);
  await act(async () => { ref.current!.createDraftBlocks(blocks); }); unsaved();
  expect(ref.current!.approvalAvailability.kind).toBe('eligible');
  await act(async () => { await expect(ref.current!.approveDraftBlocks()).rejects.toThrow('一部の仮予定'); });
  expect(saveRequests).toHaveLength(1);
  const identity = parseWeeklyPlanningPlanSourceId(saveRequests[0].sourceId)!;
  expect(identity.sourceDraftBlockId).toBe(blocks[0].id);
  expect(ref.current!.state.pendingApproval).toBeUndefined();
  expect(ref.current!.state.draftBlocks).toHaveLength(candidates.length);
  const recoveryIdentity = { approvalOperationId: identity.approvalOperationId, userId: OWNER, status: 'failed',
    previewId: previewIdentity.previewId, conversationId: previewIdentity.conversationId, previewStateRevision: previewIdentity.stateRevision };
  expect(ref.current!.state.approvalRecovery?.operation).toMatchObject(recoveryIdentity);
  expect(database.metrics.planWrites).toBe(saveFailure === 'response-lost' ? candidates.length : 0);
  const committedPlans = structuredClone([...database.plans.values()]);
  if (saveFailure === 'response-lost') {
    expect(database.plans.size).toBe(candidates.length);
    expect([...database.items.values()]).toEqual([expect.objectContaining({ savedPlanId: committedPlans[0].id, sourceDraftBlockId: blocks[0].id, status: 'saved' })]);
    expect([...database.operations.values()]).toEqual([expect.objectContaining({ approvalOperationId: identity.approvalOperationId, status: 'active', savedItemCount: candidates.length })]);
  } else unsaved();
  const previewGraph = structuredClone(ref.current!.exportConversationSnapshot()!.graph);
  const requestCountBeforeRetry = proxyRequests.length;
  // Drop all in-memory sessions and the hook's ledger; recover through real local storage.
  await remount();
  expect(ref.current!.exportConversationSnapshot()!.graph).toEqual(previewGraph);
  expect(ref.current!.state.approvalRecovery?.operation).toMatchObject(recoveryIdentity);
  for (const block of ref.current!.state.draftBlocks) expect(block.behaviorMetadata?.previewMetadata).toMatchObject(previewIdentity);
  await act(async () => { await ref.current!.approveDraftBlocks(); });
  expect(saveRequests).toHaveLength(2);
  expect(saveRequests[1]).toEqual(saveRequests[0]);
  expect(database.metrics.planWrites).toBe(candidates.length); expect(database.plans.size).toBe(candidates.length);
  if (saveFailure === 'response-lost') expect([...database.plans.values()]).toEqual(committedPlans);
  expect([...database.operations.values()]).toEqual([expect.objectContaining({ approvalOperationId: identity.approvalOperationId, status: 'completed' })]);
  expect(database.items.size).toBe(candidates.length);
  expect(ref.current!.state.pendingApproval).toBeUndefined();
  expect(ref.current!.state.draftBlocks).toEqual([]); expect(ref.current!.state.approvalRecovery).toBeUndefined();
  expect(proxyRequests).toHaveLength(requestCountBeforeRetry);
  for (const plan of database.plans.values()) expect(candidates).toContainEqual(expect.objectContaining({ title: plan.title, date: plan.date, startTime: plan.startTime, endTime: plan.endTime }));
  await act(async () => { await ref.current!.approveDraftBlocks(); });
  expect(database.metrics.planWrites).toBe(candidates.length); expect(saveRequests).toHaveLength(2);
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

it.each([
  ['legacy_v5', 'cancel'], ['legacy_v5', 'reset'], ['interaction_v1', 'cancel'], ['interaction_v1', 'reset'],
] as const)('%s rejects stale and duplicate provider-result commits after %s while a newer preview and turn remain owned', async (architecture, interruption) => {
  vi.stubEnv('VITE_WEEKLY_PLANNING_CONVERSATION_ARCHITECTURE_DEFAULT', architecture);
  // Both spies call through: capture the actual live dispatch and provider-created commit,
  // then replay downstream of the gateway rather than synthesizing a semantic result.
  const applicationSpy = vi.spyOn(turnApplication, 'submitWeeklyPlanningApplicationTurn');
  const reducerSpy = vi.spyOn(planningReducer, 'weeklyPlanningReducer');
  const spy = gateway(); const { ref, submit, unsaved, storage, graph } = await mount();
  const delayed = deferNextGeneric();
  let oldSubmission!: Promise<WeeklyPlanningTurnSubmissionResult>;
  await act(async () => { oldSubmission = ref.current!.submitTurn(AUTHORIZE_TEXT); await delayed.started.promise; });
  const oldPending = structuredClone(ref.current!.state.pendingTurn!);
  expectFocusedCorrelation(oldPending.requestId, graph.revision);
  const oldRequestCount = proxyRequests.length;
  expect((await submit(AUTHORIZE_TEXT)).accepted).toBe(false);
  expect(proxyRequests).toHaveLength(oldRequestCount);
  expect(ref.current!.state.pendingTurn).toEqual(oldPending);
  act(() => {
    if (interruption === 'cancel') expect(ref.current!.cancelTurn()).toBe(true);
    else ref.current!.resetSession();
  });
  expect(ref.current!.state.pendingTurn).toBeUndefined(); unsaved();
  responseDocument = initialSemantic(); responseDocument.planningIntent = 'create_plan';
  responseDocument.tasks[0] = { ...responseDocument.tasks[0], title: '英語',
    study: { purpose: 'self_study', contextLabel: '英語', components: [] }, sourceText: '英語20問を1問2分',
    workloads: [{ ...responseDocument.tasks[0].workloads[0], sourceText: '英語20問' }] };
  expect((await submit('8月17日から23日で英語20問を1問2分で計画してください')).accepted).toBe(true);
  expect((await spy.mock.results[2].value).failure).toBeUndefined();
  const newer = ref.current!.exportConversationSnapshot()!;
  expect(newer.graph.tasks.some(task => task.title === '英語')).toBe(true);
  expect(newer.planningState.previewCandidates!.some(candidate => candidate.title.includes('英語'))).toBe(true);
  expect(newer.conversationId === oldPending.conversationId).toBe(interruption === 'cancel');
  const committedPending = spy.mock.calls[2][0].pending;
  const actualCommit = reducerSpy.mock.calls.find(([, action]) => action.type === 'commit_turn'
    && action.pending.requestId === committedPending.requestId)![1];
  expect(actualCommit).toMatchObject({ type: 'commit_turn', pending: committedPending, draftCandidates: newer.planningState.previewCandidates });
  const liveDispatch = applicationSpy.mock.calls[2][0].dispatch;
  const redeliverActualCommit = () => {
    const stateBefore = ref.current!.state;
    const snapshotBefore = structuredClone(stateBefore);
    const storageBefore = [...storage.values.entries()];
    const callsBefore = reducerSpy.mock.calls.length;
    act(() => { liveDispatch(actualCommit); liveDispatch(actualCommit); });
    const replayed = reducerSpy.mock.calls.slice(callsBefore);
    expect(replayed).toHaveLength(2);
    for (const [state, action] of replayed) { expect(state).toBe(stateBefore); expect(action).toBe(actualCommit); }
    expect(ref.current!.state).toBe(stateBefore); expect(ref.current!.state).toEqual(snapshotBefore);
    expect(getWeeklyPlanningStableV5RuntimeSession(newer.conversationId)!.graph).toEqual(newer.graph);
    expect([...storage.values.entries()]).toEqual(storageBefore); unsaved();
  };
  redeliverActualCommit();
  const next = deferNextGeneric();
  let nextSubmission!: Promise<WeeklyPlanningTurnSubmissionResult>;
  await act(async () => { nextSubmission = ref.current!.submitTurn('ありがとう'); await next.started.promise; });
  const currentState = structuredClone(ref.current!.state);
  const storedState = [...storage.values.entries()];
  expect(currentState.pendingTurn!.requestId).not.toBe(oldPending.requestId);
  redeliverActualCommit();
  let discarded!: WeeklyPlanningTurnSubmissionResult;
  await act(async () => { delayed.response.resolve(completion(JSON.stringify(authorizationSemantic()))); discarded = await oldSubmission; });
  expect((await spy.mock.results[1].value).failure).toBeUndefined();
  expect(discarded).toEqual({ accepted: false, draftCandidates: [] });
  expect(ref.current!.state).toEqual(currentState);
  expect(getWeeklyPlanningStableV5RuntimeSession(newer.conversationId)!.graph).toEqual(newer.graph);
  expect([...storage.values.entries()]).toEqual(storedState);
  expect(hasWeeklyPlanningStableV5StagedGraphForTest({ conversationId: oldPending.conversationId, requestId: oldPending.requestId })).toBe(false);
  unsaved();
  let healthy!: WeeklyPlanningTurnSubmissionResult;
  await act(async () => {
    next.response.resolve(completion(JSON.stringify({ ...initialSemantic(), planningIntent: 'discuss', planningWindow: null, tasks: [] })));
    healthy = await nextSubmission;
  });
  expect(healthy.accepted).toBe(true);
  expect((await spy.mock.results[3].value).failure).toBeUndefined();
  expect(ref.current!.state.pendingTurn).toBeUndefined();
  expect(ref.current!.exportConversationSnapshot()!.graph.tasks.some(task => task.title === '英語')).toBe(true);
  expect(ref.current!.state.previewCandidates).toEqual(newer.planningState.previewCandidates);
  // Replay the actual committed request identity; a new user submission would have a new ID.
  const stateBeforeReplay = structuredClone(ref.current!.state);
  const graphBeforeReplay = structuredClone(ref.current!.exportConversationSnapshot()!.graph);
  const requestsBeforeReplay = proxyRequests.length;
  const replay = await weeklyPlanningTurnRuntimeGateway.execute(spy.mock.calls[2][0]);
  expect(replay.failure).toBeUndefined(); expect(replay.responseSource).toBe('system'); expect(replay.draftCandidates).toEqual([]);
  expect(proxyRequests).toHaveLength(requestsBeforeReplay);
  expect(ref.current!.state).toEqual(stateBeforeReplay);
  expect(ref.current!.exportConversationSnapshot()!.graph).toEqual(graphBeforeReplay);
  expect(hasWeeklyPlanningStableV5StagedGraphForTest({ conversationId: newer.conversationId, requestId: spy.mock.calls[2][0].pending.requestId })).toBe(false);
  expect(unexpectedRequests).toEqual([]); unsaved();
});
