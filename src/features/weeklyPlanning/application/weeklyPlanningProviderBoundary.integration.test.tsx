import { recordWeeklyPlanningStableV5DebugTrace, takeWeeklyPlanningStableV5DebugTrace } from '../trace/weeklyPlanningStableV5DebugTrace';
import type { StudyMaterial, PlanDraft } from '../../../types/domain';
import { createPlanFromDraft } from '../../../domain/planner';
import { createLocalPlannerRepository } from '../../../repositories/createLocalPlannerRepository';
import { loadWeeklyPlanningStableV5PersistedSession } from './weeklyPlanningStableV5SessionStorage';
import { loadWeeklyPlanningApprovalOperations } from './weeklyPlanningApprovalLedgerStorage';
import { createNoopWeeklyPlanningTraceRepository } from '../trace/weeklyPlanningTraceRepository';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from '../trace/weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from '../trace/weeklyPlanningTraceOutbox';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createRef, forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDeferred, createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
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
import { parseWeeklyPlanningPlanSourceId, WEEKLY_PLANNING_PLAN_SOURCE_TYPE } from '../planning/weeklyPlanningPlanProvenance';
import { WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, type WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticTypesV5';
import * as aiConfig from '../../../lib/aiConfig';
import * as firebaseClient from '../../../lib/firebaseClient';
import type { FocusedAuthorizationDecisionContext } from '../../../../shared/focusedAuthorizationDecision';
import type { WeeklyPlanningTurnSubmissionResult } from '../weeklyPlanningTurnExecutionTypes';

// These configuration values are captured while production modules initialize.
// No client, normalizer, gateway, reducer, scheduler or approval module is mocked.
vi.hoisted(() => {
  for (const key of ['VITE_CLOUDFLARE_AI_PROXY_URL', 'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID']) vi.stubEnv(key, '');
});
const OWNER = 'provider-boundary-owner'; const WEEK = '2026-08-17';
const USER_TEXT = '8月17日から23日で数学20問を1問2分で計画してください';
const Harness = forwardRef<WeeklyPlanningApplication, UseWeeklyPlanningApplicationInput>((props, ref) => {
  const app = useWeeklyPlanningApplication(props); useImperativeHandle(ref, () => app, [app]); return null;
});
function semantic(): WeeklyPlanningSemanticDocumentV5 {
  return { schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, planningIntent: 'create_plan',
    planningWindow: { localId: 'window', kind: 'absolute', value: '2026-08-17/2026-08-23', start: WEEK, end: '2026-08-23', sourceText: '8月17日から23日' },
    tasks: [{ localId: 'task', category: 'study', title: '数学', study: { purpose: 'self_study', contextLabel: '数学', components: [] },
      workloads: [{ localId: 'work', quantityRole: 'target', amount: 20, unitCode: 'problem', unitLabel: '問', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '数学20問' }],
      effortEstimates: [{ localId: 'effort', targetLocalId: 'work', kind: 'duration_per_unit', minutes: 2, unitCode: 'problem', precision: 'exact', sourceText: '1問2分' }],
      temporalConstraints: [], recurrence: [], sourceText: '数学20問を1問2分' }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], uncertainties: [], corrections: [], decisions: [] };
}
interface RequestBody { messages: Array<{ role: string; content: string }>; response_format?: { json_schema?: { name?: string } } }
interface RequestRecord { schema: string; body: RequestBody; signal: AbortSignal | null | undefined }
let renderer: ReactTestRenderer | undefined; let restoreStorage: (() => void) | undefined;
let calls: RequestRecord[]; let mode: 'valid' | 'repair' | 'exhausted' | 'timeout' | 'network'; let semanticCount: number;
let started: ReturnType<typeof createDeferred<void>>;
let responseDocument: WeeklyPlanningSemanticDocumentV5;
const gateway = () => vi.spyOn(weeklyPlanningTurnRuntimeGateway, 'execute'); // Call through to the real executor.
function resetRuntime() {
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  resetWeeklyPlanningStableV5RuntimeSessionsForTest(); clearWeeklyPlanningSessionRuntime();
  resetUserPlanningContextRuntimeForTestV1(); resetWeeklyPlanningStableV5DebugTraceForTest();
  resetOpenAiCompatibleClientRequestBudgetForTest(); setWeeklyPlanningTraceRepositoryForTests(undefined);
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime('2026-08-16T00:00:00Z');
  vi.stubEnv('VITE_AI_PROVIDER', 'openai'); vi.stubEnv('VITE_AI_BASE_URL', 'https://provider.fixture.test/v1');
  vi.stubEnv('VITE_AI_MODEL', 'fixture'); vi.stubEnv('VITE_AI_API_KEY', 'fixture-key'); vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'false');
  resetRuntime(); responseDocument = semantic(); calls = []; mode = 'valid'; semanticCount = 0; started = createDeferred<void>();
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(String(url)).toBe('https://provider.fixture.test/v1/chat/completions');
    const body = JSON.parse(String(init?.body)) as RequestBody; const schema = body.response_format?.json_schema?.name ?? '';
    calls.push({ schema, body, signal: init?.signal });
    let content: string;
    if (schema.includes('weekly_planning_semantic')) {
      semanticCount += 1;
      if (mode === 'network') throw new TypeError('Failed to fetch');
      if (mode === 'timeout') {
        const signal = init?.signal; expect(signal).toBeDefined(); started.resolve();
        return new Promise<Response>((_resolve, reject) => signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
      }
      content = mode === 'exhausted' ? (semanticCount === 1 ? 'not-json' : '{}')
        : mode === 'repair' && semanticCount === 1 ? 'not-json' : JSON.stringify(responseDocument);
    } else if (schema === 'weekly_planning_focused_authorization_v5') {
      content = JSON.stringify({ decision: 'create_plan' });
    } else if (schema === 'weekly_planning_stable_v5_dialogue_response') {
      const prompt = JSON.parse(body.messages[body.messages.length - 1].content);
      const decision = prompt.applicationDecision;
      content = JSON.stringify({ actionId: prompt.actionId, actionKind: decision.actionKind, questionCode: decision.questionCode,
        groundingAcknowledgement: null, text: `内容を確認してください。${decision.previewPromotionControlLabel ?? ''}` });
    } else { throw new Error(`Unexpected provider schema: ${schema}`); }
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
      { status: 200, headers: { 'content-type': 'application/json' } });
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
    isPlannerDataSnapshotCurrent={() => true} plannerDataAvailability={createReadyPlannerDataAvailability(OWNER)} saveWeeklyApprovedPlan={repository.saveApprovedPlan} completeWeeklyApprovalOperation={repository.completeOperation} />); });
  const submit = async (userText = USER_TEXT) => { let result!: WeeklyPlanningTurnSubmissionResult; await act(async () => { result = await ref.current!.submitTurn(userText); }); return result; };
  const unsaved = () => { expect(database.metrics).toEqual({ planWrites: 0, itemWrites: 0, operationWrites: 0 }); expect(database.plans.size).toBe(0); expect(database.operations.size).toBe(0); expect(database.items.size).toBe(0); };
  return { ref, database, submit, unsaved };
}
it('connects a real provider response to preview, then saves only after explicit approval', async () => {
  const spy = gateway(); const { ref, database, submit, unsaved } = await mount(); unsaved();
  expect((await submit()).accepted).toBe(true);
  const execution = await spy.mock.results[0].value; expect(execution.failure).toBeUndefined(); expect(execution.responseSource).toBe('ai');
  const candidates = ref.current!.state.previewCandidates!; expect(candidates.length).toBeGreaterThan(0); unsaved();
  const graph = ref.current!.exportConversationSnapshot()!.graph;
  expect(graph.tasks).toEqual([expect.objectContaining({ title: '数学' })]); expect(graph.workloads[0].amount).toBe(20); expect(graph.effortEstimates[0].minutes).toBe(2);
  const blocks = createWeeklyDraftBlocksFromPreviewCandidates({ candidates, userId: OWNER, createdAt: new Date().toISOString() });
  await act(async () => { ref.current!.createDraftBlocks(blocks); }); unsaved(); expect(ref.current!.approvalAvailability.kind).toBe('eligible');
  await act(async () => { await ref.current!.approveDraftBlocks(); });
  expect(database.plans.size).toBe(candidates.length); expect(database.metrics.planWrites).toBe(candidates.length);
  expect([...database.operations.values()]).toEqual([expect.objectContaining({ status: 'completed' })]);
  for (const plan of database.plans.values()) {
    expect(plan.userId).toBe(OWNER); expect(plan.sourceType).toBe(WEEKLY_PLANNING_PLAN_SOURCE_TYPE);
    const provenance = parseWeeklyPlanningPlanSourceId(plan.sourceId)!; expect(provenance).not.toBeNull();
    expect(blocks.map(block => block.id)).toContain(provenance.sourceDraftBlockId);
    expect([...database.operations.values()][0].approvalOperationId).toBe(provenance.approvalOperationId);
    expect(candidates).toContainEqual(expect.objectContaining({ title: plan.title, date: plan.date, startTime: plan.startTime, endTime: plan.endTime }));
    expect([...database.items.values()]).toContainEqual(expect.objectContaining({ savedPlanId: plan.id, sourceDraftBlockId: provenance.sourceDraftBlockId, status: 'saved' }));
  }
  await act(async () => { await ref.current!.approveDraftBlocks(); }); expect(database.metrics.planWrites).toBe(candidates.length);
  expect(semanticCount).toBe(1);
});
it('repairs an invalid HTTP completion through the real normalizer before producing preview', async () => {
  mode = 'repair'; const spy = gateway(); const { ref, submit, unsaved } = await mount(); await submit();
  expect(semanticCount).toBe(2); const requests = calls.filter(call => call.schema.includes('weekly_planning_semantic'));
  expect(requests[1].body.messages).toContainEqual({ role: 'assistant', content: 'not-json' });
  expect(JSON.stringify(requests[1].body.messages)).toContain('validationErrors');
  const execution = await spy.mock.results[0].value; expect(execution.failure).toBeUndefined(); expect(execution.observability?.repairUsed).toBe(true);
  expect(ref.current!.state.previewCandidates!.length).toBeGreaterThan(0); unsaved();
});
it.each(['exhausted', 'timeout', 'network'] as const)('preserves accepted preview after %s and admits a later healthy turn', async failureMode => {
  const spy = gateway(); const { ref, submit, unsaved } = await mount(); await submit(); unsaved();
  const graph = structuredClone(ref.current!.exportConversationSnapshot()!.graph);
  const intake = structuredClone(ref.current!.state.intakeState); const preview = structuredClone(ref.current!.state.previewCandidates);
  expect(preview!.length).toBeGreaterThan(0); calls = []; semanticCount = 0; mode = failureMode;
  let result!: WeeklyPlanningTurnSubmissionResult;
  if (failureMode === 'timeout') {
    await act(async () => {
      const pending = ref.current!.submitTurn(USER_TEXT); await started.promise; await vi.advanceTimersByTimeAsync(90_000); result = await pending;
    });
    expect(calls[0].signal?.aborted).toBe(true);
  } else result = await submit();
  if (failureMode === 'network') expect(calls[0].signal?.aborted).toBe(false);
  const providerFailure = failureMode !== 'exhausted';
  expect(result.accepted).toBe(true); expect(result.draftCandidates).toEqual([]);
  const execution = await spy.mock.results[1].value;
  expect(execution.failure).toMatchObject({ code: providerFailure ? 'stable_v5_provider_failure' : 'stable_v5_normalization_rejected',
    diagnostics: { attemptCount: providerFailure ? 1 : 2, repairAttempted: !providerFailure } });
  expect(semanticCount).toBe(providerFailure ? 1 : 2); expect(calls.some(call => call.schema.includes('dialogue'))).toBe(false);
  expect(ref.current!.state.pendingTurn).toBeUndefined(); expect(ref.current!.state.intakeState).toEqual(intake); expect(ref.current!.state.previewCandidates).toEqual(preview);
  expect(ref.current!.exportConversationSnapshot()!.graph).toEqual(graph); unsaved();
  mode = 'valid'; semanticCount = 0; responseDocument = { ...semantic(), planningIntent: 'discuss', planningWindow: null, tasks: [] };
  expect((await submit('ありがとう')).accepted).toBe(true);
  expect((await spy.mock.results[2].value).failure).toBeUndefined(); unsaved();
});

