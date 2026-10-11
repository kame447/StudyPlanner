import { createRef, forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlanFromDraft } from '../../../domain/planner';
import type { PlanDraft } from '../../../types/domain';
import { createLocalPlannerRepository } from '../../../repositories/createLocalPlannerRepository';
import { validateWeeklyPreviewApproval } from '../planning/weeklyPlanningApproval';
import { resolveWeeklyPlanningApprovalRuntime } from './weeklyPlanningApprovalRuntimeResolver';
import { loadWeeklyPlanningApprovalOperations } from './weeklyPlanningApprovalLedgerStorage';
import { validateWeeklyPlanningSemanticResponseV5 } from '../semantic/weeklyPlanningSemanticResponseValidationV5';
import { createWeeklyPlanningSemanticPublicStateSummaryV5 } from '../semantic/weeklyPlanningSemanticPublicStateV5';
import * as debugTrace from '../trace/weeklyPlanningStableV5DebugTrace';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from '../trace/weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from '../trace/weeklyPlanningTraceOutbox';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceSession } from '../trace/weeklyPlanningTraceTypes';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { createReadyPlannerDataAvailability } from '../testUtils/plannerDataAvailabilityTest';
import { createDeferred, createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { parseWeeklyPlanningPlanSourceId, WEEKLY_PLANNING_PLAN_SOURCE_TYPE } from '../planning/weeklyPlanningPlanProvenance';
import { clearWeeklyPlanningSessionRuntime } from '../planning/weeklyPlanningSessionRuntime';
import { createWeeklyDraftBlocksFromPreviewCandidates } from '../preview/weeklyPlanningPreviewBlocks';
import { readWeeklyPlanningEstimateMetadata } from '../personalization/weeklyPlanningEstimateCalibration';
import { WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, type WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import type { WeeklyPlanningSemanticNormalizerResultV5 } from '../semantic/weeklyPlanningSemanticNormalizerV5';
import { setWeeklyPlanningTraceRepositoryForTests } from '../trace/weeklyPlanningTraceRepository';
import { resetWeeklyPlanningStableV5DebugTraceForTest } from '../trace/weeklyPlanningStableV5DebugTrace';
import { useWeeklyPlanningApplication, type WeeklyPlanningApplication, type UseWeeklyPlanningApplicationInput } from './useWeeklyPlanningApplication';
import { createWeeklyPlanningApprovalMemoryState, createMemoryWeeklyPlanningApprovalPlanRepository } from './weeklyPlanningApprovalMemoryRepository';
import { getWeeklyPlanningStableV5RuntimeSession, resetWeeklyPlanningStableV5RuntimeSessionsForTest } from './weeklyPlanningStableV5RuntimeSession';
import { getWeeklyPlanningStableV5SessionStorageKeyForTest, loadWeeklyPlanningStableV5PersistedSession } from './weeklyPlanningStableV5SessionStorage';
import type { WeeklyPlanningTurnSubmissionResult } from '../weeklyPlanningTurnExecutionTypes';
import type { WeeklyPlanningStableV5PersistedSession } from './weeklyPlanningStableV5SessionCodec';

const { normalizeMock } = vi.hoisted(() => ({ normalizeMock: vi.fn() }));
// Substitute the external semantic provider only; application, execution,
// scheduling, checkpoint restore, approval, and atomic persistence stay real.
vi.mock('../../../lib/aiConfig', () => ({
  getAiConfig: () => ({ provider: 'openai', baseUrl: 'https://example.invalid/v1', model: 'test-model', apiKey: 'test-key' }),
  getAiConfigValidationMessage: () => undefined,
  getCloudflareAiProxyUrl: () => null,
}));
vi.mock('../../../services/ai/openAiCompatibleClient', () => ({
  createOpenAiCompatibleClient: () => ({ createChatCompletion: vi.fn() }),
}));
vi.mock('../semantic/weeklyPlanningSemanticNormalizerV5', () => ({
  createWeeklyPlanningSemanticNormalizerV5: () => ({ normalize: normalizeMock }),
}));
const OWNER = 'owner-approval-boundary';
const WEEK_START = '2026-08-17';
const Harness = forwardRef<WeeklyPlanningApplication, UseWeeklyPlanningApplicationInput>((props, ref) => {
  const application = useWeeklyPlanningApplication(props);
  useImperativeHandle(ref, () => application, [application]);
  return null;
});
function emptyDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan', planningWindow: null, tasks: [], relations: [],
    availabilityDeclarations: [], constraintSourceRequests: [], uncertainties: [],
    corrections: [], decisions: [],
  };
}

function workloadDocument(): WeeklyPlanningSemanticDocumentV5 {
  const sourceText = '数学の教材を30ページ進めたい';
  const title = '数学の教材';
  return {
    ...emptyDocument(),
    planningIntent: 'create_plan',
    planningWindow: {
      localId: 'window', kind: 'absolute', value: '2026-08-17/2026-08-23',
      start: WEEK_START, end: '2026-08-23', sourceText: '8月17日から23日',
    },
    tasks: [{
      localId: 'task', category: 'study', title, sourceText,
      study: {
        purpose: 'self_study', contextLabel: title, components: [],
      },
      workloads: [{
        localId: 'workload', quantityRole: 'target', amount: 30,
        unitCode: 'page', unitLabel: 'ページ',
        rangeStart: null, rangeEnd: null, perOccurrence: false,
        periodExpression: null, sourceText,
      }],
      effortEstimates: [], temporalConstraints: [], recurrence: [],
    }],
  };
}

