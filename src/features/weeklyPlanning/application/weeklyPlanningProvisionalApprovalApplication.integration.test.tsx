import type { WeeklyPlanningStableV5PreviewProvenance } from '../weeklyPlanningPreviewProvenance';
import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';
import * as debugTraceModule from '../trace/weeklyPlanningStableV5DebugTrace';
import * as calibrationModule from '../semantic/weeklyPlanningGenericWorkItemCalibrationV5';
import { createWeeklyPlanningSemanticPublicStateSummaryV5 } from '../semantic/weeklyPlanningSemanticPublicStateV5';
import { createNoopWeeklyPlanningTraceRepository } from '../trace/weeklyPlanningTraceRepository';
import { listWeeklyPlanningTraceOutboxItems } from '../trace/weeklyPlanningTraceOutbox';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from '../trace/weeklyPlanningStableV5TraceRuntime';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../../shared/weeklyPlanningTraceContract';
import type { PlanDraft } from '../../../types/domain';
import { createLocalPlannerRepository } from '../../../repositories/createLocalPlannerRepository';
import { validateWeeklyPlanningSemanticResponseV5 } from '../semantic/weeklyPlanningSemanticResponseValidationV5';
import { loadWeeklyPlanningApprovalOperations } from './weeklyPlanningApprovalLedgerStorage';
import { createRef, forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlanFromDraft } from '../../../domain/planner';
import { validateWeeklyPreviewApproval } from '../planning/weeklyPlanningApproval';
import { resolveWeeklyPlanningApprovalRuntime } from './weeklyPlanningApprovalRuntimeResolver';
import * as debugTrace from '../trace/weeklyPlanningStableV5DebugTrace';
import type { WeeklyPlanningTraceEntry, WeeklyPlanningTraceSession } from '../trace/weeklyPlanningTraceTypes';
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