it('consumes real Worker Jev-to-Luna fallback through focused authorization before explicit save', async () => {
  const proxyUrl = 'https://proxy.fixture.test/chat/completions';
  vi.spyOn(aiConfig, 'usesCloudflareOpenAiProxy').mockReturnValue(true);
  vi.spyOn(aiConfig, 'getCloudflareAiProxyUrl').mockReturnValue(proxyUrl);
  vi.spyOn(firebaseClient, 'getFirebaseAuth').mockReturnValue({
    currentUser: { getIdToken: async () => 'fixture-session' },
  } as ReturnType<typeof firebaseClient.getFirebaseAuth>);
  const completionFixture = fetch;
  const proxyRequests: Array<RequestBody & { decisionContext?: FocusedAuthorizationDecisionContext }> = [];
  const fallbackOrder: string[] = [];
  const jevRequests: Array<{ state: FocusedAuthorizationDecisionContext['state'] }> = [];
  const env = {
    OPENAI_API_KEY: 'fixture-luna-key', OPENROUTER_API_KEY: 'fixture-jev-key',
    OPENAI_BASE_URL: 'https://provider.fixture.test/v1', FIREBASE_WEB_API_KEY: 'fixture-project',
    JEV_FOCUSED_AUTHORIZATION_MODE: 'canary', JEV_FOCUSED_AUTHORIZATION_CANARY_PERCENT: '100', JEV_MODE: 'canary', JEV_CANARY_PERCENT: '100',
    AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 1 }) }) },
  };
  // The app (DOM/ES2020) and Worker (Cloudflare/ES2022) are typechecked separately.
  // Load the real Worker at this HTTP seam without merging their ambient type environments.
  const { default: worker } = await vi.importActual<{
    default: { fetch(request: Request, bindings: typeof env): Promise<Response> };
  }>('../../../../workers/ai-proxy/src/worker');
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const endpoint = String(url);
    if (endpoint === proxyUrl) {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fixture-session');
      proxyRequests.push(JSON.parse(String(init?.body)));
      return worker.fetch(new Request(endpoint, init), env);
    }
    if (endpoint.startsWith('https://identitytoolkit.googleapis.com/')) {
      return Response.json({ users: [{ localId: OWNER, emailVerified: true }] });
    }
    if (endpoint.endsWith('/api/alpha/decisions')) {
      fallbackOrder.push('jev');
      jevRequests.push(JSON.parse(String(init?.body)));
      return Response.json({ error: 'fixture temporarily unavailable' }, { status: 503 });
    }
    const body = JSON.parse(String(init?.body)) as RequestBody;
    if (body.response_format?.json_schema?.name === 'weekly_planning_focused_authorization_v5') fallbackOrder.push('luna');
    return completionFixture(url, init);
  }));
  responseDocument = { ...semantic(), planningIntent: 'discuss' };
  const spy = gateway(); const { ref, database, submit, unsaved } = await mount();
  await submit();
  expect(ref.current!.state.intakeState?.status).toBe('needs_scope');
  expect(ref.current!.state.previewCandidates).toEqual([]); unsaved();
  const acceptedGraph = structuredClone(ref.current!.exportConversationSnapshot()!.graph);
  expect(acceptedGraph.tasks).toHaveLength(1);
  calls = []; proxyRequests.length = 0; semanticCount = 0;
  expect((await submit('その条件で作成してください')).accepted).toBe(true);
  expect((await spy.mock.results[1].value).failure).toBeUndefined();
  expect(fallbackOrder).toEqual(['jev', 'luna']);
  expect(jevRequests).toHaveLength(1);
  expect(jevRequests[0].state.currentUserText).toBe('その条件で作成してください');
  const focusedRequests = proxyRequests.filter(request => request.decisionContext?.purpose === 'focused_authorization');
  expect(focusedRequests).toHaveLength(1);
  expect(focusedRequests[0].decisionContext).toMatchObject({
    requestId: spy.mock.calls[1][0].pending.requestId, inputRevision: acceptedGraph.revision,
    previousStatus: 'needs_scope', hasTasks: true, hasPendingQuestion: false,
    state: { currentUserText: 'その条件で作成してください' },
  });
  expect(semanticCount).toBe(0);
  const candidates = ref.current!.state.previewCandidates!;
  expect(candidates.length).toBeGreaterThan(0); unsaved();
  const approvedGraph = ref.current!.exportConversationSnapshot()!.graph;
  for (const key of ['tasks', 'workloads', 'effortEstimates'] as const) expect(approvedGraph[key]).toEqual(acceptedGraph[key]);
  expect(candidates.map(candidate => candidate.title)).toEqual(['数学 20問']);
  // The existing allocation policy adds 10% safety and rounds 40 minutes up to a 5-minute slot.
  expect(candidates.reduce((minutes, candidate) => minutes + candidate.durationMinutes, 0)).toBe(45);
  const blocks = createWeeklyDraftBlocksFromPreviewCandidates({ candidates, userId: OWNER, createdAt: new Date().toISOString() });
  await act(async () => { ref.current!.createDraftBlocks(blocks); }); unsaved();
  expect(ref.current!.approvalAvailability.kind).toBe('eligible');
  await act(async () => { await ref.current!.approveDraftBlocks(); });
  expect(database.metrics.planWrites).toBe(candidates.length);
  expect(database.plans.size).toBe(candidates.length);
  for (const plan of database.plans.values()) {
    expect(candidates).toContainEqual(expect.objectContaining({ title: plan.title, date: plan.date, startTime: plan.startTime, endTime: plan.endTime }));
  }
  await act(async () => { await ref.current!.approveDraftBlocks(); });
  expect(database.metrics.planWrites).toBe(candidates.length);
});

