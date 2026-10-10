import * as graphStaging from './weeklyPlanningStableV5GraphStaging';
import { validateWeeklyPlanningSemanticResponseV5 } from '../semantic/weeklyPlanningSemanticResponseValidationV5';
import { createWeeklyPlanningSemanticPublicStateSummaryV5 } from '../semantic/weeklyPlanningSemanticPublicStateV5';
import { createRef, forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlanFromDraft } from '../../../domain/planner';
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
import { getWeeklyPlanningStableV5SessionStorageKeyForTest } from './weeklyPlanningStableV5SessionStorage';
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
  it.each(['preview', 'draft'] as const)('discards a real staged turn on an invalid occupied clock while retaining the prior %s state', async (retainedState) => {
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
    const initial = workloadDocument();
    const initialText = '8月17日から23日で数学の教材を60分進めたい';
    initial.tasks[0].sourceText = '数学の教材を60分進めたい';
    initial.tasks[0].workloads[0] = {
      ...initial.tasks[0].workloads[0], amount: 60, unitCode: 'minute', unitLabel: '分',
      sourceText: initial.tasks[0].sourceText,
    };
    const initialValidation = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(initial), { currentUserText: initialText });
    expect(initialValidation.errors).toEqual([]);
    if (!initialValidation.document) throw new Error('initial duration document must be accepted');
    normalizeMock.mockResolvedValueOnce(accepted(initialValidation.document));
    await act(async () => { renderer = create(<Harness ref={ref} {...props} />); });
    await act(async () => { expect((await ref.current!.submitTurn(initialText)).accepted).toBe(true); });
    const preview = structuredClone(ref.current!.state.previewCandidates!);
    expect(preview).toHaveLength(1);
    expect(preview[0]).toMatchObject({ durationMinutes: 60, estimatedMinutes: 60 });
    const blocks = createWeeklyDraftBlocksFromPreviewCandidates({ candidates: preview, userId: OWNER, createdAt: new Date().toISOString() });
    if (retainedState === 'draft') {
      await act(async () => { ref.current!.createDraftBlocks(blocks); });
    }
    // Promotion consumes the preview; exercise each real prior state separately.
    const retainedPreview = retainedState === 'preview' ? preview : [];
    const retainedDrafts = retainedState === 'draft' ? blocks : [];
    expect(ref.current!.state.previewCandidates).toEqual(retainedPreview);
    expect(ref.current!.pendingDraftBlocks).toEqual(retainedDrafts);
    const key = getWeeklyPlanningStableV5SessionStorageKeyForTest(OWNER, WEEK_START);
    const before = JSON.parse(storage.values.get(key)!) as WeeklyPlanningStableV5PersistedSession;
    expect(before.graph.tasks).toHaveLength(1);
    expect(before.planningState.previewCandidates).toEqual(retainedPreview);
    expect(before.planningState.draftBlocks).toEqual(retainedDrafts);

    const next = structuredClone(initialValidation.document);
    const nextText = '8月17日から23日で英語の教材も60分進めたい';
    next.tasks[0].localId = 'english-task';
    next.tasks[0].title = '英語の教材';
    next.tasks[0].sourceText = '英語の教材も60分進めたい';
    if (next.tasks[0].study) next.tasks[0].study.contextLabel = next.tasks[0].title;
    next.tasks[0].workloads[0].localId = 'english-workload';
    next.tasks[0].workloads[0].sourceText = next.tasks[0].sourceText;
    const nextValidation = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(next), {
      currentUserText: nextText, committedGraph: before.graph,
      publicStateSummary: createWeeklyPlanningSemanticPublicStateSummaryV5(undefined, before.graph),
    });
    expect(nextValidation.errors).toEqual([]);
    if (!nextValidation.document) throw new Error('new independent duration task must be accepted');
    normalizeMock.mockResolvedValueOnce(accepted(nextValidation.document));
    props.monthEvents = [{
      id: 'private-invalid-clock-event', userId: OWNER, date: WEEK_START,
      title: 'PRIVATE_TIMED_EVENT', startTime: '09:00', endTime: '09:99',
      repeat: 'none', repeatUntil: null, excludedDates: [], url: '', memo: 'PRIVATE_MEMO',
      checklist: [], locationTags: [], createdAt: '2026-08-16T00:00:00.000Z', updatedAt: '2026-08-16T00:00:00.000Z',
    }];
    await act(async () => { renderer!.update(<Harness ref={ref} {...props} />); });
    const stage = vi.spyOn(graphStaging, 'stageWeeklyPlanningStableV5Graph');
    try {
      await act(async () => {
        await expect(ref.current!.submitTurn(nextText))
          .rejects.toThrow(new RangeError('Invalid timed schedule occurrence clock'));
      });
      expect(normalizeMock).toHaveBeenCalledTimes(2);
      expect(stage).toHaveBeenCalledTimes(1);
      const staged = stage.mock.calls[0]?.[0];
      if (!staged) throw new Error('the actual turn must have staged before placement failed');
      expect(staged.graph.revision).toBeGreaterThan(before.graph.revision);
      expect(staged.graph.tasks).toEqual(expect.arrayContaining([expect.objectContaining({ title: '英語の教材' })]));
      const turnKey = staged.graph.appliedTurnKeys[staged.graph.appliedTurnKeys.length - 1];
      expect(turnKey.startsWith(`${before.conversationId}:`)).toBe(true);
      const requestId = turnKey.slice(`${before.conversationId}:`.length);
      expect(graphStaging.readWeeklyPlanningStableV5StagedGraph({ conversationId: before.conversationId, requestId })).toBeNull();
      expect(getWeeklyPlanningStableV5RuntimeSession(before.conversationId)?.graph).toEqual(before.graph);
      expect(ref.current!.state.pendingTurn).toBeUndefined();
      expect(ref.current!.state.previewCandidates).toEqual(retainedPreview);
      expect(ref.current!.pendingDraftBlocks).toEqual(retainedDrafts);
      const failed = JSON.parse(storage.values.get(key)!) as WeeklyPlanningStableV5PersistedSession;
      expect(failed.graph).toEqual(before.graph);
      expect(failed.planningState.previewCandidates).toEqual(retainedPreview);
      expect(failed.planningState.draftBlocks).toEqual(retainedDrafts);
      expect(database.metrics).toEqual({ planWrites: 0, itemWrites: 0, operationWrites: 0 });
      await act(async () => { renderer!.unmount(); }); renderer = undefined;
      resetWeeklyPlanningStableV5RuntimeSessionsForTest(); clearWeeklyPlanningSessionRuntime();
      await act(async () => { renderer = create(<Harness ref={ref} {...props} />); });
      expect(getWeeklyPlanningStableV5RuntimeSession(before.conversationId)?.graph).toEqual(before.graph);
      expect(ref.current!.state.previewCandidates).toEqual(retainedPreview);
      expect(ref.current!.pendingDraftBlocks).toEqual(retainedDrafts);
      expect(database.metrics).toEqual({ planWrites: 0, itemWrites: 0, operationWrites: 0 });
      expect(normalizeMock).toHaveBeenCalledTimes(2);
    } finally {
      stage.mockRestore();
    }
  });

});