const { normalizeMock, completionMock } = vi.hoisted(() => ({ normalizeMock: vi.fn(), completionMock: vi.fn() }));
// Substitute the external semantic provider only; application, execution,
// scheduling, checkpoint restore, approval, and atomic persistence stay real.
vi.mock('../../../lib/aiConfig', () => ({
  getAiConfig: () => ({ provider: 'openai', baseUrl: 'https://example.invalid/v1', model: 'test-model', apiKey: 'test-key' }),
  getAiConfigValidationMessage: () => undefined,
  getCloudflareAiProxyUrl: () => null,
  usesCloudflareOpenAiProxy: () => false,
}));
vi.mock('../../../services/ai/openAiCompatibleClient', async () => ({
  ...await vi.importActual<typeof import('../../../services/ai/openAiCompatibleClient')>(
    '../../../services/ai/openAiCompatibleClient',
  ),
  createOpenAiCompatibleClient: () => ({ createChatCompletion: completionMock }),
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
  completionMock.mockReset();
  completionMock.mockRejectedValue(new Error('offline completion fixture'));
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
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
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  vi.restoreAllMocks();
  vi.unstubAllEnvs(); vi.useRealTimers();
});

describe('provisional allocation through application and approval persistence', () => {
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

  it.each([
    { cap: null, durations: [70], quantityLabel: '20ページ', ranges: ['21〜40'] },
    { cap: 30, durations: [30, 30], quantityLabel: '10ページ', ranges: ['21〜30', '31〜40'] },
  ])('saves accepted cap $cap only after approval without extending Plan persistence', async ({ cap, durations, quantityLabel, ranges }) => {
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
    await mount();
    const doc = workloadDocument();
    doc.tasks[0].sourceText = '数学の教材を20ページ進めたい';
    doc.tasks[0].workloads = [{ ...doc.tasks[0].workloads[0], amount: 20,
      rangeStart: '21', rangeEnd: '40', sourceText: '数学の教材を20ページ進めたい',
    }];
    doc.tasks[0].effortEstimates = [{ localId: 'page-pace', targetLocalId: 'workload', kind: 'duration_per_unit',
      minutes: 3, unitCode: 'page', precision: 'exact', sourceText: '1ページ3分',
    }, ...(cap === null ? [] : [{ localId: 'session-cap', targetLocalId: 'task', kind: 'session_duration' as const,
      minutes: cap, unitCode: 'session' as const, precision: 'exact' as const, sourceText: '1回30分以内',
    }])];
    const text = `8月17日から23日で数学の教材を20ページ進めたい。21ページから40ページ、1ページ3分。${cap === null ? '' : '1回30分以内。'}`;
    const validation = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(doc), { currentUserText: text });
    expect(validation.errors).toEqual([]); expect(validation.document).not.toBeNull();
    normalizeMock.mockResolvedValueOnce(accepted(validation.document!));
    await act(async () => { expect((await ref.current!.submitTurn(text)).accepted).toBe(true); });
    const candidates = structuredClone(ref.current!.state.previewCandidates!);
    expect(candidates.map((candidate) => candidate.durationMinutes)).toEqual(durations);
    expect(candidates.map((candidate) => ranges.find((range) => candidate.title.includes(range))).sort()).toEqual([...ranges].sort());
    candidates.forEach((candidate) => {
      expect(candidate.title).toContain(quantityLabel);
      const minute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
      expect(minute(candidate.endTime) - minute(candidate.startTime)).toBe(candidate.durationMinutes);
      if (cap !== null) expect(candidate.durationMinutes).toBeLessThanOrEqual(cap);
      expect(candidate).not.toHaveProperty('allocationBreakdown'); // No new checkpoint field.
    });
    const key = getWeeklyPlanningStableV5SessionStorageKeyForTest(OWNER, WEEK_START);
    const before = loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK_START })!;
    expect(before.graph.workloads).toEqual([expect.objectContaining({ amount: 20, unitCode: 'page', rangeStart: '21', rangeEnd: '40' })]);
    const capFact = before.graph.effortEstimates.find((fact) => fact.kind === 'session_duration');
    if (cap !== null) expect(capFact?.minutes).toBe(cap);
    const blocks = createWeeklyDraftBlocksFromPreviewCandidates({ candidates, userId: OWNER, createdAt: new Date().toISOString() });
    blocks.forEach((block) => {
      expect(block.behaviorMetadata?.sourceFactRefs).toEqual(expect.arrayContaining([
        before.graph.tasks[0].id, before.graph.workloads[0].id,
        ...before.graph.effortEstimates.map((fact) => fact.id),
      ]));
    });
    await act(async () => { ref.current!.createDraftBlocks(blocks); });
    const checkpointBytes = storage.storage.getItem(key);
    expect(checkpointBytes).not.toBeNull();
    expect(save).not.toHaveBeenCalled();
    await act(async () => { renderer!.unmount(); }); renderer = undefined;
    resetWeeklyPlanningStableV5RuntimeSessionsForTest(); clearWeeklyPlanningSessionRuntime();
    await mount();
    expect(ref.current!.pendingDraftBlocks).toEqual(blocks);
    expect(getWeeklyPlanningStableV5RuntimeSession(before.conversationId)?.graph).toEqual(before.graph);
    expect(await repository.getPlans(OWNER)).toEqual([]);
    await act(async () => { await ref.current!.approveDraftBlocks(); });
    expect(save).toHaveBeenCalledTimes(durations.length);
    const restored = await createLocalPlannerRepository(storage.storage).getPlans(OWNER);
    expect(restored).toHaveLength(durations.length);
    const operations = loadWeeklyPlanningApprovalOperations(OWNER);
    expect(operations).toEqual([expect.objectContaining({ status: 'completed', previewStateRevision: before.graph.revision })]);
    blocks.forEach((block) => {
      const plan = restored.find((value) => parseWeeklyPlanningPlanSourceId(value.sourceId)?.sourceDraftBlockId === block.id)!;
      expect(plan).toMatchObject({ userId: OWNER, title: block.title, date: block.date, startTime: block.startTime, endTime: block.endTime });
      expect(parseWeeklyPlanningPlanSourceId(plan.sourceId)?.approvalOperationId).toBe(operations[0].approvalOperationId);
      expect(plan).not.toHaveProperty('allocationBreakdown');
      expect(plan).not.toHaveProperty('allocations');
      expect(readWeeklyPlanningEstimateMetadata(plan)).toBeNull();
    });
    const events = JSON.parse(storage.storage.getItem('studyplanner.scheduleEvents.v1')!);
    expect(events).toHaveLength(durations.length);
    expect(events.map((event: { id: string }) => event.id).sort()).toEqual(restored.map((plan) => `plan:${plan.id}`).sort());
    await act(async () => { await ref.current!.approveDraftBlocks(); });
    expect(save).toHaveBeenCalledTimes(durations.length);
  });

});


function sessionBoundDocument(amount: number, pace: number, cap: number, title = '数学の教材', unitCode: 'page' | 'custom' = 'page') {
  const unitLabel = unitCode === 'page' ? 'ページ' : 'セット';
  const document = workloadDocument();
  const task = document.tasks[0];
  task.title = title;
  task.sourceText = `${title}を${amount}${unitLabel}、1${unitLabel}${pace}分、1回${cap}分以内`;
  task.study!.contextLabel = title;
  task.workloads = [{ ...task.workloads[0], amount, unitCode, unitLabel, sourceText: task.sourceText }];
  task.effortEstimates = [
    { localId: 'pace', targetLocalId: 'workload', kind: 'duration_per_unit', minutes: pace,
      unitCode, precision: 'exact', sourceText: `1${unitLabel}${pace}分` },
    { localId: 'cap', targetLocalId: 'task', kind: 'session_duration', minutes: cap,
      unitCode: 'session', precision: 'exact', sourceText: `1回${cap}分以内` },
  ];
  return document;
}