function accepted(document: WeeklyPlanningSemanticDocumentV5): WeeklyPlanningSemanticNormalizerResultV5 {
  return {
    status: 'accepted', document,
    diagnostics: {
      schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
      jsonSchemaName: 'weekly_planning_semantic_document_v5',
      normalizerVersion: 'weekly-planning-semantic-normalizer-v5',
      attemptCount: 1, repairAttempted: false, requestBytes: [100], responseLengths: [100],
      latencyMs: 1, validationErrors: [], algorithmicRepairs: [], providerError: null,
    },
  };
}


let renderer: ReactTestRenderer | undefined;
let restoreWindow: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime('2026-08-16T00:00:00.000Z');
  vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'false');
  normalizeMock.mockReset();
  setWeeklyPlanningTraceRepositoryForTests(undefined);
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  resetWeeklyPlanningStableV5DebugTraceForTest();
  clearWeeklyPlanningSessionRuntime();
});
afterEach(() => {
  act(() => renderer?.unmount()); renderer = undefined;
  restoreWindow?.(); restoreWindow = undefined;
  resetWeeklyPlanningStableV5RuntimeSessionsForTest();
  resetWeeklyPlanningStableV5DebugTraceForTest();
  clearWeeklyPlanningSessionRuntime();
  setWeeklyPlanningTraceRepositoryForTests(undefined);
  resetWeeklyPlanningStableV5TraceRuntimeForTest(); vi.restoreAllMocks();
  vi.unstubAllEnvs(); vi.useRealTimers();
});