it.each(['preview', 'draft'] as const)('binds the current owner bookshelf through one real acceptance and preserves %s on provider failure', async retained => {
  const userText = '8月17日から23日で金フレ20語を1語2分で計画してください';
  const shelf: StudyMaterial = {
    id: 'gold-phrase', userId: OWNER, name: '金フレ', aliases: ['金フレ'],
    subjectId: 'english', subjectName: '英語', status: 'active', paceEnabled: true,
    progressUnit: 'word', totalUnits: 1000, currentUnit: 200, targetDate: '2026-08-23',
    createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-15T00:00:00Z',
  };
  const studyMaterials = [shelf, { ...shelf, id: 'foreign-shelf', userId: 'another-owner', name: '非所有教材' }];
  const materialBefore = structuredClone(studyMaterials);
  const document = semantic();
  document.tasks[0] = {
    ...document.tasks[0], title: '金フレ', existingPublicId: null,
    sourceText: '金フレ20語を1語2分', workloads: [],
    study: { purpose: 'self_study', contextLabel: '金フレ', components: [{
      localId: 'material', existingPublicId: shelf.id, parentLocalId: null,
      role: 'material', label: '金フレ', sourceText: '金フレ20語',
      workloads: [{ ...document.tasks[0].workloads[0], unitCode: 'word', unitLabel: '語', sourceText: '金フレ20語' }],
    }] },
    effortEstimates: [{ ...document.tasks[0].effortEstimates[0], unitCode: 'word', sourceText: '1語2分' }],
  };
  responseDocument = document;
  const rawProviderResponse = JSON.stringify(document);
  const spy = gateway();
  const storage = createMemoryStorageHarness(); restoreStorage = installWeeklyPlanningTestStorage(storage.storage);
  const planRepository = createLocalPlannerRepository(storage.storage);
  const save = vi.fn(async (draft: PlanDraft) => planRepository.upsertPlan(createPlanFromDraft(draft)));
  const ref = createRef<WeeklyPlanningApplication>();
  const renderMaterial = async () => {
    const plans = await planRepository.getPlans(OWNER);
    await act(async () => { renderer = create(<Harness ref={ref} userId={OWNER} selectedDate={WEEK}
      plans={plans} studyMaterials={studyMaterials} scheduleTemplates={[]}
      isPlannerDataSnapshotCurrent={() => true} plannerDataAvailability={createReadyPlannerDataAvailability(OWNER)}
      saveWeeklyApprovedPlan={save} />); });
  };
  const reloadMaterial = async () => {
    await act(async () => { renderer!.unmount(); }); renderer = undefined;
    resetWeeklyPlanningStableV5RuntimeSessionsForTest(); clearWeeklyPlanningSessionRuntime();
    await renderMaterial();
  };
  const checkpoint = () => loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK })!;
  const traceRepository = createNoopWeeklyPlanningTraceRepository();
  const append = vi.spyOn(traceRepository, 'appendEntries').mockRejectedValueOnce(new Error('material trace append failed'));
  setWeeklyPlanningTraceRepositoryForTests(traceRepository);
  vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'true');
  await renderMaterial();
  await act(async () => { expect((await ref.current!.submitTurn(userText)).accepted).toBe(true); });
  expect(calls.map(call => call.schema)).toEqual([
    'weekly_planning_semantic_document_v5', 'weekly_planning_stable_v5_dialogue_response',
  ]);
  expect(semanticCount).toBe(1); expect(JSON.stringify(responseDocument)).toBe(rawProviderResponse);
  const execution = await spy.mock.results[0].value;
  expect(execution.failure).toBeUndefined(); expect(execution.responseSource).toBe('ai');
  const pending = spy.mock.calls[0][0].pending;
  const request = calls[0].body;
  for (const message of request.messages) expect(new TextEncoder().encode(message.content).byteLength).toBeLessThanOrEqual(20_000);
  const providerInput = JSON.parse(request.messages[request.messages.length - 1].content);
  expect(providerInput.publicStateSummary.registeredMaterials).toEqual([
    expect.objectContaining({ materialId: shelf.id, name: shelf.name, remainingUnits: 800 }),
  ]);
  expect(JSON.stringify(providerInput)).not.toContain('foreign-shelf');
  const graph = structuredClone(ref.current!.exportConversationSnapshot()!.graph);
  expect(graph.tasks).toHaveLength(1); expect(graph.components).toHaveLength(1);
  expect(graph.workloads).toHaveLength(1); expect(graph.effortEstimates).toHaveLength(1);
  expect(graph.appliedTurnKeys).toHaveLength(1);
  expect(graph.components[0]).toMatchObject({ taskId: graph.tasks[0].id, role: 'material', label: '金フレ' });
  expect(graph.workloads[0]).toMatchObject({ taskId: graph.tasks[0].id, componentId: graph.components[0].id,
    quantityRole: 'target', amount: 20, unitCode: 'word' });
  expect(graph.effortEstimates[0]).toMatchObject({ targetFactId: graph.workloads[0].id, minutes: 2 });
  const factIds = graph.factLifecycles.map(fact => fact.factId);
  expect(factIds).not.toContain(shelf.id); expect(factIds).not.toContain('foreign-shelf');
  const roots = [graph.tasks[0].id, graph.components[0].id, graph.workloads[0].id, graph.effortEstimates[0].id];
  const candidates = structuredClone(ref.current!.state.previewCandidates!);
  expect(candidates).toEqual([expect.objectContaining({ title: '金フレ 20語', durationMinutes: 45,
    stableV5Metadata: expect.objectContaining({ sourceFactRefs: roots }) })]);
  expect(measureWeeklyPlanningTraceJsonBytes(candidates[0])).toBeLessThanOrEqual(1_000);
  expect(measureWeeklyPlanningTraceJsonBytes(providerInput.publicStateSummary)).toBeLessThanOrEqual(3_000);
  expect(new TextEncoder().encode(rawProviderResponse).byteLength).toBeLessThanOrEqual(4_000);
  expect(checkpoint().graph).toEqual(graph); expect(checkpoint().planningState.previewCandidates).toEqual(candidates);
  expect(save).not.toHaveBeenCalled(); expect(await planRepository.getPlans(OWNER)).toEqual([]);

  // The real controller generated this trace. The failed append's actual input
  // is read from persistent outbox storage, not a reconstructed semantic event.
  expect(append).toHaveBeenCalledTimes(1);
  const queued = listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: pending.conversationId });
  expect(queued).toHaveLength(1); expect(queued[0].input.requestId).toBe(pending.requestId);
  const persistedOutbox = JSON.parse(storage.storage.getItem('studyplanner.weeklyPlanning.trace.outbox.v1')!);
  expect(persistedOutbox.items).toEqual(queued);
  expect(queued[0].input.debugTraceEvents).toContainEqual(expect.objectContaining({
    stage: 'semantic_provider_request', data: expect.objectContaining({
      attempt: 'initial', request: expect.objectContaining({ messages: request.messages }),
    }),
  }));
  expect(queued[0].input.debugTraceEvents).toContainEqual(expect.objectContaining({
    stage: 'semantic_canonicalization_evaluated', data: expect.objectContaining({
      result: { status: 'applied' }, localReferenceResolution: expect.objectContaining({
        task: graph.tasks[0].id, material: graph.components[0].id, work: graph.workloads[0].id,
      }),
    }),
  }));
  resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
  const reread = listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: pending.conversationId });
  expect(reread).toEqual(persistedOutbox.items);
  await recordWeeklyPlanningStableV5TurnTrace(reread[0].input);
  expect(append).toHaveBeenCalledTimes(2);
  expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: pending.conversationId })).toEqual([]);
  const expectedDiagnostic = {
    kind: 'turn_diagnostic', requestId: pending.requestId, logicalConversationId: pending.conversationId,
    aiInterpreter: {
      input: { planningStateSummary: expect.objectContaining({ registeredMaterials: providerInput.publicStateSummary.registeredMaterials }) },
      rawResponses: [expect.objectContaining({ attempt: 'initial', text: rawProviderResponse, truncated: false })],
      structuredResults: [expect.objectContaining({ attempt: 'initial', accepted: true, errors: [] })],
    },
    decision: { finalOperations: [expect.objectContaining({ added: expect.arrayContaining([
      { kind: 'component', id: graph.components[0].id }, { kind: 'workload', id: graph.workloads[0].id },
    ]) })] },
    constraintContext: { scheduler: { preview: { candidateCount: 1, representativeCandidates: [
      expect.objectContaining({ title: candidates[0].title, stableV5Metadata: expect.objectContaining({ sourceFactRefs: roots }) }),
    ] } } },
  };
  for (const [write] of append.mock.calls) {
    expect(write.entries).toHaveLength(1); expect(write.entries[0]).toMatchObject(expectedDiagnostic);
    expect(measureWeeklyPlanningTraceJsonBytes(write.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const prepared = prepareWeeklyPlanningTraceServerWrite({ session: { ...write.session }, entries: write.entries.map(entry => ({ ...entry })) },
      { token: `wpt_${'b'.repeat(43)}`, epoch: '101' }, {
        sessionId: 'weekly-trace-223e4567-e89b-52d3-a456-426614174000', logicalConversationId: pending.conversationId,
      }, new Date().toISOString());
    expect(prepared.entries).toHaveLength(1); expect(prepared.entries[0]).toMatchObject(expectedDiagnostic);
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
  }
  // Derive transport-extension probes from the real generated input event.
  // Only future fields are added; these are not additional planning/provider turns.
  const actualInputEvent = reread[0].input.debugTraceEvents!.find(event => event.stage === 'semantic_pipeline_input');
  expect(actualInputEvent).toBeDefined();
  for (const oversized of [false, true]) {
    const requestId = `${pending.requestId}:material-extension:${oversized}`;
    const data = structuredClone(actualInputEvent!.data) as {
      publicStateSummary: { registeredMaterials: Array<Record<string, unknown>> };
    };
    data.publicStateSummary.registeredMaterials[0].futureRegisteredMaterialField = 'material-projection-future-sentinel';
    if (oversized) data.publicStateSummary.registeredMaterials[0].futureOversizedMaterialFields = [
      'HEAD-' + 'あ'.repeat(8000) + '-TAIL', 'HEAD-' + 'あ'.repeat(8000) + '-TAIL',
    ];
    recordWeeklyPlanningStableV5DebugTrace({ requestId, stage: actualInputEvent!.stage, data });
    const [projectedEvent] = takeWeeklyPlanningStableV5DebugTrace(requestId);
    expect(projectedEvent.stage).toBe(actualInputEvent!.stage);
    await recordWeeklyPlanningStableV5TurnTrace({ ...reread[0].input, requestId,
      debugTraceEvents: reread[0].input.debugTraceEvents!.map(event => event === actualInputEvent
        ? { ...event, data: projectedEvent.data } : event),
    });
    const write = append.mock.calls[append.mock.calls.length - 1][0];
    const expectedSummary = oversized
      ? expect.objectContaining({ traceTruncated: true, originalBytes: expect.any(Number),
        jsonHead: expect.any(String), jsonTail: expect.any(String) })
      : expect.objectContaining({ registeredMaterials: [expect.objectContaining({ materialId: shelf.id,
        futureRegisteredMaterialField: 'material-projection-future-sentinel' })] });
    const expected = { ...expectedDiagnostic, requestId,
      aiInterpreter: { ...expectedDiagnostic.aiInterpreter, input: { planningStateSummary: expectedSummary } },
    };
    expect(write.entries[0]).toMatchObject(expected);
    if (oversized) {
      expect(write.entries[0]).toMatchObject({ diagnostics: { truncation: { applied: true,
        fields: expect.arrayContaining(['aiInterpreter.input.planningStateSummary']) } } });
      expect(JSON.stringify(write.entries[0])).not.toContain('あ'.repeat(8000));
    }
    expect(measureWeeklyPlanningTraceJsonBytes(write.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const prepared = prepareWeeklyPlanningTraceServerWrite({ session: { ...write.session }, entries: write.entries.map(entry => ({ ...entry })) },
      { token: `wpt_${'b'.repeat(43)}`, epoch: '101' }, {
        sessionId: 'weekly-trace-223e4567-e89b-52d3-a456-426614174000', logicalConversationId: pending.conversationId,
      }, new Date().toISOString());
    expect(prepared.entries).toHaveLength(1); expect(prepared.entries[0]).toMatchObject(expected);
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
  }
  expect(append).toHaveBeenCalledTimes(4);
  // Deep validated component payloads have the existing collector depth bound;
  // raw provider output + actual canonical diff/roots prove projection instead.
  await reloadMaterial();
  expect(ref.current!.state.previewCandidates).toEqual(candidates); expect(checkpoint().graph).toEqual(graph);
  const blocks = createWeeklyDraftBlocksFromPreviewCandidates({ candidates, userId: OWNER, createdAt: new Date().toISOString() });
  if (retained === 'draft') await act(async () => { ref.current!.createDraftBlocks(blocks); });
  const previewBefore = structuredClone(ref.current!.state.previewCandidates);
  const draftsBefore = structuredClone(ref.current!.pendingDraftBlocks);
  const intakeBefore = structuredClone(ref.current!.state.intakeState);
  expect(previewBefore).toEqual(retained === 'draft' ? [] : candidates);
  expect(draftsBefore).toEqual(retained === 'draft' ? blocks : []);
  mode = 'network'; calls = []; semanticCount = 0;
  await act(async () => { expect(await ref.current!.submitTurn(userText)).toEqual({ accepted: true, draftCandidates: [] }); });
  const failure = await spy.mock.results[1].value;
  expect(failure.failure).toMatchObject({ code: 'stable_v5_provider_failure', diagnostics: { attemptCount: 1, repairAttempted: false } });
  expect(calls.map(call => call.schema)).toEqual(['weekly_planning_semantic_document_v5']);
  expect(ref.current!.state.intakeState).toEqual(intakeBefore);
  expect(ref.current!.exportConversationSnapshot()!.graph).toEqual(graph);
  expect(ref.current!.state.previewCandidates).toEqual(previewBefore); expect(ref.current!.pendingDraftBlocks).toEqual(draftsBefore);
  expect(checkpoint().graph).toEqual(graph); expect(save).not.toHaveBeenCalled();
  expect(await planRepository.getPlans(OWNER)).toEqual([]);
  await reloadMaterial();
  expect(checkpoint().graph).toEqual(graph);
  expect(ref.current!.state.previewCandidates).toEqual(previewBefore); expect(ref.current!.pendingDraftBlocks).toEqual(draftsBefore);
  if (retained === 'preview') await act(async () => { ref.current!.createDraftBlocks(blocks); });
  expect(ref.current!.pendingDraftBlocks[0].behaviorMetadata?.sourceFactRefs).toEqual(roots);
  expect(ref.current!.approvalAvailability.kind).toBe('eligible');
  await act(async () => { await ref.current!.approveDraftBlocks(); });
  expect(save).toHaveBeenCalledTimes(1);
  const plans = await createLocalPlannerRepository(storage.storage).getPlans(OWNER);
  expect(plans).toEqual([expect.objectContaining({ userId: OWNER, title: candidates[0].title,
    date: candidates[0].date, startTime: candidates[0].startTime, endTime: candidates[0].endTime,
    sourceType: WEEKLY_PLANNING_PLAN_SOURCE_TYPE })]);
  const operations = loadWeeklyPlanningApprovalOperations(OWNER);
  expect(operations).toEqual([expect.objectContaining({ status: 'completed', conversationId: pending.conversationId,
    items: [expect.objectContaining({ sourceDraftBlockId: blocks[0].id, status: 'saved' })] })]);
  expect(parseWeeklyPlanningPlanSourceId(plans[0].sourceId)).toEqual({ approvalOperationId: operations[0].approvalOperationId, sourceDraftBlockId: blocks[0].id });
  expect(JSON.parse(storage.storage.getItem('studyplanner.scheduleEvents.v1')!)).toEqual([
    expect.objectContaining({ id: `plan:${plans[0].id}`, provenance: expect.objectContaining({ sourceId: plans[0].sourceId }) }),
  ]);
  await reloadMaterial();
  expect(ref.current!.pendingDraftBlocks).toEqual([]); expect(checkpoint().graph).toEqual(graph);
  expect(await createLocalPlannerRepository(storage.storage).getPlans(OWNER)).toEqual(plans);
  await act(async () => { await ref.current!.approveDraftBlocks(); });
  expect(save).toHaveBeenCalledTimes(1); expect(studyMaterials).toEqual(materialBefore);
});