describe('accepted session bounds through real runtime and dialogue recovery', () => {
  it.each([
    { amount: 1, pace: 45, cap: 30, reason: 'indivisible_unit_exceeds_cap', minimum: 45,
      resolution: 'session_partition_constraints', requested: 'session_bound_or_indivisible_unit' },
    { amount: 1, pace: 3, cap: 0.5, reason: 'cap_below_clock_precision', minimum: 1,
      resolution: 'session_partition_constraints', requested: 'session_bound_or_indivisible_unit' },
    { amount: 513, pace: 1, cap: 1, reason: 'generation_limit', minimum: undefined,
      resolution: 'session_partition_generation_limit', requested: 'scope_within_generation_limit' },
    { amount: 2, pace: 20, cap: 30, reason: 'unsupported_quantity_partition', minimum: undefined,
      resolution: 'session_partition_constraints', requested: 'supported_whole_unit_quantity' },
    { amount: 20, pace: 3, cap: 30, reason: 'unsupported_actual_range', minimum: undefined,
      resolution: 'session_partition_constraints', requested: 'supported_range_partition' },
  ])('passes $reason evidence to the real renderer request, retry and Worker boundary', async (row) => {
    const storage = createMemoryStorageHarness();
    restoreWindow = installWeeklyPlanningTestStorage(storage.storage);
    vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'true');
    const traceRepository = createNoopWeeklyPlanningTraceRepository();
    const append = vi.spyOn(traceRepository, 'appendEntries').mockRejectedValueOnce(new Error('session trace retry probe'));
    setWeeklyPlanningTraceRepositoryForTests(traceRepository);
    const database = createWeeklyPlanningApprovalMemoryState();
    const repository = createMemoryWeeklyPlanningApprovalPlanRepository(database);
    const ref = createRef<WeeklyPlanningApplication>();
    await act(async () => { renderer = create(<Harness ref={ref} userId={OWNER} selectedDate={WEEK_START}
      plans={[]} scheduleTemplates={[]} isPlannerDataSnapshotCurrent={() => true}
      plannerDataAvailability={createReadyPlannerDataAvailability(OWNER)}
      saveWeeklyApprovedPlan={repository.saveApprovedPlan} completeWeeklyApprovalOperation={repository.completeOperation} />); });
    const unitCode = row.reason === 'unsupported_quantity_partition' ? 'custom' : 'page';
    const document = sessionBoundDocument(row.amount, row.pace, row.cap, '数学の教材', unitCode);
    if (row.reason === 'unsupported_actual_range') {
      document.tasks[0].workloads[0].rangeStart = 'A1'; document.tasks[0].workloads[0].rangeEnd = 'A20';
      document.tasks[0].sourceText += '、範囲はA1からA20';
      document.tasks[0].workloads[0].sourceText = document.tasks[0].sourceText;
    }
    const text = `8月17日から23日で${document.tasks[0].sourceText}`;
    const validation = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(document), { currentUserText: text });
    expect(validation.errors).toEqual([]); expect(validation.document).not.toBeNull();
    normalizeMock.mockResolvedValueOnce(accepted(validation.document!));
    const answer = '数学の教材について、1回の条件を相談できますか？';
    completionMock.mockImplementation(async (request) => {
      const prompt = JSON.parse(request.messages.find((message: { role: string }) => message.role === 'user').content);
      return JSON.stringify({ actionId: prompt.actionId, actionKind: prompt.applicationDecision.actionKind,
        questionCode: prompt.applicationDecision.questionCode, groundingAcknowledgement: null, text: answer,
        futureSessionResponse: 'session-response-sentinel',
        ...(row.minimum === 45 ? { oversizedFutureField: 'session-trace-oversize-'.repeat(5_000) } : {}),
      });
    });
    await act(async () => { expect(await ref.current!.submitTurn(text)).toEqual({ accepted: true, draftCandidates: [] }); });
    expect(completionMock).toHaveBeenCalledTimes(1);
    const request = completionMock.mock.calls[0][0];
    expect(request.purpose).toBe('weekly_planning_renderer');
    const prompt = JSON.parse(request.messages.find((message: { role: string }) => message.role === 'user').content);
    expect(prompt.applicationDecision.questionCode).toBe('session_partition_unfulfillable');
    expect(prompt.applicationDecision.questionIntent).toMatchObject({
      kind: 'resolution_question', resolutionKind: row.resolution, requestedInformation: [row.requested],
      ambiguityField: null, ambiguityReason: null,
      sessionPartitionIssue: { code: 'session_partition_unfulfillable', details: {
        reason: row.reason, requestedSessionMinutes: row.cap, sessionMinuteLimit: Math.floor(row.cap),
        quantityAmount: row.amount, workUnitCode: unitCode, maximumGeneratedSessions: 512,
        ...(row.minimum === undefined ? {} : { minimumRequiredMinutes: row.minimum }),
        ...(row.reason === 'unsupported_actual_range' ? { rangeStart: 'A1', rangeEnd: 'A20' } : {}),
        ...(row.reason === 'generation_limit' ? { requiredSessionCount: 513 } : {}),
      } },
    });
    // Successful AI text is the complete message; fallback text must not be appended.
    expect(ref.current!.state.messages.filter((message) => message.role === 'assistant').map((message) => message.content)).toEqual([answer]);
    expect(ref.current!.state.previewCandidates).toEqual([]); expect(ref.current!.pendingDraftBlocks).toEqual([]);
    const checkpoint = loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK_START })!;
    expect(checkpoint.graph.workloads[0].amount).toBe(row.amount); // Accepted quantity remains unchanged; custom units are not reinterpreted.
    const selectedCap = checkpoint.graph.effortEstimates.find((fact) => fact.kind === 'session_duration')!;
    expect(selectedCap.minutes).toBe(row.cap);
    expect(prompt.applicationDecision.questionIntent.sessionPartitionIssue).toMatchObject({
      factId: selectedCap.id, matchingSessionDurationFactIds: [selectedCap.id],
      details: { taskId: checkpoint.graph.tasks[0].id, sessionDurationFactId: selectedCap.id,
        sessionDurationScopeFactId: selectedCap.targetFactId },
    });
    const actualPromptContext = { messages: request.messages,
      requestBytes: measureWeeklyPlanningTraceJsonBytes(request.messages) };
    expect(measureWeeklyPlanningTraceJsonBytes(actualPromptContext)).toBeLessThanOrEqual(12 * 1024);
    if (row.reason === 'unsupported_actual_range') expect(checkpoint.graph.workloads[0]).toMatchObject({ rangeStart: 'A1', rangeEnd: 'A20' });
    expect(database.metrics).toEqual({ planWrites: 0, itemWrites: 0, operationWrites: 0 });
    await vi.waitFor(() => expect(append).toHaveBeenCalledTimes(1));
    const queued = listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: checkpoint.conversationId });
    expect(queued).toHaveLength(1);
    const persistedOutboxBytes = storage.storage.getItem('studyplanner.weeklyPlanning.trace.outbox.v1');
    expect(persistedOutboxBytes).not.toBeNull();
    expect(JSON.parse(persistedOutboxBytes!).items[0].input).toEqual(queued[0].input);
    expect(persistedOutboxBytes).toContain(row.reason);
    const firstRendererTrace = JSON.parse(JSON.stringify(append.mock.calls[0][0].entries[0])).diagnostics.dialogueRenderer;
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace({ userId: OWNER, conversationId: checkpoint.conversationId,
      requestId: `${checkpoint.conversationId}:retry-trigger`, userText: 'trace retry control', outcome: 'control', previewCount: 0 });
    expect(append).toHaveBeenCalledTimes(3);
    const replay = append.mock.calls[1][0];
    const diagnostic = replay.entries[0];
    expect(diagnostic.kind).toBe('turn_diagnostic');
    expect(JSON.parse(JSON.stringify(diagnostic)).diagnostics.dialogueRenderer).toEqual(firstRendererTrace);
    expect(JSON.stringify(diagnostic)).toContain(row.reason);
    expect(JSON.stringify(diagnostic)).toContain('maximumGeneratedSessions');
    expect(JSON.stringify(diagnostic)).toContain('session-response-sentinel');
    if (row.minimum === 45) {
      const boundedResponse = JSON.parse(JSON.stringify(diagnostic)).diagnostics.dialogueRenderer.response.rawResponse;
      expect(boundedResponse).toContain('[trace truncated]');
      expect(new TextEncoder().encode(boundedResponse).byteLength).toBeLessThanOrEqual(3_500);
      expect(boundedResponse).not.toContain('session-trace-oversize-'.repeat(5_000));
    }
    expect(measureWeeklyPlanningTraceJsonBytes(diagnostic)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    const prepared = prepareWeeklyPlanningTraceServerWrite({
      session: replay.session as unknown as Record<string, unknown>,
      entries: replay.entries as unknown as Record<string, unknown>[],
    }, { token: `wpt_${'e'.repeat(43)}`, epoch: '104' }, {
      sessionId: 'weekly-trace-423e4567-e89b-52d3-a456-426614174000',
      logicalConversationId: 'weekly-conversation-423e4567-e89b-52d3-a456-426614174000',
    }, '2026-08-16T00:00:00.000Z');
    expect(prepared.entries).toHaveLength(1);
    expect(JSON.stringify(prepared.entries[0])).toContain(row.reason);
    expect((prepared.entries[0].diagnostics as { dialogueRenderer: unknown }).dialogueRenderer).toEqual(firstRendererTrace);
    for (const trace of [firstRendererTrace, JSON.parse(JSON.stringify(diagnostic)).diagnostics.dialogueRenderer,
      JSON.parse(JSON.stringify(prepared.entries[0])).diagnostics.dialogueRenderer]) {
      expect(trace.request.promptContext).toEqual(actualPromptContext);
      const savedPrompt = JSON.parse(trace.request.promptContext.messages.find((message: { role: string }) => message.role === 'user').content);
      expect(savedPrompt.applicationDecision.questionIntent.sessionPartitionIssue).toEqual(prompt.applicationDecision.questionIntent.sessionPartitionIssue);
      expect(savedPrompt.applicationDecision.questionIntent.sessionPartitionIssue).toMatchObject({
        matchingSessionDurationFactIds: [selectedCap.id], details: {
          taskId: checkpoint.graph.tasks[0].id, sessionDurationFactId: selectedCap.id,
          sessionDurationScopeFactId: selectedCap.targetFactId,
        },
      });
    }
    expect(JSON.stringify(prepared.entries[0])).toContain('session-response-sentinel');
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: checkpoint.conversationId })).toEqual([]);
    if (row.reason === 'indivisible_unit_exceeds_cap') {
      const oldCap = checkpoint.graph.effortEstimates.find((fact) => fact.kind === 'session_duration')!;
      const correction = structuredClone(document);
      correction.planningIntent = 'update_plan'; correction.planningWindow = null;
      correction.tasks[0].existingPublicId = checkpoint.graph.tasks[0].id;
      correction.tasks[0].study = null; correction.tasks[0].workloads = [];
      correction.tasks[0].sourceText = '数学の教材は1回30分ではなく60分以内にします';
      correction.tasks[0].effortEstimates = [{ ...document.tasks[0].effortEstimates[1], localId: 'cap-60', minutes: 60, sourceText: '1回60分以内' }];
      correction.corrections = [{ localId: 'replace-cap', target: { kind: 'effort_estimate', publicId: oldCap.id, localId: null, mention: '1回30分' },
        operation: 'replace', replacementLocalId: 'cap-60', sourceText: '1回30分ではなく60分以内' }];
      const correctionText = correction.tasks[0].sourceText;
      const correctionValidation = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(correction), {
        currentUserText: correctionText, committedGraph: checkpoint.graph,
        publicStateSummary: createWeeklyPlanningSemanticPublicStateSummaryV5(undefined, checkpoint.graph),
      });
      expect(correctionValidation.errors).toEqual([]); expect(correctionValidation.document).not.toBeNull();
      normalizeMock.mockResolvedValueOnce(accepted(correctionValidation.document!));
      completionMock.mockReset().mockRejectedValue(new Error('offline completion fixture')); // Explicit provider-failure control on the recovery preview.
      await act(async () => { expect((await ref.current!.submitTurn(correctionText)).accepted).toBe(true); });
      const recovered = loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK_START })!;
      const activeIds = new Set(recovered.graph.factLifecycles.filter((fact) => fact.status === 'active').map((fact) => fact.factId));
      const newCap = recovered.graph.effortEstimates.find((fact) => fact.kind === 'session_duration' && activeIds.has(fact.id))!;
      expect(newCap.minutes).toBe(60); expect(newCap.id).not.toBe(oldCap.id);
      expect(recovered.graph.factLifecycles.find((fact) => fact.factId === oldCap.id)).toMatchObject({ status: 'superseded', supersededByFactId: newCap.id });
      expect(ref.current!.state.previewCandidates!.map((candidate) => candidate.durationMinutes)).toEqual([50]);
      expect(ref.current!.state.intakeState?.lastQuestionContext).toBeUndefined();
      const refs = (ref.current!.state.previewCandidates![0] as WeeklyDraftCandidate & {
        stableV5Metadata: WeeklyPlanningStableV5PreviewProvenance;
      }).stableV5Metadata.sourceFactRefs;
      expect(refs).toContain(newCap.id); expect(refs).not.toContain(oldCap.id);
      expect(recovered.graph.workloads).toEqual(checkpoint.graph.workloads);
      expect(database.metrics).toEqual({ planWrites: 0, itemWrites: 0, operationWrites: 0 });
    }
  });

  it('rejects an injected internal cost inconsistency through actual controller rollback, without asking an AI to clarify user meaning', async () => {
    const storage = createMemoryStorageHarness();
    restoreWindow = installWeeklyPlanningTestStorage(storage.storage);
    vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'true');
    const traceRepository = createNoopWeeklyPlanningTraceRepository();
    const append = vi.spyOn(traceRepository, 'appendEntries');
    setWeeklyPlanningTraceRepositoryForTests(traceRepository);
    const database = createWeeklyPlanningApprovalMemoryState();
    const repository = createMemoryWeeklyPlanningApprovalPlanRepository(database);
    const ref = createRef<WeeklyPlanningApplication>();
    await act(async () => { renderer = create(<Harness ref={ref} userId={OWNER} selectedDate={WEEK_START}
      plans={[]} scheduleTemplates={[]} isPlannerDataSnapshotCurrent={() => true}
      plannerDataAvailability={createReadyPlannerDataAvailability(OWNER)}
      saveWeeklyApprovedPlan={repository.saveApprovedPlan} completeWeeklyApprovalOperation={repository.completeOperation} />); });
    const seed = sessionBoundDocument(20, 3, 30);
    const firstText = `8月17日から23日で${seed.tasks[0].sourceText}`;
    const firstValidation = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(seed), { currentUserText: firstText });
    expect(firstValidation.errors).toEqual([]);
    normalizeMock.mockResolvedValueOnce(accepted(firstValidation.document!));
    await act(async () => { expect((await ref.current!.submitTurn(firstText)).accepted).toBe(true); });
    const firstPreview = structuredClone(ref.current!.state.previewCandidates!);
    expect(firstPreview.map((candidate) => candidate.durationMinutes)).toEqual([30, 30]);
    const blocks = createWeeklyDraftBlocksFromPreviewCandidates({ candidates: firstPreview, userId: OWNER, createdAt: new Date().toISOString() });
    await act(async () => { ref.current!.createDraftBlocks(blocks); });
    const promoted = loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK_START })!;
    const continuation = sessionBoundDocument(2, 3, 30, '国語の教材');
    continuation.planningIntent = 'update_plan'; continuation.planningWindow = null;
    const continuationText = `追加で${continuation.tasks[0].sourceText}`;
    const continuationValidation = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(continuation), {
      currentUserText: continuationText, committedGraph: promoted.graph,
      publicStateSummary: createWeeklyPlanningSemanticPublicStateSummaryV5(undefined, promoted.graph),
    });
    expect(continuationValidation.errors).toEqual([]);
    normalizeMock.mockResolvedValueOnce(accepted(continuationValidation.document!));
    await act(async () => { expect((await ref.current!.submitTurn(continuationText)).accepted).toBe(true); });
    const previousPreview = structuredClone(ref.current!.state.previewCandidates!);
    expect(previousPreview.length).toBeGreaterThan(0); expect(ref.current!.pendingDraftBlocks).toEqual(blocks);
    const before = loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK_START })!;
    const second = sessionBoundDocument(20, 3, 30, '内部計算対照');
    second.planningIntent = 'update_plan'; second.planningWindow = null;
    const secondText = `追加で${second.tasks[0].sourceText}`;
    const validation = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(second), { currentUserText: secondText,
      committedGraph: before.graph, publicStateSummary: createWeeklyPlanningSemanticPublicStateSummaryV5(undefined, before.graph) });
    expect(validation.errors).toEqual([]); expect(validation.document).not.toBeNull();
    normalizeMock.mockResolvedValueOnce(accepted(validation.document!));
    const original = calibrationModule.calibrateGenericPlanningWorkItemsV5;
    // Fault injection at the existing numeric producer; the partition resolver and all
    // runtime/controller/staging/trace code remain real. This is not an AI meaning fixture.
    const calibration = vi.spyOn(calibrationModule, 'calibrateGenericPlanningWorkItemsV5').mockImplementation((params) =>
      original(params).map((item) => item.label.includes('内部計算対照') ? { ...item, estimatedMinutes: 1 } : item));
    completionMock.mockClear();
    const debug = vi.spyOn(debugTraceModule, 'recordWeeklyPlanningStableV5DebugTrace');
    let submission!: WeeklyPlanningTurnSubmissionResult;
    await act(async () => { submission = await ref.current!.submitTurn(secondText); });
    calibration.mockRestore();
    // accepted means the user turn was received; the failure below must discard its graph mutation.
    expect(submission).toEqual({ accepted: true, draftCandidates: [] });
    expect(completionMock).not.toHaveBeenCalled();
    const projected = debug.mock.calls.map(([event]) => event).find((event) => event.stage === 'turn_executor_result_projected');
    expect(projected?.data).toMatchObject({ projectedResult: { responseSource: 'system', failure: {
      code: 'stable_v5_scheduler_input_rejected', traceCode: 'session_partition_internal_unsafe_partition_arithmetic',
      diagnostics: { attemptCount: 0, repairAttempted: false, validationErrorCategories: ['unsafe_partition_arithmetic'] },
    } } });
    expect(getWeeklyPlanningStableV5RuntimeSession(before.conversationId)?.graph).toEqual(before.graph);
    expect(ref.current!.state.previewCandidates).toEqual(previousPreview);
    expect(ref.current!.pendingDraftBlocks).toEqual(blocks);
    const after = loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK_START })!;
    expect(after.graph).toEqual(before.graph);
    expect(after.planningState.previewCandidates).toEqual(previousPreview);
    expect(after.planningState.draftBlocks).toEqual(before.planningState.draftBlocks);
    expect(database.metrics).toEqual({ planWrites: 0, itemWrites: 0, operationWrites: 0 });
    await vi.waitFor(() => expect(append).toHaveBeenCalledTimes(3));
    const failed = append.mock.calls[2][0];
    expect(JSON.stringify(failed.entries[0])).toContain('session_partition_internal_unsafe_partition_arithmetic');
    const prepared = prepareWeeklyPlanningTraceServerWrite({ session: failed.session as unknown as Record<string, unknown>,
      entries: failed.entries as unknown as Record<string, unknown>[] },
    { token: `wpt_${'e'.repeat(43)}`, epoch: '104' }, {
      sessionId: 'weekly-trace-423e4567-e89b-52d3-a456-426614174000',
      logicalConversationId: 'weekly-conversation-423e4567-e89b-52d3-a456-426614174000',
    }, '2026-08-16T00:00:00.000Z');
    expect(JSON.stringify(prepared.entries[0])).toContain('session_partition_internal_unsafe_partition_arithmetic');
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
  });
});

