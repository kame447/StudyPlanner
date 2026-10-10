import { loadWeeklyPlanningApprovalOperations } from './weeklyPlanningApprovalLedgerStorage';
import * as planningEvaluation from './weeklyPlanningStableV5PlanningEvaluation';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { resolveWeeklyPlanningQuestionPresentationFreshness } from '../intake/weeklyPlanningQuestionPresentation';
import { loadWeeklyPlanningRuntimeModule } from './weeklyPlanningRuntimeModule';
import * as failureDiagnostics from '../semantic/weeklyPlanningStableV5FailureDiagnostics';
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
let calls: RequestRecord[]; let mode: 'valid' | 'repair' | 'exhausted' | 'timeout' | 'network' | 'repair_network'; let semanticCount: number;
let started: ReturnType<typeof createDeferred<void>>;
let responseDocument: WeeklyPlanningSemanticDocumentV5;
let recoveryVerdict: 'yes' | 'no';
const RECOVERY_TEXT = '今回の内容は計画へ反映していません。これまでの内容と前の候補はそのままです。今回伝えたいことをもう少し詳しく教えてもらえますか？';
const gateway = () => vi.spyOn(weeklyPlanningTurnRuntimeGateway, 'execute'); // Call through to the real executor.
function resetRuntime() {
  resetWeeklyPlanningStableV5RuntimeSessionsForTest(); clearWeeklyPlanningSessionRuntime();
  resetUserPlanningContextRuntimeForTestV1(); resetWeeklyPlanningStableV5DebugTraceForTest();
  resetOpenAiCompatibleClientRequestBudgetForTest(); setWeeklyPlanningTraceRepositoryForTests(undefined);
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime('2026-08-16T00:00:00Z');
  vi.stubEnv('VITE_AI_PROVIDER', 'openai'); vi.stubEnv('VITE_AI_BASE_URL', 'https://provider.fixture.test/v1');
  vi.stubEnv('VITE_AI_MODEL', 'fixture'); vi.stubEnv('VITE_AI_API_KEY', 'fixture-key'); vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'false');
  resetRuntime(); recoveryVerdict = 'yes'; responseDocument = semantic(); calls = []; mode = 'valid'; semanticCount = 0; started = createDeferred<void>();
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(String(url)).toBe('https://provider.fixture.test/v1/chat/completions');
    const body = JSON.parse(String(init?.body)) as RequestBody; const schema = body.response_format?.json_schema?.name ?? '';
    calls.push({ schema, body, signal: init?.signal });
    let content: string;
    if (schema.includes('weekly_planning_semantic')) {
      semanticCount += 1;
      if (mode === 'network' || (mode === 'repair_network' && semanticCount === 2)) throw new TypeError('Failed to fetch');
      if (mode === 'timeout') {
        const signal = init?.signal; expect(signal).toBeDefined(); started.resolve();
        return new Promise<Response>((_resolve, reject) => signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
      }
      content = mode === 'exhausted' || mode === 'repair_network' ? (semanticCount === 1 ? 'not-json' : '{}')
        : mode === 'repair' && semanticCount === 1 ? 'not-json' : JSON.stringify(responseDocument);
    } else if (schema === 'weekly_planning_focused_authorization_v5') {
      content = JSON.stringify({ decision: 'create_plan' });
    } else if (schema === 'weekly_planning_stable_v5_dialogue_response') {
      const prompt = JSON.parse(body.messages[body.messages.length - 1].content);
      const decision = prompt.applicationDecision;
      content = JSON.stringify({ actionId: prompt.actionId, actionKind: decision.actionKind, questionCode: decision.questionCode,
        groundingAcknowledgement: null, text: decision.recovery ? RECOVERY_TEXT : `内容を確認してください。${decision.previewPromotionControlLabel ?? ''}` });
    } else if (schema === 'weekly_planning_recovery_verdict') {
      const prompt = JSON.parse(body.messages[body.messages.length - 1].content);
      content = JSON.stringify({ actionId: prompt.actionId, questionMatches: 'yes',
        planningDetailsNotApplied: 'yes', acceptedStateUnchanged: 'yes', retainedPreviewUnchanged: 'yes',
        noUnsupportedClaims: recoveryVerdict });
    } else { throw new Error(`Unexpected provider schema: ${schema}`); }
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  // This suite measures provider/preview/save behavior; code-load retry has its own tests.
  // Configure the real runtime's environment and transport before loading it, without a turn.
  const codeLoadStartedAt = performance.now();
  await loadWeeklyPlanningRuntimeModule();
  expect(fetch).not.toHaveBeenCalled();
  expect(calls).toEqual([]);
  console.info('[ProviderBoundary fixture] runtime code ready', { elapsedMs: performance.now() - codeLoadStartedAt, providerCalls: calls.length });
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
it.each([
  { failureMode: 'exhausted', verdict: 'yes' },
  { failureMode: 'exhausted', verdict: 'no' },
  { failureMode: 'timeout', verdict: 'yes' },
  { failureMode: 'network', verdict: 'yes' },
  { failureMode: 'repair_network', verdict: 'yes' },
] as const)('preserves accepted preview after $failureMode / recovery verdict $verdict and admits a later healthy turn', async ({ failureMode, verdict }) => {
  recoveryVerdict = verdict;
  const recordedFailures = vi.spyOn(failureDiagnostics, 'recordWeeklyPlanningStableV5FailureDiagnostics');
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
  const expectedAttempts = failureMode === 'exhausted' || failureMode === 'repair_network' ? 2 : 1;
  expect(result.accepted).toBe(true); expect(result.draftCandidates).toEqual([]);
  const execution = await spy.mock.results[1].value;
  expect(execution.failure).toMatchObject({ code: providerFailure ? 'stable_v5_provider_failure' : 'stable_v5_normalization_rejected',
    diagnostics: { attemptCount: expectedAttempts, repairAttempted: expectedAttempts === 2 } });
  expect(semanticCount).toBe(expectedAttempts);
  expect(recordedFailures).toHaveBeenCalledTimes(1);
  const recorded = recordedFailures.mock.calls[0][0];
  expect(recorded.status).toBe(providerFailure ? 'provider_failure' : 'normalization_rejected');
  expect(recorded.diagnostics.providerDispatch).toEqual({
    count: expectedAttempts, anyFailure: providerFailure, complete: true,
  });
  if (providerFailure) {
    expect(recorded.diagnostics.providerError).not.toBeNull();
    expect(calls.map(call => call.schema)).toEqual(Array(expectedAttempts).fill('weekly_planning_semantic_document_v5'));
    expect(execution.responseSource).toBe('system');
    expect(execution.recoveryPresentation).toBeUndefined();
  } else {
    expect(recorded.diagnostics.providerError).toBeNull();
    expect(calls.map(call => call.schema)).toEqual([
      'weekly_planning_semantic_document_v5', 'weekly_planning_semantic_document_v5',
      'weekly_planning_stable_v5_dialogue_response', 'weekly_planning_recovery_verdict',
    ]);
    const generatedFor = JSON.parse(calls[2].body.messages[calls[2].body.messages.length - 1].content);
    const obligations = { planningDetailsNotApplied: true, acceptedStateUnchanged: true, retainedPreviewUnchanged: true };
    expect(generatedFor.applicationDecision).toMatchObject({
      actionKind: 'status', questionCode: null, recovery: obligations,
    });
    expect(JSON.parse(calls[3].body.messages[calls[3].body.messages.length - 1].content)).toEqual({
      actionId: generatedFor.actionId, recovery: obligations, question: null, text: RECOVERY_TEXT,
    });
    expect(execution.responseSource).toBe(verdict === 'yes' ? 'ai' : 'system');
    if (verdict === 'yes') {
      expect(execution.message).toBe(RECOVERY_TEXT);
      expect(execution.recoveryPresentation).toEqual({ question: null });
    } else {
      expect(execution.message).not.toBe(RECOVERY_TEXT);
      expect(execution.recoveryPresentation).toBeUndefined();
    }
  }
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

it('keeps task-total evidence through displayed date repair, clock correction and explicit approval', async () => {
  const storage = createMemoryStorageHarness(); restoreStorage = installWeeklyPlanningTestStorage(storage.storage);
  const database = createWeeklyPlanningApprovalMemoryState();
  const repository = createMemoryWeeklyPlanningApprovalPlanRepository(database);
  const ref = createRef<WeeklyPlanningApplication>();
  const props: UseWeeklyPlanningApplicationInput = { userId: OWNER, selectedDate: WEEK, plans: [], scheduleTemplates: [],
    isPlannerDataSnapshotCurrent: () => true, plannerDataAvailability: createReadyPlannerDataAvailability(OWNER),
    saveWeeklyApprovedPlan: repository.saveApprovedPlan, completeWeeklyApprovalOperation: repository.completeOperation };
  const mountApp = async () => { await act(async () => { renderer = create(<Harness ref={ref} {...props} />); }); };
  const unsaved = () => {
    expect(database.metrics).toEqual({ planWrites: 0, itemWrites: 0, operationWrites: 0 });
    expect(database.plans.size).toBe(0); expect(database.operations.size).toBe(0); expect(database.items.size).toBe(0);
  };
  const spy = gateway();
  const evaluationSpy = vi.spyOn(planningEvaluation, 'evaluateWeeklyPlanningStableV5Planning'); // Call through.
  const texts = [
    '計画期間は8月17日だけ。数学を合計60分、8月17日19時以降に計画してください。',
    '数学の開始条件を8月17日19時以降から8月19日20時以降に変更してください。',
    '計画期間は8月19日だけに変更してください。',
    '数学の開始条件を8月19日20時以降から8月19日21時以降に変更してください。',
  ];
  const acknowledgements = [
    '数学は合計60分、計画期間は8月17日だけで、開始は同日19時以降ですね。',
    '数学の開始は8月19日20時以降ですね。',
    '計画期間は8月19日だけですね。',
    '数学の開始は8月19日21時以降ですね。',
  ];
  let nextDocument = semantic();
  nextDocument.planningWindow = { localId: 'window-17', kind: 'absolute', value: `${WEEK}/${WEEK}`,
    start: WEEK, end: WEEK, sourceText: '計画期間は8月17日だけ' };
  const task = nextDocument.tasks[0]; task.workloads = []; task.sourceText = '数学を合計60分';
  task.effortEstimates = [{ localId: 'total-60', targetLocalId: task.localId, kind: 'total_duration',
    minutes: 60, unitCode: null, precision: 'exact', sourceText: '合計60分' }];
  task.temporalConstraints = [{ localId: 'start-17-19', targetLocalId: task.localId, kind: 'earliest_start',
    constraintLevel: 'hard', dateExpression: WEEK, namedTimePeriod: null, startTime: '19:00', endTime: null,
    precision: 'exact', sourceText: '8月17日19時以降' }];
  const renderedTexts: string[] = [];
  const fixtureErrors: Array<Record<string, unknown>> = [];
  const rawRequests: Array<{ endpoint: string; body: string }> = [];
  let temporalTargetId: string | undefined;
  let temporalTargetRevision: number | undefined;
  let renderingCount = 0;
  calls = []; semanticCount = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    rawRequests.push({ endpoint: String(url), body: String(init?.body) });
    let body: RequestBody | undefined;
    let schema = '';
    try {
      body = JSON.parse(rawRequests[rawRequests.length - 1].body) as RequestBody;
      schema = body.response_format?.json_schema?.name ?? '';
      calls.push({ schema, body, signal: init?.signal });
      if (schema === 'weekly_planning_semantic_document_v5') semanticCount += 1;
      expect(String(url)).toBe('https://provider.fixture.test/v1/chat/completions');
      const userMessages = body.messages.filter(message => message.role === 'user');
      expect(userMessages).toHaveLength(1); expect(typeof userMessages[0]?.content).toBe('string');
      const prompt = JSON.parse(userMessages[0].content);
      let content: string;
      if (schema === 'weekly_planning_semantic_document_v5') {
        expect(semanticCount).toBeGreaterThanOrEqual(1); expect(semanticCount).toBeLessThanOrEqual(4);
        expect(prompt.userText).toBe(texts[semanticCount - 1]);
        if (semanticCount === 3) expect(prompt.publicStateSummary.pendingQuestion).toMatchObject({
          questionCode: 'hard_date_bound_outside_planning_window', targetFactId: temporalTargetId,
          graphRevision: temporalTargetRevision,
        });
        content = JSON.stringify(nextDocument);
      } else if (schema === 'weekly_planning_stable_v5_dialogue_response') {
        renderingCount += 1; expect(renderingCount).toBe(semanticCount);
        const decision = prompt.applicationDecision;
        if (renderingCount === 2) expect(decision.questionCode).toBe('hard_date_bound_outside_planning_window');
        const acknowledgement = prompt.currentTurnGrounding.mode === 'required_before_resume'
          ? { factIds: prompt.currentTurnGrounding.acceptedFacts.map((fact: { factId: string }) => fact.factId),
              text: acknowledgements[renderingCount - 1] } : null;
        const text = (acknowledgement?.text ?? '') + (renderingCount === 2
          ? '現在の計画期間は8月17日だけです。数学を進める計画期間は何日にしますか？'
          : `候補を確認して、必要なら「${decision.previewPromotionControlLabel}」を選んでください。`);
        renderedTexts.push(text);
        content = JSON.stringify({ actionId: prompt.actionId, actionKind: decision.actionKind,
          questionCode: decision.questionCode, groundingAcknowledgement: acknowledgement, text });
      } else throw new Error(`Unexpected P2 schema: ${schema}`);
      return new Response(JSON.stringify({ choices: [{ message: { content } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
      { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (error) {
      fixtureErrors.push({ dispatch: rawRequests.length, semanticDispatch: semanticCount, schema,
        messageRoles: body?.messages?.map(message => message.role) ?? [],
        name: error instanceof Error ? error.name : 'NonError',
        message: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }));
  const submit = async (index: number) => {
    const revision = ref.current!.state.revision;
    await act(async () => { expect((await ref.current!.submitTurn(texts[index])).accepted).toBe(true); });
    expect(fixtureErrors).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(index + 1);
    const execution = await spy.mock.results[index].value;
    expect(execution.failure).toBeUndefined(); expect(execution.responseSource).toBe('ai');
    expect(execution.dialogueRendererTrace).toMatchObject({
      response: { status: 'rendered', renderedText: renderedTexts[index] },
      decision: { branch: 'ai_rendered', responseSource: 'ai', finalMessage: renderedTexts[index] },
    });
    const state = ref.current!.state;
    expect(state.pendingTurn).toBeUndefined(); expect(state.revision).toBe(revision + 2);
    expect(state.messages[state.messages.length - 1]?.content).toBe(renderedTexts[index]);
    unsaved(); return execution;
  };
  const graph = () => ref.current!.exportConversationSnapshot()!.graph;
  const active = () => createWeeklyPlanningActiveSchedulerGraphViewV5(graph());
  const evaluation = (index: number) => {
    expect(evaluationSpy).toHaveBeenCalledTimes(index + 1);
    const result = evaluationSpy.mock.results[index];
    expect(evaluationSpy.mock.calls[index][0].input.traceRequestId).toBe(spy.mock.calls[index][0].pending.requestId);
    if (result.type !== 'return') throw new Error('Expected the real planning evaluation result');
    return result.value;
  };
  await mountApp(); unsaved();
  await submit(0);
  const conversationId = ref.current!.exportConversationSnapshot()!.conversationId;
  const first = structuredClone(graph()); const taskId = first.tasks[0].id; const budget = first.effortEstimates[0];
  const firstWindow = active().planningWindows[0]; const firstClock = active().temporalConstraints[0];
  const assertTotal = () => {
    expect(graph().workloads).toEqual([]); // Scheduler derivations never become canonical facts.
    expect(graph().effortEstimates).toEqual([budget]);
    expect(active().effortEstimates).toEqual([budget]);
    expect(budget).toMatchObject({ taskId, targetFactId: taskId, kind: 'total_duration', minutes: 60 });
    expect(active().tasks.map(row => row.id)).toEqual([taskId]);
  };
  const assertPlacement = (index: number, date: string, startTime: string, endTime: string) => {
    assertTotal(); const view = active(); const window = view.planningWindows[0]; const clock = view.temporalConstraints[0];
    expect(view.planningWindows).toHaveLength(1); expect(view.temporalConstraints).toHaveLength(1);
    const candidates = ref.current!.state.previewCandidates!;
    expect(candidates).toEqual([expect.objectContaining({ date, startTime, endTime, durationMinutes: 60,
      stableV5Metadata: expect.objectContaining({ conversationId, taskId, graphRevision: graph().revision, sourceFactRefs: [taskId, budget.id] }) })]);
    const actual = evaluation(index); expect(actual.compilation.status).toBe('ready');
    const compiled = actual.compilation.input!;
    expect(actual.schedulerContext.acceptedPlanningWindow).toEqual({ factId: window.id, startDate: date, endDate: date });
    expect(compiled.horizon).toMatchObject({ startDate: date, endDate: date, planningWindowFactIds: [window.id] });
    expect(compiled.movableWorkItems).toEqual([expect.objectContaining({ taskId, estimatedMinutes: 60, baseEstimatedMinutes: 60, calibrationMultiplier: 1,
      sourceFactRefs: [taskId, budget.id], estimateSourceFactIds: [budget.id] })]);
    expect(candidates[0]).toMatchObject({ workItemKey: compiled.movableWorkItems[0].id });
    expect(compiled.hardClockBounds).toEqual([expect.objectContaining({ taskId, targetFactId: taskId,
      sourceFactId: clock.id, kind: 'earliest_start', anchorDate: date,
      minute: Number(startTime.slice(0, 2)) * 60 })]);
    expect(compiled.hardDateBounds).toEqual([expect.objectContaining({ taskId, targetFactId: taskId,
      startDate: date, sourceFactIds: [clock.id] })]);
    expect(actual.resolvedDateExpressions.facts).toContainEqual(expect.objectContaining({ factId: clock.id,
      status: 'resolved', range: { start: date, end: date } }));
    expect(compiled.sourceFactRefs).toEqual(expect.arrayContaining([taskId, budget.id, window.id, clock.id]));
    const canonicalRoots = new Set([taskId, budget.id, window.id, clock.id]);
    expect(compiled.sourceFactRefs.every(id => canonicalRoots.has(id))).toBe(true);
    return structuredClone(candidates);
  };
  const firstCandidates = assertPlacement(0, WEEK, '19:00', '20:00');
  expect(firstCandidates).toHaveLength(1); expect(ref.current!.pendingDraftBlocks).toEqual([]);
  const changeClock = (localId: string, date: string, time: string, sourceText: string, oldId: string, turn: number) => {
    const document = semantic(); document.planningIntent = 'update_plan'; document.planningWindow = null;
    const changedTask = document.tasks[0]; changedTask.existingPublicId = taskId; changedTask.sourceText = '数学';
    changedTask.workloads = []; changedTask.effortEstimates = [];
    changedTask.temporalConstraints = [{ ...task.temporalConstraints[0], localId, dateExpression: date, startTime: time, sourceText }];
    document.corrections = [{ localId: `replace-clock-${turn}`, operation: 'replace', replacementLocalId: localId,
      target: { kind: 'temporal_constraint', publicId: oldId, localId: null, mention: null }, sourceText: texts[turn] }];
    return document;
  };
  nextDocument = changeClock('start-19-20', '2026-08-19', '20:00', '8月19日20時以降', firstClock.id, 1);
  const second = await submit(1); assertTotal();
  expect(second.preserveExistingPreview).toBe(false);
  const secondClock = active().temporalConstraints[0]; temporalTargetId = secondClock.id; temporalTargetRevision = graph().revision;
  expect(active().planningWindows).toEqual([firstWindow]);
  expect(graph().factLifecycles.find(row => row.factId === firstClock.id)).toMatchObject({ status: 'superseded', supersededByFactId: secondClock.id });
  expect(ref.current!.state.previewCandidates).toEqual([]); // Actual nonempty -> empty, before any promotion.
  expect(ref.current!.pendingDraftBlocks).toEqual([]);
  const secondEvaluation = evaluation(1);
  expect(secondEvaluation.compilation.input).toBeNull();
  expect(secondEvaluation.compilation.issues).toContainEqual(expect.objectContaining({
    code: 'hard_date_bound_outside_planning_window', blocking: true, factId: secondClock.id,
    details: expect.objectContaining({ planningWindowFactId: firstWindow.id }),
  }));
  const questionState = ref.current!.state;
  expect(questionState.intakeState?.lastQuestionContext).toMatchObject({
    targetSlot: 'stable_v5:hard_date_bound_outside_planning_window', topicId: secondClock.id,
    presentation: { assistantMessageId: questionState.messages[questionState.messages.length - 1].id,
      planningStateRevision: questionState.revision, graphRevision: graph().revision },
  });
  expect(resolveWeeklyPlanningQuestionPresentationFreshness({ previousState: questionState.intakeState,
    messages: questionState.messages, inputStateRevision: questionState.revision, graphRevision: graph().revision }).status).toBe('fresh');
  // No promotion or approval attempt may mutate the question revision before its answer.
  nextDocument = { ...semantic(), planningIntent: 'update_plan', tasks: [], planningWindow: {
    localId: 'window-19', kind: 'absolute', value: '2026-08-19/2026-08-19', start: '2026-08-19', end: '2026-08-19',
    sourceText: '計画期間は8月19日だけ' }, corrections: [{ localId: 'replace-window', operation: 'replace', replacementLocalId: 'window-19',
    target: { kind: 'planning_window', publicId: firstWindow.id, localId: null, mention: null }, sourceText: texts[2] }] };
  await submit(2);
  expect(ref.current!.state.intakeState?.questions).toEqual([]);
  const thirdCandidates = assertPlacement(2, '2026-08-19', '20:00', '21:00');
  const currentWindow = active().planningWindows[0];
  expect(graph().factLifecycles.find(row => row.factId === firstWindow.id)).toMatchObject({ status: 'superseded', supersededByFactId: currentWindow.id });
  const oldBlocks = createWeeklyDraftBlocksFromPreviewCandidates({ candidates: thirdCandidates, userId: OWNER, createdAt: new Date().toISOString() });
  const beforePromotion = ref.current!.state.revision;
  await act(async () => { ref.current!.createDraftBlocks(oldBlocks); });
  expect(ref.current!.state.revision).toBe(beforePromotion + 1); expect(ref.current!.pendingDraftBlocks).toEqual(oldBlocks); unsaved();
  nextDocument = changeClock('start-19-21', '2026-08-19', '21:00', '8月19日21時以降', secondClock.id, 3);
  await submit(3);
  const finalCandidates = assertPlacement(3, '2026-08-19', '21:00', '22:00');
  const finalGraph = structuredClone(graph()); const finalClock = active().temporalConstraints[0];
  expect(finalGraph.factLifecycles.find(row => row.factId === secondClock.id)).toMatchObject({ status: 'superseded', supersededByFactId: finalClock.id });
  expect(ref.current!.pendingDraftBlocks).toEqual(oldBlocks);
  expect(ref.current!.approvalAvailability.kind).toBe('recompute_required');
  const beforeRejectedApproval = ref.current!.state.revision;
  await act(async () => { await expect(ref.current!.approveDraftBlocks()).rejects.toThrow('現在の条件と一致しない仮予定'); });
  expect(ref.current!.state.revision).toBe(beforeRejectedApproval + 2);
  expect(ref.current!.state.pendingApproval).toBeUndefined();
  expect(graph()).toEqual(finalGraph); expect(ref.current!.state.previewCandidates).toEqual(finalCandidates); unsaved();
  await act(async () => { oldBlocks.forEach(block => ref.current!.removeDraftBlock(block.id)); });
  const blocks = createWeeklyDraftBlocksFromPreviewCandidates({ candidates: finalCandidates, userId: OWNER, createdAt: new Date().toISOString() });
  await act(async () => { ref.current!.createDraftBlocks(blocks); }); unsaved();
  const beforeReload = structuredClone(ref.current!.state);
  await act(async () => { renderer!.unmount(); }); renderer = undefined;
  resetWeeklyPlanningStableV5RuntimeSessionsForTest(); clearWeeklyPlanningSessionRuntime();
  await mountApp();
  expect(graph()).toEqual(finalGraph); expect(ref.current!.pendingDraftBlocks).toEqual(blocks);
  expect(ref.current!.state.messages).toEqual(beforeReload.messages); expect(ref.current!.state.revision).toBe(beforeReload.revision);
  expect(blocks[0].behaviorMetadata?.sourceFactRefs).toEqual([taskId, budget.id]); unsaved();
  const beforeApproval = ref.current!.state.revision;
  await act(async () => { await ref.current!.approveDraftBlocks(); });
  expect(ref.current!.state.revision).toBe(beforeApproval + 2);
  expect(database.metrics.planWrites).toBe(1); expect(database.plans.size).toBe(1);
  const saved = [...database.plans.values()][0];
  expect(saved).toMatchObject({ userId: OWNER, title: blocks[0].title, date: '2026-08-19', startTime: '21:00', endTime: '22:00', sourceType: WEEKLY_PLANNING_PLAN_SOURCE_TYPE });
  const operation = [...database.operations.values()][0];
  expect(operation).toMatchObject({ userId: OWNER, status: 'completed', savedItemCount: 1 });
  expect([...database.items.values()]).toEqual([expect.objectContaining({ userId: OWNER, status: 'saved',
    savedPlanId: saved.id, sourceDraftBlockId: blocks[0].id, approvalOperationId: operation.approvalOperationId })]);
  expect(loadWeeklyPlanningApprovalOperations(OWNER)).toEqual([expect.objectContaining({
    conversationId, previewStateRevision: finalGraph.revision, approvalOperationId: operation.approvalOperationId, status: 'completed' })]);
  expect(parseWeeklyPlanningPlanSourceId(saved.sourceId)).toEqual({ approvalOperationId: operation.approvalOperationId, sourceDraftBlockId: blocks[0].id });
  await act(async () => { renderer!.unmount(); }); renderer = undefined;
  resetWeeklyPlanningStableV5RuntimeSessionsForTest(); clearWeeklyPlanningSessionRuntime();
  await mountApp(); expect(ref.current!.pendingDraftBlocks).toEqual([]);
  await act(async () => { await ref.current!.approveDraftBlocks(); });
  expect(database.metrics.planWrites).toBe(1);
  expect(fixtureErrors).toEqual([]); expect(semanticCount).toBe(4); expect(renderingCount).toBe(4);
  expect(rawRequests).toHaveLength(8);
  expect(calls.map(call => call.schema)).toEqual(Array.from({ length: 4 }, () =>
    ['weekly_planning_semantic_document_v5', 'weekly_planning_stable_v5_dialogue_response']).flat());
});