describe('provisional allocation through application and approval persistence', () => {
  it('persists the computed standard quantity title through actual approval and bounded diagnostics', async () => {
    const storage = createMemoryStorageHarness();
    restoreWindow = installWeeklyPlanningTestStorage(storage.storage);
    const repository = createLocalPlannerRepository(storage.storage);
    const save = vi.fn(async (draft: PlanDraft) => repository.upsertPlan(createPlanFromDraft(draft)));
    const ref = createRef<WeeklyPlanningApplication>();
    const props: UseWeeklyPlanningApplicationInput = {
      userId: OWNER, selectedDate: WEEK_START, plans: [], scheduleTemplates: [],
      isPlannerDataSnapshotCurrent: () => true, plannerDataAvailability: createReadyPlannerDataAvailability(OWNER),
      saveWeeklyApprovedPlan: save,
    };
    const mount = async () => { await act(async () => { renderer = create(<Harness ref={ref} {...props} />); }); };
    const reload = async () => {
      await act(async () => { renderer!.unmount(); }); renderer = undefined;
      resetWeeklyPlanningStableV5RuntimeSessionsForTest(); clearWeeklyPlanningSessionRuntime();
      await mount();
    };
    const document = workloadDocument();
    document.tasks[0].sourceText = '数学の教材を20問進めたい';
    Object.assign(document.tasks[0].workloads[0], {
      amount: 20, unitCode: 'problem', unitLabel: '20問', sourceText: '数学の教材を20問進めたい',
    });
    document.tasks[0].effortEstimates = [{ localId: 'per-problem', targetLocalId: 'workload',
      kind: 'duration_per_unit', minutes: 3, unitCode: 'problem', precision: 'exact', sourceText: '1問3分' }];
    const userText = '8月17日から23日で数学の教材を20問進めたい。1問3分です';
    const validation = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(document), { currentUserText: userText });
    expect(validation.errors).toEqual([]); expect(validation.document).not.toBeNull();
    // External normalization is substituted, as in this suite; generated scheduling,
    // checkpoint, approval, local repository and diagnostic persistence are real.
    normalizeMock.mockResolvedValueOnce(accepted(validation.document!));
    const debug = vi.spyOn(debugTrace, 'recordWeeklyPlanningStableV5DebugTrace');
    await mount();
    await act(async () => { expect((await ref.current!.submitTurn(userText)).accepted).toBe(true); });
    const previewAssistantMessage = ref.current!.state.messages[ref.current!.state.messages.length - 1]?.content;
    const checkpoint = loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK_START })!;
    expect(checkpoint.graph.workloads).toEqual([expect.objectContaining({ amount: 20, unitCode: 'problem', unitLabel: '20問' })]);
    expect(checkpoint.graph.effortEstimates).toEqual([expect.objectContaining({ kind: 'duration_per_unit', minutes: 3 })]);
    const graph = structuredClone(checkpoint.graph);
    const candidates = structuredClone(ref.current!.state.previewCandidates!);
    // 20×3=60 raw minutes, 10% buffer, existing 5-minute rounding =>70.
    expect(candidates).toEqual([expect.objectContaining({ title: '数学の教材 20問', durationMinutes: 70, estimatedMinutes: 70 })]);
    expect(checkpoint.planningState.previewCandidates).toEqual(candidates);
    expect(save).not.toHaveBeenCalled();
    const blocks = createWeeklyDraftBlocksFromPreviewCandidates({ candidates, userId: OWNER, createdAt: new Date().toISOString() });
    await act(async () => { ref.current!.createDraftBlocks(blocks); });
    await reload();
    expect(ref.current!.pendingDraftBlocks).toEqual(blocks);
    expect(ref.current!.pendingDraftBlocks[0].title).toBe('数学の教材 20問');
    expect(getWeeklyPlanningStableV5RuntimeSession(checkpoint.conversationId)?.graph).toEqual(graph);
    expect(save).not.toHaveBeenCalled();
    await act(async () => { await ref.current!.approveDraftBlocks(); });
    expect(save).toHaveBeenCalledTimes(1);
    const plans = await createLocalPlannerRepository(storage.storage).getPlans(OWNER);
    expect(plans).toEqual([expect.objectContaining({ title: '数学の教材 20問',
      date: candidates[0].date, startTime: candidates[0].startTime, endTime: candidates[0].endTime })]);
    await reload();
    expect(await createLocalPlannerRepository(storage.storage).getPlans(OWNER)).toEqual(plans);
    expect(getWeeklyPlanningStableV5RuntimeSession(checkpoint.conversationId)?.graph).toEqual(graph);
    await act(async () => { await ref.current!.approveDraftBlocks(); });
    expect(save).toHaveBeenCalledTimes(1); expect(normalizeMock).toHaveBeenCalledTimes(1);

    const generated = debug.mock.calls.map(([event]) => event)
      .filter((event) => event.stage === 'runtime_preview_scheduler_evaluated');
    expect(generated).toHaveLength(1); debug.mockRestore();
    const event = generated[0];
    expect(event.requestId).toBeTruthy();
    if (!event.requestId) throw new Error('actual request ID missing');
    const data = structuredClone(event.data) as { result: { candidates: Array<Record<string, unknown>> } };
    expect(data.result.candidates).toEqual(candidates);
    data.result.candidates[0].futureQuantityLabelSentinel = 'quantity-label-sentinel';
    resetWeeklyPlanningStableV5TraceRuntimeForTest(); vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'true');
    const writes: Array<{ session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }> = [];
    let fail = true;
    setWeeklyPlanningTraceRepositoryForTests({
      async upsertSession() {},
      async appendEntries(params) { if (fail) { fail = false; throw new Error('injected quantity-label append failure'); } writes.push(structuredClone(params)); },
      async listSessions() { return []; }, async listSessionsForAdmin() { return []; },
      async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; },
    });
    debugTrace.clearWeeklyPlanningStableV5DebugTrace(event.requestId);
    debugTrace.recordWeeklyPlanningStableV5DebugTrace({ ...event, data });
    const traceInput = { userId: OWNER, conversationId: checkpoint.conversationId, requestId: event.requestId,
      userText, assistantMessage: previewAssistantMessage,
      outcome: 'preview_ready', previewCount: 1,
      debugTraceEvents: debugTrace.takeWeeklyPlanningStableV5DebugTrace(event.requestId) };
    await recordWeeklyPlanningStableV5TurnTrace(traceInput);
    expect(writes).toEqual([]);
    const pending = listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: checkpoint.conversationId });
    expect(pending).toHaveLength(1); expect(pending[0].input).toEqual(traceInput);
    expect(JSON.parse(storage.storage.getItem('studyplanner.weeklyPlanning.trace.outbox.v1')!).items[0].input).toEqual(traceInput);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace(traceInput); // flush exact persisted request, then deduplicate it
    expect(writes).toHaveLength(1);
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: checkpoint.conversationId })).toEqual([]);
    const expected = { ...candidates[0], futureQuantityLabelSentinel: 'quantity-label-sentinel' };
    const normal = writes[0].entries[0];
    expect(normal).toMatchObject({ kind: 'turn_diagnostic', requestId: event.requestId,
      logicalConversationId: checkpoint.conversationId,
      constraintContext: { scheduler: { preview: { representativeCandidates: [expected] } } } });
    expect(measureWeeklyPlanningTraceJsonBytes(normal)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const prepare = (write: typeof writes[number]) => prepareWeeklyPlanningTraceServerWrite({
      session: { ...write.session }, entries: write.entries.map((entry) => ({ ...entry })),
    }, { token: `wpt_${'d'.repeat(43)}`, epoch: '103' }, {
      sessionId: 'weekly-trace-523e4567-e89b-52d3-a456-426614174000', logicalConversationId: checkpoint.conversationId,
    }, new Date().toISOString());
    const prepared = prepare(writes[0]);
    expect(prepared.entries).toHaveLength(1);
    expect(prepared.entries[0]).toMatchObject({ kind: 'turn_diagnostic', requestId: event.requestId,
      constraintContext: { scheduler: { preview: { representativeCandidates: [expected] } } } });
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);

    // Stress the same generated candidate only with an unknown large extension.
    // This uses a distinct diagnostic ID, not an invented second planning turn.
    data.result.candidates[0].futureLargeEvidence = `HEAD-${'あ'.repeat(8000)}-TAIL`;
    const largeId = `${event.requestId}:quantity-label-size-probe`;
    debugTrace.recordWeeklyPlanningStableV5DebugTrace({ ...event, requestId: largeId, data });
    await recordWeeklyPlanningStableV5TurnTrace({ ...traceInput, requestId: largeId,
      debugTraceEvents: debugTrace.takeWeeklyPlanningStableV5DebugTrace(largeId) });
    expect(writes).toHaveLength(2);
    const large = writes[1].entries[0];
    if (large.kind !== 'turn_diagnostic') throw new Error('large turn diagnostic missing');
    const bounded = large.constraintContext.scheduler?.preview?.representativeCandidates[0];
    expect(bounded).toMatchObject({ traceTruncated: true, originalBytes: expect.any(Number),
      jsonHead: expect.stringContaining(JSON.stringify(candidates[0].title)) });
    expect(large).toMatchObject({ requestId: largeId, logicalConversationId: checkpoint.conversationId });
    expect(measureWeeklyPlanningTraceJsonBytes(large)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const preparedLarge = prepare(writes[1]);
    expect(preparedLarge.entries).toHaveLength(1);
    expect(preparedLarge.entries[0]).toMatchObject({ kind: 'turn_diagnostic', requestId: largeId,
      constraintContext: { scheduler: { preview: { representativeCandidates: [bounded] } } } });
    expect(measureWeeklyPlanningTraceJsonBytes(preparedLarge.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
  });

  it('admits one real missing-effort question under same-tick and in-flight double submit', async () => {
    const storage = createMemoryStorageHarness();
    restoreWindow = installWeeklyPlanningTestStorage(storage.storage);
    const database = createWeeklyPlanningApprovalMemoryState();
    const repository = createMemoryWeeklyPlanningApprovalPlanRepository(database);
    const ref = createRef<WeeklyPlanningApplication>();
    const props: UseWeeklyPlanningApplicationInput = {
      userId: OWNER, selectedDate: WEEK_START, plans: [], scheduleTemplates: [],
      isPlannerDataSnapshotCurrent: () => true, plannerDataAvailability: createReadyPlannerDataAvailability(OWNER),
      saveWeeklyApprovedPlan: repository.saveApprovedPlan,
      completeWeeklyApprovalOperation: repository.completeOperation,
    };
    const mount = async () => { await act(async () => { renderer = create(<Harness ref={ref} {...props} />); }); };
    await mount();
    const semantic = createDeferred<WeeklyPlanningSemanticNormalizerResultV5>();
    const normalizationStarted = createDeferred<void>();
    // Unexpected duplicate calls still receive a valid provider result, so
    // admission regressions fail on behavior rather than an incomplete mock.
    normalizeMock.mockResolvedValue(accepted(workloadDocument()));
    normalizeMock.mockImplementationOnce(() => { normalizationStarted.resolve(); return semantic.promise; });
    let first!: Promise<WeeklyPlanningTurnSubmissionResult>;
    const userText = '8月17日から23日で数学の教材を30ページ進めたい';
    await act(async () => {
      // Use the same captured callback before React can publish a new render.
      const submit = ref.current!.submitTurn;
      first = submit(userText);
      expect(await submit(userText)).toEqual({ accepted: false, draftCandidates: [] });
      await normalizationStarted.promise;
      expect(normalizeMock).toHaveBeenCalledTimes(1);
    });
    const pending = structuredClone(ref.current!.state.pendingTurn!);
    expect(pending).toBeDefined();
    expect(ref.current!.state.messages.map((message) => message.role)).toEqual(['user']);
    expect(ref.current!.state.conversationRequestSequence).toBe(1);
    await act(async () => {
      expect(await ref.current!.submitTurn(userText)).toEqual({ accepted: false, draftCandidates: [] });
    });
    expect(ref.current!.state.pendingTurn).toEqual(pending);
    expect(normalizeMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      semantic.resolve(accepted(workloadDocument()));
      expect(await first).toEqual({ accepted: true, draftCandidates: [] });
    });
    expect(ref.current!.state.pendingTurn).toBeUndefined();
    expect(ref.current!.state.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(ref.current!.state.conversationRequestSequence).toBe(1);
    expect(ref.current!.state.intakeState?.lastQuestionContext?.targetSlot).toBe('stable_v5:missing_effort_estimate');
    expect(ref.current!.state.intakeState?.questions).toHaveLength(1);
    expect(ref.current!.state.previewCandidates).toEqual([]);
    expect(ref.current!.pendingDraftBlocks).toEqual([]);
    const graph = structuredClone(getWeeklyPlanningStableV5RuntimeSession(pending.conversationId)!.graph);
    expect(graph.tasks).toHaveLength(1); expect(graph.workloads).toHaveLength(1);
    expect(graph.effortEstimates).toEqual([]);
    const raw = storage.values.get(getWeeklyPlanningStableV5SessionStorageKeyForTest(OWNER, WEEK_START));
    expect(raw).toBeDefined();
    const checkpoint = JSON.parse(raw!) as WeeklyPlanningStableV5PersistedSession;
    expect(checkpoint.graph).toEqual(graph);
    expect(checkpoint.planningState.messages).toEqual(ref.current!.state.messages);
    expect(checkpoint.planningState.conversationRequestSequence).toBe(1);
    const question = structuredClone(ref.current!.state.intakeState!.lastQuestionContext);
    await act(async () => { renderer!.unmount(); }); renderer = undefined;
    resetWeeklyPlanningStableV5RuntimeSessionsForTest(); clearWeeklyPlanningSessionRuntime();
    await mount();
    expect(ref.current!.state.messages).toEqual(checkpoint.planningState.messages);
    expect(ref.current!.state.intakeState?.lastQuestionContext).toEqual(question);
    expect(ref.current!.state.intakeState?.questions).toHaveLength(1);
    expect(ref.current!.state.conversationRequestSequence).toBe(1);
    expect(getWeeklyPlanningStableV5RuntimeSession(pending.conversationId)?.graph).toEqual(graph);
    expect(normalizeMock).toHaveBeenCalledTimes(1);
    expect(database.metrics).toEqual({ planWrites: 0, itemWrites: 0, operationWrites: 0 });
    expect(database.plans.size).toBe(0);
  });

  it('keeps restored previews unsaved until explicit approval, then writes exactly one Plan', async () => {
    const storage = createMemoryStorageHarness();
    restoreWindow = installWeeklyPlanningTestStorage(storage.storage);
    const database = createWeeklyPlanningApprovalMemoryState();
    const repository = createMemoryWeeklyPlanningApprovalPlanRepository(database);
    const unrelated = { ...createPlanFromDraft({
      userId: OWNER, title: '既存の予定', subject: '', date: WEEK_START,
      startTime: '21:00', endTime: '22:00', repeat: 'none', repeatUntil: null,
      excludedDates: [], recurrenceRules: [], type: 'study', memo: '変更しない',
    }), id: 'unrelated-plan' };
    database.plans.set(unrelated.id, structuredClone(unrelated));
    const original = structuredClone(unrelated);
    const ref = createRef<WeeklyPlanningApplication>();
    const props: UseWeeklyPlanningApplicationInput = {
      userId: OWNER, selectedDate: WEEK_START, plans: [unrelated], scheduleTemplates: [],
      isPlannerDataSnapshotCurrent: () => true, plannerDataAvailability: createReadyPlannerDataAvailability(OWNER),
      saveWeeklyApprovedPlan: repository.saveApprovedPlan,
      completeWeeklyApprovalOperation: repository.completeOperation,
    };
    const mount = async () => { await act(async () => { renderer = create(<Harness ref={ref} {...props} />); }); };
    const assertUnsaved = () => {
      expect(database.metrics).toEqual({ planWrites: 0, itemWrites: 0, operationWrites: 0 });
      expect([...database.plans.values()]).toEqual([original]);
      expect(database.operations.size).toBe(0); expect(database.items.size).toBe(0);
    };
    await mount(); assertUnsaved();
    normalizeMock.mockResolvedValueOnce(accepted(workloadDocument()));
    await act(async () => {
      const result = await ref.current!.submitTurn('8月17日から23日で数学の教材を30ページ進めたい');
      expect(result.accepted).toBe(true); expect(result.draftCandidates).toEqual([]);
    });
    assertUnsaved();
    normalizeMock.mockResolvedValueOnce({ ...accepted(emptyDocument()),
      contextualDirective: { kind: 'provisional_timebox', scope: 'current_missing_effort' },
    });
    await act(async () => {
      const result = await ref.current!.submitTurn('所要時間は分からないので、ひとまず時間枠を割り当ててください');
      expect(result.accepted).toBe(true);
    });
    const candidates = structuredClone(ref.current!.state.previewCandidates!);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ durationMinutes: 60, estimatedMinutes: 60 });
    expect(ref.current!.pendingDraftBlocks).toEqual([]); assertUnsaved();
    const raw = storage.values.get(getWeeklyPlanningStableV5SessionStorageKeyForTest(OWNER, WEEK_START));
    expect(raw).toBeDefined();
    const checkpoint = JSON.parse(raw!) as WeeklyPlanningStableV5PersistedSession;
    expect(checkpoint.planningState.previewCandidates).toEqual(candidates);
    expect(checkpoint.graph.workloads).toEqual([expect.objectContaining({ amount: 30, unitCode: 'page' })]);
    expect(checkpoint.graph.effortEstimates).toEqual([]);
    expect(checkpoint.planningState.intakeState?.provisionalTimebox?.workloadFactIds)
      .toEqual(checkpoint.graph.workloads.map((workload) => workload.id));
    await act(async () => { renderer!.unmount(); }); renderer = undefined;
    resetWeeklyPlanningStableV5RuntimeSessionsForTest(); clearWeeklyPlanningSessionRuntime();
    expect(getWeeklyPlanningStableV5RuntimeSession(checkpoint.conversationId)).toBeNull();
    await mount();
    expect(ref.current!.state.previewCandidates).toEqual(candidates);
    expect(ref.current!.state.intakeState?.provisionalTimebox).toEqual(checkpoint.planningState.intakeState?.provisionalTimebox);
    expect(getWeeklyPlanningStableV5RuntimeSession(checkpoint.conversationId)?.graph).toEqual(checkpoint.graph);
    assertUnsaved();
    const blocks = createWeeklyDraftBlocksFromPreviewCandidates({ candidates: ref.current!.state.previewCandidates!, userId: OWNER, createdAt: new Date().toISOString() });
    await act(async () => { ref.current!.createDraftBlocks(blocks); });
    expect(ref.current!.pendingDraftBlocks).toHaveLength(1);
    expect(ref.current!.approvalAvailability.kind).toBe('eligible'); assertUnsaved();
    await act(async () => { await ref.current!.approveDraftBlocks(); });
    expect(database.metrics.planWrites).toBe(1); expect(database.plans.size).toBe(2);
    expect(database.plans.get(original.id)).toEqual(original);
    const added = [...database.plans.values()].find((plan) => plan.id !== original.id)!;
    expect(added).toMatchObject({ userId: OWNER, date: candidates[0].date,
      title: candidates[0].title, startTime: candidates[0].startTime, endTime: candidates[0].endTime });
    expect(readWeeklyPlanningEstimateMetadata(added)).toBeNull();
    expect(added.weeklyPlanningObservationSource).toBeUndefined();
    expect(database.operations.size).toBe(1);
    const operation = [...database.operations.values()][0];
    expect(operation.status).toBe('completed');
    expect(added.sourceType).toBe(WEEKLY_PLANNING_PLAN_SOURCE_TYPE);
    expect(parseWeeklyPlanningPlanSourceId(added.sourceId)).toEqual({
      approvalOperationId: operation.approvalOperationId, sourceDraftBlockId: blocks[0].id,
    });
    expect([...database.items.values()]).toEqual([expect.objectContaining({
      approvalOperationId: operation.approvalOperationId, sourceDraftBlockId: blocks[0].id,
      savedPlanId: added.id, status: 'saved',
    })]);
    expect(database.items.size).toBe(1); expect(ref.current!.pendingDraftBlocks).toEqual([]);
    await act(async () => { await ref.current!.approveDraftBlocks(); });
    expect(database.metrics.planWrites).toBe(1); expect(normalizeMock).toHaveBeenCalledTimes(2);
  });
  it('keeps accepted task-total roots through replacement, checkpoint, explicit approval and trace persistence', async () => {
    const storage = createMemoryStorageHarness();
    restoreWindow = installWeeklyPlanningTestStorage(storage.storage);
    const repository = createLocalPlannerRepository(storage.storage);
    const save = vi.fn(async (draft: PlanDraft) => repository.upsertPlan(createPlanFromDraft(draft)));
    const ref = createRef<WeeklyPlanningApplication>();
    const props: UseWeeklyPlanningApplicationInput = {
      userId: OWNER, selectedDate: WEEK_START, plans: [], scheduleTemplates: [],
      isPlannerDataSnapshotCurrent: () => true, plannerDataAvailability: createReadyPlannerDataAvailability(OWNER),
      saveWeeklyApprovedPlan: save,
    };
    const mount = async () => { await act(async () => { renderer = create(<Harness ref={ref} {...props} />); }); };
    const readCheckpoint = () => loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK_START })!;
    const reload = async () => {
      await act(async () => { renderer!.unmount(); }); renderer = undefined;
      resetWeeklyPlanningStableV5RuntimeSessionsForTest(); clearWeeklyPlanningSessionRuntime();
      await mount();
    };
    const debug = vi.spyOn(debugTrace, 'recordWeeklyPlanningStableV5DebugTrace');
    await mount();
    const firstDocument = workloadDocument();
    firstDocument.tasks[0].workloads = [];
    firstDocument.tasks[0].sourceText = '数学の教材を合計60分進めたい';
    firstDocument.tasks[0].effortEstimates = [{
      localId: 'total-60', targetLocalId: 'task', kind: 'total_duration', minutes: 60,
      unitCode: null, precision: 'exact', sourceText: '合計60分',
    }];
    const firstText = '8月17日から23日で数学の教材を合計60分進めたい';
    const firstValidation = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(firstDocument), { currentUserText: firstText });
    expect(firstValidation.errors).toEqual([]);
    expect(firstValidation.document).not.toBeNull();
    normalizeMock.mockResolvedValueOnce(accepted(firstValidation.document!));
    await act(async () => { expect((await ref.current!.submitTurn(firstText)).accepted).toBe(true); });
    const first = readCheckpoint();
    expect(first).not.toBeNull();
    const taskId = first.graph.tasks[0].id;
    const oldBudget = first.graph.effortEstimates[0];
    expect(first.graph.workloads).toEqual([]);
    expect(first.planningState.previewCandidates).toEqual([expect.objectContaining({
      durationMinutes: 60, stableV5Metadata: expect.objectContaining({ sourceFactRefs: [taskId, oldBudget.id] }),
    })]);
    const oldBlocks = createWeeklyDraftBlocksFromPreviewCandidates({
      candidates: ref.current!.state.previewCandidates!, userId: OWNER, createdAt: new Date().toISOString(),
    });
    await act(async () => { ref.current!.createDraftBlocks(oldBlocks); });
    await reload();
    expect(getWeeklyPlanningStableV5RuntimeSession(first.conversationId)?.graph).toEqual(first.graph);
    expect(ref.current!.pendingDraftBlocks).toEqual(oldBlocks);
    expect(ref.current!.pendingDraftBlocks[0].behaviorMetadata?.sourceFactRefs).toEqual([taskId, oldBudget.id]);
    expect(save).not.toHaveBeenCalled();
    expect(await repository.getPlans(OWNER)).toEqual([]);

    const correction = structuredClone(firstDocument);
    correction.planningIntent = 'update_plan'; correction.planningWindow = null;
    correction.tasks[0].existingPublicId = taskId;
    correction.tasks[0].sourceText = '数学の教材を合計90分進めたい';
    correction.tasks[0].effortEstimates = [{ ...firstDocument.tasks[0].effortEstimates[0],
      localId: 'total-90', minutes: 90, sourceText: '合計90分',
    }];
    correction.corrections = [{
      localId: 'replace-total', target: { kind: 'effort_estimate', publicId: oldBudget.id, localId: null, mention: '合計60分' },
      operation: 'replace', replacementLocalId: 'total-90', sourceText: '合計60分ではなく90分',
    }];
    const secondText = '合計60分ではなく90分。数学の教材を合計90分進めたい';
    const committedGraph = getWeeklyPlanningStableV5RuntimeSession(first.conversationId)!.graph;
    const correctionValidation = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(correction), {
      currentUserText: secondText, committedGraph,
      publicStateSummary: createWeeklyPlanningSemanticPublicStateSummaryV5(undefined, committedGraph),
    });
    expect(correctionValidation.errors).toEqual([]);
    expect(correctionValidation.document).not.toBeNull();
    normalizeMock.mockResolvedValueOnce(accepted(correctionValidation.document!));
    await act(async () => { expect((await ref.current!.submitTurn(secondText)).accepted).toBe(true); });
    const second = readCheckpoint();
    const active = new Set(second.graph.factLifecycles.filter((fact) => fact.status === 'active').map((fact) => fact.factId));
    const newBudget = second.graph.effortEstimates.find((fact) => active.has(fact.id))!;
    expect(newBudget).toMatchObject({ taskId, targetFactId: taskId, minutes: 90 });
    expect(newBudget.id).not.toBe(oldBudget.id);
    expect(second.graph.factLifecycles.find((fact) => fact.factId === oldBudget.id))
      .toMatchObject({ status: 'superseded', supersededByFactId: newBudget.id });
    expect(second.graph.workloads).toEqual([]);
    expect(second.planningState.previewCandidates).toEqual([expect.objectContaining({
      durationMinutes: 90, stableV5Metadata: expect.objectContaining({
        graphRevision: second.graph.revision, taskId, sourceFactRefs: [taskId, newBudget.id],
      }),
    })]);
    const staleGuard = validateWeeklyPreviewApproval({
      blocks: oldBlocks, currentStateRevision: second.graph.revision, userId: OWNER, proposalRecords: [],
      runtimeSnapshot: resolveWeeklyPlanningApprovalRuntime({ blocks: oldBlocks, userId: OWNER }).runtimeSnapshot,
    });
    expect(staleGuard).toMatchObject({ allowed: false, attempt: { kind: 'stale_preview_approval_attempt' } });
    await act(async () => {
      await expect(ref.current!.approveDraftBlocks()).rejects.toThrow('現在の条件と一致しない仮予定');
    });
    expect(save).not.toHaveBeenCalled();
    // Current main retains previously promoted drafts across a correction. The
    // user explicitly discards them; this E test does not invent a C auto-replace.
    await act(async () => { oldBlocks.forEach((block) => ref.current!.removeDraftBlock(block.id)); });
    expect(ref.current!.pendingDraftBlocks).toEqual([]);
    const blocks = createWeeklyDraftBlocksFromPreviewCandidates({
      candidates: ref.current!.state.previewCandidates!, userId: OWNER, createdAt: new Date().toISOString(),
    });
    await act(async () => { ref.current!.createDraftBlocks(blocks); });
    await reload();
    expect(ref.current!.pendingDraftBlocks).toEqual(blocks);
    expect(ref.current!.pendingDraftBlocks[0].behaviorMetadata?.sourceFactRefs).toEqual([taskId, newBudget.id]);
    expect(getWeeklyPlanningStableV5RuntimeSession(second.conversationId)?.graph).toEqual(second.graph);
    expect(save).not.toHaveBeenCalled();
    await act(async () => { await ref.current!.approveDraftBlocks(); });
    expect(save).toHaveBeenCalledTimes(1);
    const operations = loadWeeklyPlanningApprovalOperations(OWNER);
    expect(operations).toEqual([expect.objectContaining({
      status: 'completed', conversationId: second.conversationId, previewStateRevision: second.graph.revision,
      items: [expect.objectContaining({ sourceDraftBlockId: blocks[0].id, status: 'saved' })],
    })]);
    const restoredPlans = await createLocalPlannerRepository(storage.storage).getPlans(OWNER);
    expect(restoredPlans).toEqual([expect.objectContaining({
      userId: OWNER, title: blocks[0].title, date: blocks[0].date,
      startTime: blocks[0].startTime, endTime: blocks[0].endTime,
    })]);
    expect(parseWeeklyPlanningPlanSourceId(restoredPlans[0].sourceId)).toEqual({
      approvalOperationId: operations[0].approvalOperationId, sourceDraftBlockId: blocks[0].id,
    });
    expect(JSON.parse(storage.storage.getItem('studyplanner.scheduleEvents.v1')!)).toEqual([
      expect.objectContaining({ id: `plan:${restoredPlans[0].id}`, provenance: expect.objectContaining({ sourceId: restoredPlans[0].sourceId }) }),
    ]);
    expect(readWeeklyPlanningEstimateMetadata(restoredPlans[0])).toBeNull();
    // Existing Plan schema retains the operation/block link, not direct fact refs.
    await reload();
    expect(loadWeeklyPlanningApprovalOperations(OWNER)).toEqual(operations);
    expect(ref.current!.pendingDraftBlocks).toEqual([]);
    await act(async () => { await ref.current!.approveDraftBlocks(); });
    expect(save).toHaveBeenCalledTimes(1);

    const generated = debug.mock.calls.map(([event]) => event)
      .filter((event) => event.stage === 'runtime_preview_scheduler_evaluated');
    expect(generated).toHaveLength(2);
    debug.mockRestore();
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'true');
    const writes: Array<{ session: WeeklyPlanningTraceSession; entries: WeeklyPlanningTraceEntry[] }> = [];
    let fail = true;
    setWeeklyPlanningTraceRepositoryForTests({
      async upsertSession() {},
      async appendEntries(params) { if (fail) { fail = false; throw new Error('injected lineage append failure'); } writes.push(structuredClone(params)); },
      async listSessions() { return []; }, async listSessionsForAdmin() { return []; },
      async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; },
    });
    // Replay the actual generated diagnostic, adding only a future diagnostic
    // extension. Do not replace its candidates or manufacture expected roots.
    const persistPreview = async (index: number, oversized = false) => {
      const requestId = `${second.conversationId}:lineage:${index}:${oversized}`;
      const data = structuredClone(generated[index].data) as { result: { candidates: Array<Record<string, unknown>> } };
      data.result.candidates[0].futureTaskTotalSentinel = 'task-total-lineage-sentinel';
      if (oversized) data.result.candidates[0].futureLargeEvidence = `HEAD-${'あ'.repeat(8000)}-TAIL`;
      debugTrace.recordWeeklyPlanningStableV5DebugTrace({ requestId, stage: 'runtime_preview_scheduler_evaluated', data });
      await recordWeeklyPlanningStableV5TurnTrace({
        userId: OWNER, conversationId: second.conversationId, requestId,
        userText: index === 0 ? firstText : secondText, assistantMessage: '仮予定候補を確認してください。',
        outcome: 'preview_ready', previewCount: 1,
        debugTraceEvents: debugTrace.takeWeeklyPlanningStableV5DebugTrace(requestId),
      });
    };
    await persistPreview(0);
    expect(writes).toEqual([]);
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: second.conversationId })).toHaveLength(1);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await persistPreview(1);
    expect(writes).toHaveLength(2);
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: second.conversationId })).toEqual([]);
    for (const [index, write] of writes.entries()) {
      const entry = write.entries[0];
      expect(entry.kind).toBe('turn_diagnostic');
      if (entry.kind !== 'turn_diagnostic') throw new Error('missing turn diagnostic');
      expect(entry.constraintContext.scheduler?.preview?.representativeCandidates).toEqual([
        expect.objectContaining({ stableV5Metadata: expect.objectContaining({
          sourceFactRefs: [taskId, index === 0 ? oldBudget.id : newBudget.id],
        }), futureTaskTotalSentinel: 'task-total-lineage-sentinel' }),
      ]);
      expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
      const prepared = prepareWeeklyPlanningTraceServerWrite({
        session: { ...write.session }, entries: write.entries.map((value) => ({ ...value })),
      }, { token: `wpt_${'d'.repeat(43)}`, epoch: '103' }, {
        sessionId: 'weekly-trace-523e4567-e89b-52d3-a456-426614174000', logicalConversationId: second.conversationId,
      }, new Date().toISOString());
      expect(JSON.stringify(prepared.entries[0])).toContain(index === 0 ? oldBudget.id : newBudget.id);
      expect(JSON.stringify(prepared.entries[0])).toContain('task-total-lineage-sentinel');
      expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    }
    await persistPreview(1, true);
    expect(writes).toHaveLength(3);
    const oversized = writes[2];
    expect(JSON.stringify(oversized.entries[0])).toContain('traceTruncated');
    expect(measureWeeklyPlanningTraceJsonBytes(oversized.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const preparedLarge = prepareWeeklyPlanningTraceServerWrite({
      session: { ...oversized.session }, entries: oversized.entries.map((value) => ({ ...value })),
    }, { token: `wpt_${'d'.repeat(43)}`, epoch: '103' }, {
      sessionId: 'weekly-trace-523e4567-e89b-52d3-a456-426614174000', logicalConversationId: second.conversationId,
    }, new Date().toISOString());
    expect(preparedLarge.entries).toHaveLength(1);
    expect(JSON.stringify(preparedLarge.entries[0])).toContain('traceTruncated');
    expect(measureWeeklyPlanningTraceJsonBytes(preparedLarge.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
  });

});