it.each([true, false])('keeps same-scope and distinct-scope 30/60 caps separate (conflict=%s)', async (conflict) => {
  const storage = createMemoryStorageHarness(); restoreWindow = installWeeklyPlanningTestStorage(storage.storage);
  const traceRepository = createNoopWeeklyPlanningTraceRepository();
  const append = vi.spyOn(traceRepository, 'appendEntries').mockRejectedValueOnce(new Error('scope trace retry probe'));
  if (conflict) {
    vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'true');
    setWeeklyPlanningTraceRepositoryForTests(traceRepository);
  }
  const database = createWeeklyPlanningApprovalMemoryState();
  const repository = createMemoryWeeklyPlanningApprovalPlanRepository(database);
  const ref = createRef<WeeklyPlanningApplication>();
  await act(async () => { renderer = create(<Harness ref={ref} userId={OWNER} selectedDate={WEEK_START}
    plans={[]} scheduleTemplates={[]} isPlannerDataSnapshotCurrent={() => true}
    plannerDataAvailability={createReadyPlannerDataAvailability(OWNER)}
    saveWeeklyApprovedPlan={repository.saveApprovedPlan} completeWeeklyApprovalOperation={repository.completeOperation} />); });
  const document = sessionBoundDocument(20, 3, 30);
  const task = document.tasks[0]; const workload = task.workloads[0]; task.workloads = [];
  task.sourceText = `数学で問題集Aを20ページ、問題集Bを2ページ。問題集Aは1ページ3分、問題集Bは1ページ3分。問題集Aは1回30分、${conflict ? '問題集A' : '問題集B'}は1回60分。`;
  task.study!.components = [
    { localId: 'book-a', parentLocalId: null, role: 'material', label: '問題集A', sourceText: '問題集A',
      workloads: [{ ...workload, localId: 'work-a', sourceText: '問題集Aを20ページ' }] },
    { localId: 'book-b', parentLocalId: null, role: 'material', label: '問題集B', sourceText: '問題集B',
      workloads: [{ ...workload, localId: 'work-b', amount: 2, sourceText: '問題集Bを2ページ' }] },
  ];
  task.effortEstimates = [
    { localId: 'pace-a', targetLocalId: 'work-a', kind: 'duration_per_unit', minutes: 3, unitCode: 'page', precision: 'exact', sourceText: '問題集Aは1ページ3分' },
    { localId: 'pace-b', targetLocalId: 'work-b', kind: 'duration_per_unit', minutes: 3, unitCode: 'page', precision: 'exact', sourceText: '問題集Bは1ページ3分' },
    { localId: 'cap-a30', targetLocalId: 'work-a', kind: 'session_duration', minutes: 30, unitCode: 'session', precision: 'exact', sourceText: '問題集Aは1回30分' },
    { localId: 'cap-other60', targetLocalId: conflict ? 'work-a' : 'work-b', kind: 'session_duration', minutes: 60, unitCode: 'session', precision: 'exact', sourceText: `${conflict ? '問題集A' : '問題集B'}は1回60分` },
  ];
  const text = `8月17日から23日で${task.sourceText}`;
  const validation = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(document), { currentUserText: text });
  expect(validation.errors).toEqual([]); expect(validation.document).not.toBeNull();
  normalizeMock.mockResolvedValueOnce(accepted(validation.document!));
  await act(async () => { expect((await ref.current!.submitTurn(text)).accepted).toBe(true); });
  const checkpoint = loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK_START })!;
  const bookA = checkpoint.graph.components.find((component) => component.label === '問題集A')!;
  const workA = checkpoint.graph.workloads.find((fact) => fact.componentId === bookA.id)!;
  const caps = checkpoint.graph.effortEstimates.filter((fact) => fact.kind === 'session_duration');
  expect(completionMock).toHaveBeenCalledTimes(1);
  const request = completionMock.mock.calls[0][0];
  const prompt = JSON.parse(request.messages.find((message: { role: string }) => message.role === 'user').content);
  if (conflict) {
    expect(ref.current!.state.previewCandidates).toEqual([]);
    expect(prompt.applicationDecision.questionTarget).toMatchObject({ collection: 'workloads', fact: { id: workA.id } });
    expect(prompt.applicationDecision.questionIntent).toMatchObject({ resolutionKind: 'effort_estimate_choice',
      targetFactId: workA.id, requestedInformation: ['choose_effort_estimate'], sessionPartitionIssue: {
        factId: workA.id, matchingSessionDurationFactIds: caps.map((fact) => fact.id),
        details: { reason: 'ambiguous_session_duration', sessionDurationScopeFactId: workA.id, matchingEstimateCount: 2 },
      } });
    expect(caps.every((fact) => fact.targetFactId === workA.id)).toBe(true);
    const actualPromptContext = { messages: request.messages,
      requestBytes: measureWeeklyPlanningTraceJsonBytes(request.messages) };
    expect(measureWeeklyPlanningTraceJsonBytes(actualPromptContext)).toBeLessThanOrEqual(12 * 1024);
    await vi.waitFor(() => expect(append).toHaveBeenCalledTimes(1));
    const first = append.mock.calls[0][0];
    const queued = listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: checkpoint.conversationId });
    expect(queued).toHaveLength(1);
    const storedOutboxBytes = storage.storage.getItem('studyplanner.weeklyPlanning.trace.outbox.v1');
    expect(storedOutboxBytes).not.toBeNull();
    expect(JSON.parse(storedOutboxBytes!).items[0].input).toEqual(queued[0].input);
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    await recordWeeklyPlanningStableV5TurnTrace({ userId: OWNER, conversationId: checkpoint.conversationId,
      requestId: `${checkpoint.conversationId}:scope-retry`, userText: 'scope trace retry', outcome: 'control', previewCount: 0 });
    expect(append).toHaveBeenCalledTimes(3);
    const replay = append.mock.calls[1][0];
    expect(queued[0].input.dialogueRendererTrace?.request?.promptContext).toEqual(actualPromptContext);
    const prepared = prepareWeeklyPlanningTraceServerWrite({
      session: replay.session as unknown as Record<string, unknown>,
      entries: replay.entries as unknown as Record<string, unknown>[],
    }, { token: `wpt_${'e'.repeat(43)}`, epoch: '104' }, {
      sessionId: 'weekly-trace-423e4567-e89b-52d3-a456-426614174000',
      logicalConversationId: 'weekly-conversation-423e4567-e89b-52d3-a456-426614174000',
    }, '2026-08-16T00:00:00.000Z');
    expect(prepared.entries).toHaveLength(1);
    expect(measureWeeklyPlanningTraceJsonBytes(replay.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
    expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
    for (const entry of [first.entries[0], replay.entries[0], prepared.entries[0]]) {
      const savedContext = JSON.parse(JSON.stringify(entry)).diagnostics.dialogueRenderer.request.promptContext;
      expect(savedContext).toEqual(actualPromptContext);
      const savedPrompt = JSON.parse(savedContext.messages.find((message: { role: string }) => message.role === 'user').content);
      expect(savedPrompt.applicationDecision.questionIntent.sessionPartitionIssue).toEqual(prompt.applicationDecision.questionIntent.sessionPartitionIssue);
      expect(savedPrompt.applicationDecision.questionIntent.sessionPartitionIssue).toMatchObject({
        factId: workA.id, matchingSessionDurationFactIds: caps.map((fact) => fact.id),
        details: { taskId: checkpoint.graph.tasks[0].id, sessionDurationScopeFactId: workA.id },
      });
    }
    expect(listWeeklyPlanningTraceOutboxItems({ userId: OWNER, conversationId: checkpoint.conversationId })).toEqual([]);
  } else {
    expect(ref.current!.state.previewCandidates!.map((candidate) => candidate.durationMinutes).sort((a, b) => a - b)).toEqual([10, 30, 30]);
    expect(prompt.applicationDecision.actionKind).toBe('preview_ready');
    expect(prompt.applicationDecision.questionIntent).toBeNull();
    const capA = caps.find((fact) => fact.targetFactId === workA.id)!;
    const capB = caps.find((fact) => fact.targetFactId !== workA.id)!;
    for (const candidate of ref.current!.state.previewCandidates!) {
      const refs = (candidate as WeeklyDraftCandidate & {
        stableV5Metadata: WeeklyPlanningStableV5PreviewProvenance;
      }).stableV5Metadata.sourceFactRefs;
      if (refs.includes(workA.id)) { expect(refs).toContain(capA.id); expect(refs).not.toContain(capB.id); }
      else { expect(refs).toContain(capB.id); expect(refs).not.toContain(capA.id); }
    }
  }
});
