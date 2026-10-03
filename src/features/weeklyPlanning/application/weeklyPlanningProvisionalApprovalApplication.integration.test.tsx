import { createRef, forwardRef, useImperativeHandle } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlanFromDraft } from '../../../domain/planner';
import { createReadyPlannerDataAvailability } from '../testUtils/plannerDataAvailabilityTest';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
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
      plannerDataAvailability: createReadyPlannerDataAvailability(OWNER),
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
});
