import * as aiConfig from '../../../lib/aiConfig';
import * as providerClient from '../../../services/ai/openAiCompatibleClient';
import { renderWeeklyPlanningStableV5AssistantMessage } from '../dialogue/weeklyPlanningStableV5TurnDialogue';
import * as debugTrace from '../trace/weeklyPlanningStableV5DebugTrace';
import { resetWeeklyPlanningDialogueRendererPromptContextsForTest } from '../trace/weeklyPlanningDialogueRendererTrace';
import { setWeeklyPlanningTraceRepositoryForTests } from '../trace/weeklyPlanningTraceRepository';
import { listWeeklyPlanningTraceOutboxItems } from '../trace/weeklyPlanningTraceOutbox';
import { resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from '../trace/weeklyPlanningStableV5TraceRuntime';
import type { WeeklyPlanningTraceRepository } from '../trace/weeklyPlanningTraceTypes';
import type { WeeklyPlanningTurnDiagnosticV2WithRendererTrace } from '../trace/weeklyPlanningTurnDiagnosticV2ResponseSource';
import { measureWeeklyPlanningTraceJsonBytes, WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
// Hold code loading independently of planner-data authority and turn execution.
vi.mock('./weeklyPlanningRuntimeModule', async () => ({
  ...await vi.importActual('./weeklyPlanningRuntimeModule'),
  loadWeeklyPlanningRuntimeModule: loadRuntimeMock,
}));
import { PlannerDataReadAuthority } from '../../../domain/plannerDataReadAuthority';
import * as turnApplication from './weeklyPlanningTurnApplication';
import { weeklyPlanningTurnStagingLifecycle } from './weeklyPlanningTurnSideEffects';
import { weeklyPlanningTurnOutcomeLifecycle } from './weeklyPlanningTurnOutcomeLifecycle';
import { createReadyPlannerDataAvailability } from '../testUtils/plannerDataAvailabilityTest';
import {
  createRef,
  forwardRef,
  useImperativeHandle,
  type RefObject,
} from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlanFromDraft } from '../../../domain/planner';
import type { Actual, Plan, PlanDraft, StudyMaterial } from '../../../types/domain';
import { createInitialPlanningState } from '../weeklyPlanningReducer';
import { createWeeklyDraftBlocksFromPreviewCandidates } from '../preview/weeklyPlanningPreviewBlocks';
import { WeeklyPlanningStableCollectionLimitError } from '../weeklyPlanningStateCodec';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import * as sessionCodec from './weeklyPlanningStableV5SessionCodec';
import * as compatibilityStorage from '../weeklyPlanningStorage';
import {
  loadWeeklyPlanningStableV5PersistedSession,
  saveWeeklyPlanningStableV5PersistedSession,
} from './weeklyPlanningStableV5SessionStorage';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { resolveWeeklyPlanningQuestionPresentationFreshness } from '../intake/weeklyPlanningQuestionPresentation';
import type { WeeklyPreviewMetadata } from '../planning/weeklyPlanningApprovalTypes';
import {
  clearWeeklyPlanningSessionRuntime,
  publishWeeklyPlanningSessionRuntime,
} from '../planning/weeklyPlanningSessionRuntime';
import {
  createDeferred,
  createMemoryStorageHarness,
  createWeeklyPlanningTestDraftBlock,
  installWeeklyPlanningTestStorage,
  type MemoryStorageHarness,
} from '../testUtils/weeklyPlanningApplicationTestHarness';
import type {
  WeeklyPlanningTurnExecutionInput,
  WeeklyPlanningTurnExecutionResult,
  WeeklyPlanningTurnSubmissionResult,
} from '../weeklyPlanningTurnExecutor';
import {
  getWeeklyPlanningStableV5RuntimeSession,
  commitWeeklyPlanningStableV5RuntimeGraph,
  hasWeeklyPlanningStableV5StagedGraph,
  resetWeeklyPlanningStableV5RuntimeSessionsForTest,
} from './weeklyPlanningStableV5RuntimeSession';
import {
  getWeeklyPlanningStableV5SessionStorageKeyForTest,
} from './weeklyPlanningStableV5SessionStorage';
import {
  useWeeklyPlanningApplication,
  type UseWeeklyPlanningApplicationInput,
  type WeeklyPlanningApplication,
} from './useWeeklyPlanningApplication';

const executeWeeklyPlanningTurnMock = vi.hoisted(() => vi.fn());
const loadRuntimeMock = vi.hoisted(() => vi.fn());

vi.mock('../weeklyPlanningTurnExecutor', async () => {
  const actual = await vi.importActual<typeof import('../weeklyPlanningTurnExecutor')>(
    '../weeklyPlanningTurnExecutor',
  );
  return {
    ...actual,
    executeWeeklyPlanningTurn: executeWeeklyPlanningTurnMock,
  };
});

const ApplicationHarness = forwardRef<
  WeeklyPlanningApplication,
  UseWeeklyPlanningApplicationInput
>(function ApplicationHarness(props, ref) {
  const application = useWeeklyPlanningApplication(props);
  useImperativeHandle(ref, () => application, [application]);
  return null;
});

interface RenderedApplicationHarness {
  ref: RefObject<WeeklyPlanningApplication>;
  update(overrides: Partial<UseWeeklyPlanningApplicationInput>): Promise<void>;
  unmount(): Promise<void>;
}

function persistedPlan(draft: PlanDraft, id = 'persisted-plan'): Plan {
  return {
    ...createPlanFromDraft(draft),
    id,
  };
}

async function renderApplicationHarness(
  overrides: Partial<UseWeeklyPlanningApplicationInput> = {},
): Promise<RenderedApplicationHarness> {
  const ref = createRef<WeeklyPlanningApplication>();
  let currentProps: UseWeeklyPlanningApplicationInput = {
    userId: 'user-1',
    isPlannerDataSnapshotCurrent: () => true,
    selectedDate: '2026-07-14',
    plans: [],
    scheduleTemplates: [],
    saveWeeklyApprovedPlan: async (draft) => persistedPlan(draft),
    ...overrides,
    plannerDataAvailability:
      overrides.plannerDataAvailability
      ?? createReadyPlannerDataAvailability(overrides.userId ?? 'user-1'),
  };
  let renderer!: ReactTestRenderer;

  await act(async () => {
    renderer = create(<ApplicationHarness ref={ref} {...currentProps} />);
  });

  return {
    ref,
    async update(nextOverrides) {
      const nextUserId = nextOverrides.userId ?? currentProps.userId;
    currentProps = {
      ...currentProps,
      ...nextOverrides,
      plannerDataAvailability:
        nextOverrides.plannerDataAvailability
        ?? (nextOverrides.userId !== undefined
          ? (typeof nextUserId === 'string'
            ? createReadyPlannerDataAvailability(nextUserId)
            : {
  status: 'idle',
  ownerId: null,
  observedAt: null,
  lastSuccessfulAt: null,
})
          : currentProps.plannerDataAvailability),
    };
      await act(async () => {
        renderer.update(<ApplicationHarness ref={ref} {...currentProps} />);
      });
    },
    async unmount() {
      await act(async () => {
        renderer.unmount();
      });
    },
  };
}

function turnResult(sourceTurn: string): WeeklyPlanningTurnExecutionResult {
  return {
    state: {
      ...createInitialPlanningIntakeState(),
      sourceTurns: [sourceTurn],
    },
    message: `確認しました: ${sourceTurn}`,
    draftCandidates: [],
  };
}

describe('useWeeklyPlanningApplication', () => {
  let storageHarness: MemoryStorageHarness;
  let restoreWindow: () => void;

  beforeEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    storageHarness = createMemoryStorageHarness();
    restoreWindow = installWeeklyPlanningTestStorage(storageHarness.storage);
    executeWeeklyPlanningTurnMock.mockReset();
    loadRuntimeMock.mockReset().mockResolvedValue({});
    clearWeeklyPlanningSessionRuntime();
  });

  afterEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    clearWeeklyPlanningSessionRuntime();
    restoreWindow();
  });

  // The executor is this suite's existing boundary fixture. Actual generation and finite
  // verification are covered by the scripted-provider integration suite, not claimed here.
  async function presentRecoveryQuestion(app: RenderedApplicationHarness) {
    await act(async () => { expect(app.ref.current!.chat.initialize().status).toBe('saved'); });
    const seed = app.ref.current!.exportConversationSnapshot({ includeEmpty: true })!;
    const source = { conversationId: seed.conversationId, turnId: 'accepted-seed',
      semanticLocalId: 'task', sourceText: '英単語20語', origin: 'user' as const };
    seed.graph = { ...seed.graph, revision: 3,
      tasks: [{ id: 'task-english', category: 'study', title: '英単語', source, createdRevision: 1 }],
      workloads: [{ id: 'workload-english', taskId: 'task-english', componentId: null, quantityRole: 'target',
        amount: 20, unitCode: 'word', unitLabel: '語', rangeStart: null, rangeEnd: null,
        perOccurrence: false, periodExpression: null, source: { ...source, semanticLocalId: 'workload' }, createdRevision: 1 }],
      factLifecycles: ['task-english', 'workload-english'].map(factId => ({ factId, status: 'active' as const,
        createdRevision: 1, terminalRevision: null, supersededByFactId: null })),
    };
    await act(async () => { expect(app.ref.current!.loadConversationSnapshot(seed)).toBe(true); });
    const content = { responseSource: 'ai' as const, currentTurnGrounding: 'none' as const,
      selfRepairNotice: false, groundingContext: { proposed: 0, contested: 0 }, previewPromotionControl: false };
    executeWeeklyPlanningTurnMock.mockResolvedValueOnce({
      ...turnResult('英単語20語'), stableV5Graph: seed.graph, responseSource: 'ai',
      state: { ...turnResult('英単語20語').state, status: 'revision_pending', questions: ['合計時間を教えてください。'],
        lastQuestionContext: { kind: 'missing', targetSlot: 'stable_v5:missing_effort_estimate',
          intent: 'total_duration', topicId: 'workload-english' } },
      message: '英単語20語には、合計でどのくらい時間がかかりますか？', questionPresentationContent: content,
    } satisfies WeeklyPlanningTurnExecutionResult);
    await act(async () => { expect((await app.ref.current!.submitTurn('英単語20語')).accepted).toBe(true); });
    const before = structuredClone(app.ref.current!.state);
    expect(resolveWeeklyPlanningQuestionPresentationFreshness({ previousState: before.intakeState,
      inputStateRevision: before.revision, messages: before.messages, graphRevision: seed.graph.revision }).status).toBe('fresh');
    const message = '今回の変更はまだ反映していません。英単語20語に必要な合計時間は何分ほどですか？';
    const recoveryResult: WeeklyPlanningTurnExecutionResult = {
      ...turnResult('UNAPPLIED-RECOVERY-INPUT'), message, responseSource: 'ai',
      questionPresentationContent: content,
      recoveryPresentation: { question: { graphRevision: seed.graph.revision,
        previousAssistantMessageId: before.intakeState!.lastQuestionContext!.presentation!.assistantMessageId } },
      failure: { code: 'stable_v5_normalization_rejected', userMessage: message, traceCode: 'hook-recovery-fixture',
        diagnostics: { attemptCount: 2, repairAttempted: true, validationErrorCategories: ['invalid_json'], providerErrorCategory: null } },
    };
    return { before, graph: seed.graph, recoveryResult };
  }

  it('restores a saved recovery question after a selected-body read fault without losing its actual presentation', async () => {
    const first = await renderApplicationHarness();
    const { before, graph, recoveryResult } = await presentRecoveryQuestion(first);
    executeWeeklyPlanningTurnMock.mockResolvedValueOnce(recoveryResult);
    await act(async () => { expect((await first.ref.current!.submitTurn('200語に変更')).accepted).toBe(true); });
    const expected = structuredClone(first.ref.current!.state);
    const newMessage = expected.messages[expected.messages.length - 1];
    expect(newMessage.content).toBe(recoveryResult.message);
    expect(expected.intakeState?.sourceTurns).toEqual(before.intakeState?.sourceTurns);
    expect(expected.intakeState?.lastQuestionContext?.presentation?.assistantMessageId).toBe(newMessage.id);
    expect(expected.intakeState?.lastQuestionContext?.presentation?.assistantMessageId)
      .not.toBe(before.intakeState?.lastQuestionContext?.presentation?.assistantMessageId);
    expect(first.ref.current!.exportConversationSnapshot()?.graph).toEqual(graph);
    await act(async () => { expect(first.ref.current!.chat.checkpoint().status).toBe('saved'); });
    const stableKey = getWeeklyPlanningStableV5SessionStorageKeyForTest('user-1', '2026-07-13');
    const indexKey = 'studyplanner.weeklyPlanning.activeSession.user-1';
    const raw = storageHarness.values.get(stableKey)!;
    const index = storageHarness.values.get(indexKey);
    expect(JSON.parse(raw).planningState.intakeState.lastQuestionContext.presentation.assistantMessageId).toBe(newMessage.id);
    await first.unmount(); resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    const read = storageHarness.storage.getItem.bind(storageHarness.storage);
    let observedFault = false;
    storageHarness.storage.getItem = key => {
      if (key === stableKey) { observedFault = true; throw new Error('recovered checkpoint temporarily unavailable'); }
      return read(key);
    };
    const writes = vi.spyOn(storageHarness.storage, 'setItem');
    const second = await renderApplicationHarness();
    try {
      expect(observedFault).toBe(true);
      await act(async () => { expect(second.ref.current!.chat.initialize().status).toBe('blocked'); });
      expect(second.ref.current!.exportConversationSnapshot({ includeEmpty: true })).toBeNull();
      expect(second.ref.current!.chat.checkpoint().status).toBe('blocked');
      await act(async () => { expect((await second.ref.current!.submitTurn('全部で60分')).accepted).toBe(false); });
      expect(executeWeeklyPlanningTurnMock).toHaveBeenCalledTimes(2);
      expect(writes.mock.calls.filter(([key]) => key === stableKey || key === indexKey)).toEqual([]);
      expect(storageHarness.values.get(stableKey)).toBe(raw);
      expect(storageHarness.values.get(indexKey)).toBe(index);
      storageHarness.storage.getItem = read;
      await act(async () => { expect(second.ref.current!.chat.retry().status).toBe('saved'); });
      const restored = second.ref.current!.state;
      expect(executeWeeklyPlanningTurnMock).toHaveBeenCalledTimes(2);
      expect(restored.revision).toBe(expected.revision);
      expect(restored.messages).toEqual(expected.messages);
      expect(restored.intakeState?.lastQuestionContext).toEqual(expected.intakeState?.lastQuestionContext);
      expect(second.ref.current!.exportConversationSnapshot()?.graph).toEqual(graph);
      expect(resolveWeeklyPlanningQuestionPresentationFreshness({ previousState: restored.intakeState,
        inputStateRevision: restored.revision, messages: restored.messages, graphRevision: graph.revision }).status).toBe('fresh');
    } finally { storageHarness.storage.getItem = read; writes.mockRestore(); await second.unmount(); }
  });

  it('rejects a late recovery receipt after owner B becomes unavailable without saving it to either owner', async () => {
    const app = await renderApplicationHarness();
    const { recoveryResult } = await presentRecoveryQuestion(app);
    await act(async () => { expect(app.ref.current!.chat.checkpoint().status).toBe('saved'); });
    const ownerB = 'user-2'; const weekStartDate = '2026-07-13';
    expect(saveWeeklyPlanningStableV5PersistedSession({ ownerId: ownerB, weekStartDate, conversationId: 'owner-b',
      graph: { ...createEmptyWeeklyPlanningFactGraphV5(), revision: 7 }, planningState: {
        ...createInitialPlanningState(weekStartDate), messages: [{ id: 'owner-b:turn:1:user', role: 'user',
          content: 'Owner B retained work', createdAt: '2026-07-14T00:00:00Z' }],
      } })).toBe(true);
    const bIndexKey = `studyplanner.weeklyPlanning.activeSession.${ownerB}`;
    storageHarness.values.set(bIndexKey, JSON.stringify({ version: 1, ownerId: ownerB, weekStartDate, conversationId: 'owner-b' }));
    const protectedKeys = ['user-1', ownerB].flatMap(owner => [
      getWeeklyPlanningStableV5SessionStorageKeyForTest(owner, weekStartDate), `studyplanner.weeklyPlanning.activeSession.${owner}`,
    ]);
    const saved = protectedKeys.map(key => [key, storageHarness.values.get(key)] as const);
    const delayed = createDeferred<WeeklyPlanningTurnExecutionResult>();
    let observedInput: WeeklyPlanningTurnExecutionInput | undefined;
    executeWeeklyPlanningTurnMock.mockImplementationOnce((input: WeeklyPlanningTurnExecutionInput) => {
      observedInput = input; return delayed.promise;
    });
    let submission!: Promise<WeeklyPlanningTurnSubmissionResult>;
    await act(async () => { submission = app.ref.current!.submitTurn('200語に変更'); await Promise.resolve(); });
    expect(observedInput?.isCurrentTurn?.()).toBe(true);
    const read = storageHarness.storage.getItem.bind(storageHarness.storage);
    storageHarness.storage.getItem = key => { if (key === bIndexKey) throw new Error('owner B unavailable'); return read(key); };
    const writes = vi.spyOn(storageHarness.storage, 'setItem');
    try {
      await app.update({ userId: ownerB });
      await act(async () => { expect(app.ref.current!.chat.initialize().status).toBe('blocked'); });
      expect(observedInput?.isCurrentTurn?.()).toBe(false);
      expect(app.ref.current!.exportConversationSnapshot({ includeEmpty: true })).toBeNull();
      await act(async () => { delayed.resolve(recoveryResult); expect((await submission).accepted).toBe(false); });
      expect(app.ref.current!.state.messages).toEqual([]);
      expect(app.ref.current!.state.intakeState?.lastQuestionContext).toBeUndefined();
      expect(executeWeeklyPlanningTurnMock).toHaveBeenCalledTimes(2);
      expect(writes.mock.calls.filter(([key]) => protectedKeys.includes(key))).toEqual([]);
      for (const [key, raw] of saved) expect(storageHarness.values.get(key)).toBe(raw);
    } finally { storageHarness.storage.getItem = read; writes.mockRestore(); await app.unmount(); }
  });

  it.each([500, 501] as const)('traces the actual renderer and admission outcome before outbox replay: %s candidates', async count => {
    // Existing execution-result fixture boundary; application, renderer, controller,
    // graph staging/rollback, diagnostic construction, outbox and Worker are real.
    // These typed candidates do not claim real semantic interpretation or scheduling.
    const previousTraceFlag = import.meta.env.VITE_WEEKLY_PLANNING_TRACE_ENABLED;
    vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', 'true');
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    debugTrace.resetWeeklyPlanningStableV5DebugTraceForTest();
    resetWeeklyPlanningDialogueRendererPromptContextsForTest();
    type Request = Parameters<providerClient.OpenAiCompatibleClient['createChatCompletion']>[0];
    type Batch = Parameters<WeeklyPlanningTraceRepository['appendEntries']>[0];
    const calls: Request[] = [];
    const fixtureErrors: string[] = [];
    const attempts: Batch[] = [];
    const writes: Batch[] = [];
    const executions: Array<{ input: WeeklyPlanningTurnExecutionInput; result: WeeklyPlanningTurnExecutionResult }> = [];
    let candidateCount = 1;
    let targetRequestId: string | undefined;
    let rejectedAppend = false;
    const rendererText = '数学の候補を確認し、「この内容で仮予定にする」を選択してください。';
    const config = vi.spyOn(aiConfig, 'getAiConfig').mockReturnValue({
      provider: 'openai', baseUrl: 'https://renderer.fixture.invalid/v1', model: 'fixture', apiKey: 'fixture-placeholder',
    });
    const client = vi.spyOn(providerClient, 'createOpenAiCompatibleClient').mockReturnValue({
      async createChatCompletion(request) {
        calls.push(structuredClone(request)); // Capture dispatch before any fixture parse can throw.
        try {
          const users = request.messages.filter(message => message.role === 'user');
          if (users.length !== 1 || typeof users[0].content !== 'string') throw new Error('Expected sole user renderer payload');
          const body = JSON.parse(users[0].content);
          return JSON.stringify({ actionId: body.actionId, actionKind: body.applicationDecision.actionKind,
            questionCode: body.applicationDecision.questionCode, groundingAcknowledgement: null, text: rendererText });
        } catch (error) {
          fixtureErrors.push(error instanceof Error ? error.message : String(error));
          throw error;
        }
      },
    });
    const observedDebug = vi.spyOn(debugTrace, 'recordWeeklyPlanningStableV5DebugTrace');
    const committed = vi.spyOn(weeklyPlanningTurnOutcomeLifecycle, 'committed');
    const repository: WeeklyPlanningTraceRepository = {
      async upsertSession() {},
      async appendEntries(value) {
        attempts.push(structuredClone(value));
        if (!rejectedAppend && value.entries.some(entry => entry.requestId === targetRequestId)) {
          rejectedAppend = true;
          throw new Error('injected trace append fault after actual admission');
        }
        writes.push(structuredClone(value));
      },
      async listSessions() { return []; }, async listSessionsForAdmin() { return []; },
      async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; },
    };
    setWeeklyPlanningTraceRepositoryForTests(repository);
    const save = vi.fn(async (_draft: PlanDraft): Promise<Plan> => { throw new Error('Unexpected Plan write'); });
    let harness: RenderedApplicationHarness | undefined;
    executeWeeklyPlanningTurnMock.mockImplementation(async (input: WeeklyPlanningTurnExecutionInput) => {
      const runtime = getWeeklyPlanningStableV5RuntimeSession(input.conversationId);
      if (!runtime) throw new Error('Expected application-owned runtime');
      if (executions.length === 1) targetRequestId = input.traceRequestId;
      const graph = { ...structuredClone(runtime.graph), revision: runtime.graph.revision + 1,
        appliedTurnKeys: [...runtime.graph.appliedTurnKeys, `${input.conversationId}:${input.traceRequestId}`] };
      if (graph.tasks.length === 0) {
        graph.tasks = [{ id: 'trace-admission-task', category: 'study', title: '数学', createdRevision: 1,
          source: { conversationId: input.conversationId, turnId: input.traceRequestId,
            semanticLocalId: 'task', sourceText: 'typed admission fixture', origin: 'user' } }];
        graph.factLifecycles = [{ factId: graph.tasks[0].id, status: 'active', createdRevision: 1,
          terminalRevision: null, supersededByFactId: null }];
      }
      const taskId = graph.tasks[0].id;
      const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
      const result: WeeklyPlanningTurnExecutionResult = {
        ...turnResult(input.userText), stableV5Graph: graph,
        state: { ...turnResult(input.userText).state, status: 'draft_ready', shouldCreateDraft: true },
        draftCandidates: Array.from({ length: candidateCount }, (_, index) => {
          const start = 9 * 60 + (index % 120) * 5;
          return { stableKey: `${input.traceRequestId}:candidate:${index}`, date: `2026-07-${14 + Math.floor(index / 120)}`,
            startTime: clock(start), endTime: clock(start + 5), durationMinutes: 5, title: `数学 ${index + 1}`,
            field: '数学', year: 0, estimatedMinutes: 5, source: 'weekly_exam_prep' as const, approvalStatus: 'unapproved' as const,
            workItemKey: `trace-admission-work-${index}`, stableV5Metadata: { runtime: 'stable_v5' as const,
              conversationId: input.conversationId, graphRevision: graph.revision,
              taskId, sourceFactRefs: [taskId], planType: 'study' as const } };
        }),
      };
      commitWeeklyPlanningStableV5RuntimeGraph({ ownerId: input.userId, conversationId: input.conversationId, graph });
      const rendered = await renderWeeklyPlanningStableV5AssistantMessage({ input, result });
      executions.push({ input, result: rendered });
      return rendered;
    });
    const entriesFor = (requestId: string) => writes.flatMap(batch => batch.entries).filter(entry => entry.requestId === requestId);
    try {
      harness = await renderApplicationHarness({ saveWeeklyApprovedPlan: save });
      await act(async () => { expect((await harness!.ref.current!.submitTurn('initial preview')).accepted).toBe(true); });
      expect(fixtureErrors).toEqual([]);
      expect(calls).toHaveLength(1);
      expect(executions).toHaveLength(1);
      const first = executions[0].input;
      await vi.waitFor(() => expect(entriesFor(first.traceRequestId)).toHaveLength(1));
      const before = harness.ref.current!.state;
      expect(before.previewCandidates).toHaveLength(1);
      const graphBefore = structuredClone(getWeeklyPlanningStableV5RuntimeSession(first.conversationId)!.graph);
      candidateCount = count;
      let submission: WeeklyPlanningTurnSubmissionResult | undefined;
      let failure: unknown;
      await act(async () => {
        try { submission = await harness!.ref.current!.submitTurn('next typed preview'); }
        catch (error) { failure = error; }
      });
      expect(fixtureErrors).toEqual([]);
      expect(calls).toHaveLength(2);
      expect(executions).toHaveLength(2);
      const attempted = executions[1];
      expect(targetRequestId).toBe(attempted.input.traceRequestId);
      expect(attempted.result).toMatchObject({ responseSource: 'ai', message: rendererText,
        dialogueRendererTrace: { response: { status: 'rendered' }, decision: { branch: 'ai_rendered' } } });
      expect(attempted.result.recoveryPresentation).toBeUndefined();
      expect(attempted.result.draftCandidates).toHaveLength(count);
      const users = calls[1].messages.filter(message => message.role === 'user');
      expect(users).toHaveLength(1);
      expect(typeof users[0].content).toBe('string');
      const payload = JSON.parse(users[0].content);
      expect(payload.applicationDecision).toMatchObject({ actionKind: 'preview_ready', previewCount: count,
        previewEvidence: { status: 'available', phase: 'generated_preview', constraintEvaluation: 'not_evaluated',
          summary: { scope: 'all_candidates', candidateCount: count, totalDurationMinutes: count * 5 } } });
      expect(payload.applicationDecision.previewEvidence.graphRevision).toBe(attempted.result.stableV5Graph!.revision);
      for (const detail of payload.applicationDecision.previewEvidence.details.candidates) {
        expect(detail.taskId).toBe(attempted.result.stableV5Graph!.tasks[0].id);
        expect(detail.sourceFactRefs).toEqual([attempted.result.stableV5Graph!.tasks[0].id]);
      }
      expect(payload.applicationDecision.previewEvidence.details.candidates.length).toBeLessThanOrEqual(8);
      expect(payload.applicationDecision.previewEvidence.details.omittedCount)
        .toBe(count - payload.applicationDecision.previewEvidence.details.candidates.length);
      const after = harness.ref.current!.state;
      expect(after.pendingTurn).toBeUndefined();
      expect(after.revision).toBe(before.revision + 2);
      expect(hasWeeklyPlanningStableV5StagedGraph({ conversationId: first.conversationId, requestId: attempted.input.traceRequestId })).toBe(false);
      if (count === 501) {
        expect(failure).toBeInstanceOf(WeeklyPlanningStableCollectionLimitError);
        if (!(failure instanceof WeeklyPlanningStableCollectionLimitError)) throw new Error('Expected real admission rejection');
        expect(failure.detail).toEqual({ collection: 'previewCandidates', actualCount: 501, limit: 500 });
        expect(submission).toBeUndefined();
        expect(after.previewCandidates).toBe(before.previewCandidates);
        expect(after.intakeState).toBe(before.intakeState);
        expect(after.draftBlocks).toBe(before.draftBlocks);
        expect(getWeeklyPlanningStableV5RuntimeSession(first.conversationId)!.graph).toEqual(graphBefore);
        expect(after.lastAssistantMessage).toBe(failure.message);
        expect(after.lastAssistantMessage).toContain('501');
        expect(after.lastAssistantMessage).not.toBe(rendererText);
        expect(committed).toHaveBeenCalledTimes(1);
      } else {
        expect(failure).toBeUndefined();
        expect(submission?.accepted).toBe(true);
        expect(after.previewCandidates).toEqual(attempted.result.draftCandidates);
        expect(getWeeklyPlanningStableV5RuntimeSession(first.conversationId)!.graph).toEqual(attempted.result.stableV5Graph);
        expect(after.lastAssistantMessage).toBe(rendererText);
        expect(committed).toHaveBeenCalledTimes(2);
      }
      const displayed = after.messages[after.messages.length - 1];
      expect(displayed).toMatchObject({ role: 'assistant', content: after.lastAssistantMessage });
      const checkpoint = loadWeeklyPlanningStableV5PersistedSession({ ownerId: first.userId, weekStartDate: after.weekStartDate });
      expect(checkpoint).not.toBeNull();
      if (!checkpoint) throw new Error('Expected actual Stable checkpoint');
      expect(checkpoint.graph).toEqual(count === 501 ? graphBefore : attempted.result.stableV5Graph);
      expect(checkpoint.planningState.previewCandidates).toEqual(after.previewCandidates);
      expect(checkpoint.planningState.messages[checkpoint.planningState.messages.length - 1]).toEqual(displayed);
      expect(save).not.toHaveBeenCalled();
      expect(observedDebug.mock.calls.filter(([event]) => event.requestId === attempted.input.traceRequestId && event.stage === 'runtime_turn_threw')).toEqual([]);
      await vi.waitFor(() => expect(listWeeklyPlanningTraceOutboxItems({ userId: first.userId, conversationId: first.conversationId })).toHaveLength(1));
      expect(rejectedAppend).toBe(true);
      expect(entriesFor(attempted.input.traceRequestId)).toEqual([]);
      const queued = listWeeklyPlanningTraceOutboxItems({ userId: first.userId, conversationId: first.conversationId })[0];
      const outboxKey = 'studyplanner.weeklyPlanning.trace.outbox.v1';
      const rawOutbox = storageHarness.values.get(outboxKey);
      expect(typeof rawOutbox).toBe('string');
      if (typeof rawOutbox !== 'string') throw new Error('Expected actual persistent outbox bytes');
      const storedOutbox = JSON.parse(rawOutbox);
      expect(storedOutbox.version).toBe('studyplanner-weekly-planning-trace-outbox-v1');
      expect(storedOutbox.items).toEqual([queued]); // Raw queued input, not the repository append envelope.
      expect(queued.input).toMatchObject({ requestId: attempted.input.traceRequestId, assistantMessage: displayed.content,
        responseSource: count === 501 ? 'system' : 'ai', outcome: count === 501 ? 'failed' : 'preview_ready',
        previewCount: count === 501 ? 0 : count,
        dialogueRendererTrace: { request: { previewCount: count }, decision: { responseSource: 'ai', finalMessage: rendererText } } });
      expect(queued.input.debugTraceEvents ?? []).not.toContainEqual(expect.objectContaining({ stage: 'runtime_turn_threw' }));
      resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest(); // Durable outbox stays; no fabricated retry input.
      candidateCount = 1;
      await act(async () => { expect((await harness!.ref.current!.submitTurn('healthy continuation')).accepted).toBe(true); });
      expect(fixtureErrors).toEqual([]);
      expect(calls).toHaveLength(3);
      expect(executions).toHaveLength(3);
      expect(calls.map(request => request.responseFormat?.json_schema.name)).toEqual(Array(3).fill('weekly_planning_stable_v5_dialogue_response'));
      await vi.waitFor(() => {
        expect(entriesFor(attempted.input.traceRequestId)).toHaveLength(1);
        expect(entriesFor(executions[2].input.traceRequestId)).toHaveLength(1);
        expect(listWeeklyPlanningTraceOutboxItems({ userId: first.userId, conversationId: first.conversationId })).toEqual([]);
        expect(storageHarness.values.has(outboxKey)).toBe(false);
      });
      expect(attempts.flatMap(batch => batch.entries).filter(entry => entry.requestId === attempted.input.traceRequestId)).toHaveLength(2);
      const entry = entriesFor(attempted.input.traceRequestId)[0];
      expect(entry.kind).toBe('turn_diagnostic');
      if (entry.kind !== 'turn_diagnostic') throw new Error('Expected actual admission turn diagnostic');
      const diagnostic = entry as WeeklyPlanningTurnDiagnosticV2WithRendererTrace;
      const expected = { assistantOutput: { text: displayed.content, responseSource: count === 501 ? 'system' : 'ai' },
        diagnostics: { outcome: count === 501 ? 'failed' : 'preview_ready', previewCount: count === 501 ? 0 : count,
          error: count === 501 ? { type: 'WeeklyPlanningStableCollectionLimitError', message: 'WeeklyPlanningStableCollectionLimitError' } : null,
          dialogueRenderer: { request: { previewCount: count }, response: { status: 'rendered' },
            decision: { branch: 'ai_rendered', responseSource: 'ai', finalMessage: rendererText } } } };
      expect(diagnostic).toMatchObject(expected);
      expect(measureWeeklyPlanningTraceJsonBytes(diagnostic)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
      const batch = writes.find(value => value.entries.some(value => value.requestId === attempted.input.traceRequestId))!;
      const prepared = prepareWeeklyPlanningTraceServerWrite({
        session: batch.session as unknown as Record<string, unknown>, entries: [diagnostic as unknown as Record<string, unknown>],
      }, { token: `wpt_${'a'.repeat(43)}`, epoch: '103' }, {
        sessionId: 'weekly-trace-623e4567-e89b-52d3-a456-426614174000', logicalConversationId: first.conversationId,
      }, new Date().toISOString());
      expect(prepared.entries).toHaveLength(1);
      expect(prepared.entries[0]).toMatchObject(expected);
      expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
      expect(save).not.toHaveBeenCalled();
    } finally {
      await harness?.unmount();
      config.mockRestore(); client.mockRestore(); observedDebug.mockRestore(); committed.mockRestore();
      setWeeklyPlanningTraceRepositoryForTests(undefined);
      resetWeeklyPlanningStableV5TraceRuntimeForTest();
      debugTrace.resetWeeklyPlanningStableV5DebugTraceForTest();
      resetWeeklyPlanningDialogueRendererPromptContextsForTest();
      vi.stubEnv('VITE_WEEKLY_PLANNING_TRACE_ENABLED', previousTraceFlag);
    }
  });

  it.each(['stable-result', 'compatibility-with-empty-runtime', 'stable-at-limit', 'stable-preserved-preview', 'compatibility-with-existing-graph'] as const)(
    'admits the actual controller preview using its publication scope: %s', async scope => {
      const stable = !scope.startsWith('compatibility-');
      const initialStable = stable || scope === 'compatibility-with-existing-graph';
      const preserve = scope === 'stable-preserved-preview';
      const initialCount = scope === 'stable-at-limit' || preserve ? 500 : 1;
      const retainedCount = scope === 'stable-at-limit' ? 500 : 1;
      let candidateCount = initialCount;
      const executions: Array<{ input: WeeklyPlanningTurnExecutionInput; candidateCount: number }> = [];
      const prepare = vi.spyOn(weeklyPlanningTurnStagingLifecycle, 'prepare');
      const committed = vi.spyOn(weeklyPlanningTurnOutcomeLifecycle, 'committed');
      const save = vi.fn(async (_draft: PlanDraft): Promise<Plan> => { throw new Error('Unexpected Plan write'); });
      executeWeeklyPlanningTurnMock.mockImplementation(async (input: WeeklyPlanningTurnExecutionInput) => {
        executions.push({ input, candidateCount });
        const runtime = getWeeklyPlanningStableV5RuntimeSession(input.conversationId);
        if (!runtime) throw new Error('Expected the application-owned runtime binding');
        const graph = { ...createEmptyWeeklyPlanningFactGraphV5(), revision: runtime.graph.revision + 1,
          appliedTurnKeys: [`${input.conversationId}:${input.traceRequestId}`],
          tasks: [{ id: 'admission-task', category: 'study' as const, title: '数学', createdRevision: 1,
            source: { conversationId: input.conversationId, turnId: input.traceRequestId,
              semanticLocalId: 'task', sourceText: 'typed admission fixture', origin: 'user' as const } }],
          factLifecycles: [{ factId: 'admission-task', status: 'active' as const, createdRevision: 1,
            terminalRevision: null, supersededByFactId: null }],
        };
        // Execution output is the fixture boundary. Controller, state projection,
        // real graph staging/finalization/rollback and persistence are not mocked.
        const stableExecution = stable || (initialStable && executions.length === 1);
        if (stableExecution) commitWeeklyPlanningStableV5RuntimeGraph({ ownerId: input.userId,
          conversationId: input.conversationId, graph });
        return { ...turnResult(input.userText), ...(stableExecution ? { stableV5Graph: graph } : {}),
          preserveExistingPreview: preserve && candidateCount === 501,
          draftCandidates: Array.from({ length: candidateCount }, (_, index) => ({
            stableKey: `${input.traceRequestId}:candidate:${index}`, date: '2026-07-14',
            startTime: '09:00', endTime: '09:05', durationMinutes: 5, title: `数学 ${index + 1}`,
            field: '数学', year: 0, estimatedMinutes: 5, source: 'weekly_exam_prep' as const,
            approvalStatus: 'unapproved' as const, workItemKey: `admission-work-${index}`,
            ...(stableExecution ? { stableV5Metadata: { runtime: 'stable_v5' as const,
              conversationId: input.conversationId, graphRevision: graph.revision,
              taskId: 'admission-task', sourceFactRefs: ['admission-task'], planType: 'study' as const } } : {}),
          })),
        };
      });
      const harness = await renderApplicationHarness({ saveWeeklyApprovedPlan: save });
      try {
        await act(async () => {
          harness.ref.current!.createDraftBlocks(Array.from({ length: retainedCount }, (_, index) =>
            createWeeklyPlanningTestDraftBlock({ id: `retained-draft-${index}` })));
          await harness.ref.current!.submitTurn('initial preview');
        });
        expect(executions).toHaveLength(1);
        const initial = executions[0];
        if (!initial) throw new Error('Expected initial controlled execution');
        expect(initial.candidateCount).toBe(initialCount);
        const conversationId = initial.input.conversationId;
        const before = harness.ref.current!.state;
        expect(before.previewCandidates).toHaveLength(initialCount);
        expect(before.draftBlocks).toHaveLength(retainedCount);
        const graphBefore = getWeeklyPlanningStableV5RuntimeSession(conversationId)!.graph;
        expect(graphBefore.revision).toBe(initialStable ? 1 : 0);
        if (initialStable) {
          // Best-effort save success is not assumed: exercise the real codec read-back.
          const checkpoint = loadWeeklyPlanningStableV5PersistedSession({
            ownerId: initial.input.userId, weekStartDate: before.weekStartDate,
          });
          expect(checkpoint).not.toBeNull();
          if (!checkpoint) throw new Error('Expected a valid initial Stable checkpoint');
          expect(checkpoint.conversationId).toBe(conversationId);
          expect(checkpoint.graph).toEqual(graphBefore);
          expect(checkpoint.planningState.previewCandidates).toEqual(before.previewCandidates);
          expect(checkpoint.planningState.draftBlocks).toEqual(before.draftBlocks);
        }
        candidateCount = 501;
        let submission: WeeklyPlanningTurnSubmissionResult | undefined;
        let failure: unknown;
        await act(async () => {
          try { submission = await harness.ref.current!.submitTurn('oversize preview'); }
          catch (error) { failure = error; }
        });
        expect(executions).toHaveLength(2);
        const oversized = executions[1];
        if (!oversized) throw new Error('Expected second controlled execution');
        expect(oversized.candidateCount).toBe(501);
        expect(oversized.input.traceRequestId).not.toBe(initial.input.traceRequestId);
        expect(oversized.input.conversationId).toBe(conversationId);
        expect(oversized.input.userId).toBe(initial.input.userId);
        expect(prepare).toHaveBeenCalledTimes(2);
        expect(prepare).toHaveBeenLastCalledWith(expect.objectContaining({
          ownerId: oversized.input.userId,
          pending: expect.objectContaining({ conversationId, requestId: oversized.input.traceRequestId }),
        }));
        const after = harness.ref.current!.state;
        expect(after.pendingTurn).toBeUndefined();
        if (stable && !preserve) {
          expect(after.previewCandidates).toHaveLength(initialCount);
          expect(committed).toHaveBeenCalledTimes(1);
          expect(committed).toHaveBeenLastCalledWith(expect.objectContaining({
            pending: expect.objectContaining({ requestId: initial.input.traceRequestId }),
          }));
          expect(after.previewCandidates).toBe(before.previewCandidates);
          expect(after.intakeState).toBe(before.intakeState);
          expect(after.draftBlocks).toBe(before.draftBlocks);
          expect(getWeeklyPlanningStableV5RuntimeSession(conversationId)!.graph).toEqual(graphBefore);
          expect(submission?.draftCandidates ?? []).toEqual([]);
          expect(failure).toBeInstanceOf(Error);
          expect((failure as Error).message).toContain('500');
          expect(failure).toBeInstanceOf(WeeklyPlanningStableCollectionLimitError);
          expect(after.lastAssistantMessage).toBe((failure as Error).message);
          expect(after.revision).toBe(before.revision + 2); // begin + truthful failure only
        } else if (preserve) {
          expect(failure).toBeUndefined();
          expect(submission?.accepted).toBe(true);
          expect(after.previewCandidates).toBe(before.previewCandidates);
          expect(after.previewCandidates).toHaveLength(500);
          expect(committed).toHaveBeenCalledTimes(2);
          expect(getWeeklyPlanningStableV5RuntimeSession(conversationId)!.graph.revision).toBe(2);
        } else {
          // Neither empty nor previously populated runtime binding limits compatibility output.
          expect(failure).toBeUndefined();
          expect(committed).toHaveBeenCalledTimes(2);
          expect(committed).toHaveBeenLastCalledWith(expect.objectContaining({
            pending: expect.objectContaining({ requestId: oversized.input.traceRequestId }),
          }));
          expect(submission?.accepted).toBe(true);
          expect(after.previewCandidates).toHaveLength(501);
          expect(getWeeklyPlanningStableV5RuntimeSession(conversationId)!.graph.revision).toBe(initialStable ? 1 : 0);
        }
        expect(hasWeeklyPlanningStableV5StagedGraph({ conversationId, requestId: oversized.input.traceRequestId })).toBe(false);
        expect(save).not.toHaveBeenCalled();
      } finally {
        prepare.mockRestore();
        committed.mockRestore();
        await harness.unmount();
      }
    },
  );

  it.each([
    { retained: 499, incoming: 1, replace: false, allowed: true },
    { retained: 500, incoming: 1, replace: false, allowed: false },
    { retained: 500, incoming: 500, replace: true, allowed: true },
    { retained: 500, incoming: 501, replace: true, allowed: false },
    { retained: 500, incoming: 1, replace: false, allowed: false, compatibilityIncoming: true },
    { retained: 500, incoming: 501, replace: true, allowed: true, compatibilityIncoming: true },
    { retained: 500, incoming: 1, replace: false, allowed: true, approvedHistory: true },
  ])('admits exact Stable draft projection $retained + $incoming replace=$replace', async row => {
    const save = vi.fn(async (draft: PlanDraft) => persistedPlan(draft));
    const harness = await renderApplicationHarness({ saveWeeklyApprovedPlan: save });
    try {
      const conversationId = harness.ref.current!.exportConversationSnapshot({ includeEmpty: true })!.conversationId;
      const blocks = (count: number, prefix: string) => createWeeklyDraftBlocksFromPreviewCandidates({
        userId: 'user-1', createdAt: '2026-07-14T00:00:00Z',
        candidates: Array.from({ length: count }, (_, index) => ({
          stableKey: `${prefix}-${index}`, date: '2026-07-14', startTime: '09:00', endTime: '09:05',
          durationMinutes: 5, estimatedMinutes: 5, title: '数学', field: '数学', year: 0,
          source: 'weekly_exam_prep' as const, approvalStatus: 'unapproved' as const,
          workItemKey: `work-${index}`, stableV5Metadata: { runtime: 'stable_v5' as const,
            conversationId, graphRevision: 0, taskId: 'count-fixture-task',
            sourceFactRefs: ['count-fixture-task'], planType: 'study' as const },
        })),
      });
      await act(async () => { harness.ref.current!.createDraftBlocks(blocks(row.retained, 'old')); });
      const before = harness.ref.current!.state;
      const incoming = 'compatibilityIncoming' in row && row.compatibilityIncoming
        ? Array.from({ length: row.incoming }, (_, index) => createWeeklyPlanningTestDraftBlock({ id: `compatibility-${index}` }))
        : blocks(row.incoming, 'incoming').map(block => 'approvedHistory' in row && row.approvedHistory
          ? { ...block, status: 'approved' as const } : block);
      let failure: unknown;
      await act(async () => {
        try { harness.ref.current!.createDraftBlocks(incoming, { replace: row.replace }); }
        catch (error) { failure = error; }
      });
      if (row.allowed) {
        expect(failure).toBeUndefined();
        expect(harness.ref.current!.state.revision).toBe(before.revision + 1);
        expect(harness.ref.current!.state.draftBlocks).toEqual(row.replace ? incoming : [...before.draftBlocks, ...incoming]);
        expect(harness.ref.current!.pendingDraftBlocks).toHaveLength(
          'approvedHistory' in row ? row.retained : row.replace ? row.incoming : row.retained + row.incoming);
        if ('approvedHistory' in row) {
          const checkpoint = loadWeeklyPlanningStableV5PersistedSession({ ownerId: 'user-1', weekStartDate: before.weekStartDate });
          expect(checkpoint?.planningState.draftBlocks).toHaveLength(500);
          expect(checkpoint?.planningState.draftBlocks.every(block => block.status === 'draft')).toBe(true);
        }
      } else {
        expect(failure).toBeInstanceOf(WeeklyPlanningStableCollectionLimitError);
        expect((failure as WeeklyPlanningStableCollectionLimitError).detail).toEqual({
          collection: 'draftBlocks', actualCount: 501, limit: 500,
        });
        expect(harness.ref.current!.state).toBe(before);
        expect(harness.ref.current!.state.draftBlocks).toBe(before.draftBlocks);
        expect(harness.ref.current!.state.previewCandidates).toBe(before.previewCandidates);
      }
      expect(save).not.toHaveBeenCalled();
    } finally { await harness.unmount(); }
  });

  it('keeps empty append as a no-op but clears an explicit empty replacement atomically', async () => {
    const save = vi.fn(async (draft: PlanDraft) => persistedPlan(draft));
    const harness = await renderApplicationHarness({ saveWeeklyApprovedPlan: save });
    try {
      await act(async () => { harness.ref.current!.createDraftBlocks([createWeeklyPlanningTestDraftBlock({ id: 'old' })]); });
      const before = harness.ref.current!.state;
      await act(async () => { harness.ref.current!.createDraftBlocks([]); });
      expect(harness.ref.current!.state).toBe(before);
      await act(async () => { harness.ref.current!.createDraftBlocks([], { replace: true }); });
      const cleared = harness.ref.current!.state;
      expect(cleared.revision).toBe(before.revision + 1);
      expect(cleared.draftBlocks).toEqual([]);
      expect(cleared.previewCandidates).toEqual([]);
      expect(cleared.mode).toBe('idle');
      await act(async () => { harness.ref.current!.createDraftBlocks([], { replace: true }); });
      expect(harness.ref.current!.state).toBe(cleared);
      await act(async () => { await harness.ref.current!.approveDraftBlocks(); });
      expect(save).not.toHaveBeenCalled();
    } finally { await harness.unmount(); }
  });

  it.each(['stable-without-runtime', 'stable-without-runtime-small', 'compatibility'] as const)(
    'admits an existing approval before repository writes: %s', async source => {
      const stable = source !== 'compatibility';
      const count = source === 'stable-without-runtime-small' ? 1 : 501;
      const previewMetadata: WeeklyPreviewMetadata = {
        previewId: 'restored-count-preview', stateRevision: 0, assumptionDependencies: [],
        approvalEligibility: 'eligible', stale: false, authorizedUserId: 'user-1',
        ...(stable ? { conversationId: 'lost-stable-conversation' } : {}),
      };
      const blocks = Array.from({ length: count }, (_, index) => {
        const block = createWeeklyPlanningTestDraftBlock({ id: `restored-${index}`, previewMetadata });
        return stable ? { ...block, behaviorMetadata: { ...block.behaviorMetadata!,
          compatibility: { workItemSemantic: 'generic_semantic_task' as const,
            schedulerInputSource: 'stable_v5_generic_scheduler_input' as const, candidateSource: 'stable_v5' as const },
        } } : block;
      });
      const restored = { ...createInitialPlanningState('2026-07-13'), draftBlocks: blocks };
      // Compatibility is genuinely restored through its codec; Stable metadata is not
      // a compatibility wire shape and must not be smuggled through that reader.
      if (!stable) expect(compatibilityStorage.saveWeeklyPlanningState('user-1', restored)).toBe(true);
      let savedCount = 0;
      const save = vi.fn(async (draft: PlanDraft) => persistedPlan(draft, `saved-${++savedCount}`));
      const complete = vi.fn(async () => {});
      const harness = await renderApplicationHarness({ saveWeeklyApprovedPlan: save, completeWeeklyApprovalOperation: complete });
      try {
        if (stable) {
          const conversationId = harness.ref.current!.exportConversationSnapshot({ includeEmpty: true })!.conversationId;
          const boundBlocks = blocks.map(block => ({ ...block, behaviorMetadata: { ...block.behaviorMetadata!,
            conversationId, previewMetadata: { ...block.behaviorMetadata!.previewMetadata!, conversationId },
          } }));
          const acceptedCount = Math.min(count, 500);
          await act(async () => { harness.ref.current!.createDraftBlocks(boundBlocks.slice(0, acceptedCount)); });
          const checkpoint = loadWeeklyPlanningStableV5PersistedSession({
            ownerId: 'user-1', weekStartDate: harness.ref.current!.state.weekStartDate,
          });
          expect(checkpoint).not.toBeNull();
          expect(checkpoint?.conversationId).toBe(conversationId);
          expect(checkpoint?.planningState.draftBlocks).toHaveLength(acceptedCount);
          if (count === 501) {
            // Explicit in-memory fault injection models an already-visible oversize set
            // from a pre-admission caller. No claim that a valid Stable codec can load501.
            // The real hook/ref and begin_approval/repository owners remain in use.
            harness.ref.current!.state.draftBlocks = [...harness.ref.current!.state.draftBlocks, boundBlocks[500]];
          }
          resetWeeklyPlanningStableV5RuntimeSessionsForTest();
          expect(getWeeklyPlanningStableV5RuntimeSession(conversationId)).toBeNull();
        }
        const before = harness.ref.current!.state;
        expect(before.draftBlocks).toHaveLength(count);
        let failure: unknown;
        await act(async () => {
          try { await harness.ref.current!.approveDraftBlocks(); }
          catch (error) { failure = error; }
        });
        if (stable) {
          if (count === 501) {
            expect(failure).toBeInstanceOf(WeeklyPlanningStableCollectionLimitError);
            expect((failure as WeeklyPlanningStableCollectionLimitError).detail.collection).toBe('draftBlocks');
            expect(harness.ref.current!.state).toBe(before);
            expect(loadWeeklyPlanningStableV5PersistedSession({ ownerId: 'user-1',
              weekStartDate: before.weekStartDate })?.planningState.draftBlocks).toHaveLength(500);
          } else {
            // Passing count admission cannot grant missing/foreign-session approval authority.
            expect(failure).toBeInstanceOf(Error);
            expect(failure).not.toBeInstanceOf(WeeklyPlanningStableCollectionLimitError);
            expect((failure as Error).message).toContain('現在の条件と一致しない');
            expect(harness.ref.current!.state.revision).toBe(before.revision + 2);
            expect(harness.ref.current!.state.draftBlocks).toBe(before.draftBlocks);
          }
          expect(harness.ref.current!.state.pendingApproval).toBeUndefined();
          expect(save).not.toHaveBeenCalled();
          expect(complete).not.toHaveBeenCalled();
        } else {
          expect(failure).toBeUndefined();
          expect(save).toHaveBeenCalledTimes(501);
          expect(complete).toHaveBeenCalledTimes(1);
          expect(harness.ref.current!.pendingDraftBlocks).toEqual([]);
          await act(async () => {
            harness.ref.current!.createDraftBlocks(blocks);
            await harness.ref.current!.approveDraftBlocks();
          });
          expect(save).toHaveBeenCalledTimes(501); // Same operation remains idempotent.
          expect(harness.ref.current!.pendingDraftBlocks).toEqual([]);
        }
      } finally { await harness.unmount(); }
    },
  );

  it.each(['single', 'stable-retained', 'compatibility-retained', 'compatibility-retained-index-read-failure', 'compatibility-retained-initial-index-read-failure'] as const)('does not revive a deleted chat after opaque-format recovery (%s)', async collision => {
    const ownerId = 'user-1';
    const weekStartDate = '2026-07-13';
    const stableKey = getWeeklyPlanningStableV5SessionStorageKeyForTest(ownerId, weekStartDate);
    const retainedKey = `studyplanner.weeklyPlanningUnreadable.v1.${ownerId}.${weekStartDate}`;
    const compatibilityKey = `studyplanner.weeklyPlanning.${ownerId}.${weekStartDate}`;
    const planningState = { ...createInitialPlanningState(weekStartDate), messages: [{
      id: 'deleted-conversation:turn:1:user', role: 'user' as const,
      content: 'Deleted opaque conversation', createdAt: '2026-07-14T00:00:00Z',
    }] };
    expect(saveWeeklyPlanningStableV5PersistedSession({ ownerId, weekStartDate,
      conversationId: 'deleted-conversation', graph: { ...createEmptyWeeklyPlanningFactGraphV5(), revision: 2, tasks: [{
        id: 'deleted-task', category: 'study', title: 'Deleted task must not reach a new turn', createdRevision: 1,
        source: { conversationId: 'deleted-conversation', turnId: 'deleted-conversation:turn:1',
          semanticLocalId: 'deleted-task-local', sourceText: 'Deleted opaque conversation', origin: 'user' },
      }], factLifecycles: [{ factId: 'deleted-task', status: 'active', createdRevision: 1,
        terminalRevision: null, supersededByFactId: null }] }, planningState })).toBe(true);
    const future = JSON.parse(storageHarness.values.get(stableKey)!);
    future.planningState.futureStateField = 'future-stable-data';
    const raw = JSON.stringify(future);
    storageHarness.values.set(stableKey, raw);
    if (collision !== 'single') storageHarness.values.set(compatibilityKey, JSON.stringify({ version: 2,
      state: { ...planningState, futureStateField: 'future-compatibility-data' } }));
    storageHarness.values.set(`studyplanner.weeklyPlanning.activeSession.${ownerId}`, JSON.stringify({
      version: 1, ownerId, weekStartDate, conversationId: 'deleted-conversation',
    }));
    if (collision.startsWith('compatibility-retained')) compatibilityStorage.loadWeeklyPlanningState(ownerId, weekStartDate);
    const expectedRetainedRaw = collision.startsWith('compatibility-retained')
      ? JSON.parse(storageHarness.values.get(retainedKey)!).raw : raw;
    const save = vi.fn(async (_draft: PlanDraft): Promise<Plan> => { throw new Error('unexpected plan write'); });
    const first = await renderApplicationHarness({ saveWeeklyApprovedPlan: save });
    await act(async () => { expect(first.ref.current!.chat.initialize().status).toBe('saved'); });
    const deletedId = first.ref.current!.chat.index.activeChatId;
    await act(async () => { expect(first.ref.current!.chat.remove(deletedId).status).toBe('saved'); });
    expect(first.ref.current!.state.messages).toEqual([]);
    const retained = storageHarness.values.get(retainedKey);
    expect(JSON.parse(retained!).raw).toBe(expectedRetainedRaw);
    await first.unmount();
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();

    const currentStableParser = sessionCodec.parseWeeklyPlanningStableV5PersistedSession;
    const stableSpy = vi.spyOn(sessionCodec, 'parseWeeklyPlanningStableV5PersistedSession').mockImplementation(params => {
      const parsed = JSON.parse(params.raw);
      delete parsed.planningState.futureStateField;
      return currentStableParser({ ...params, raw: JSON.stringify(parsed) });
    });
    const currentCompatibilityParser = compatibilityStorage.parseWeeklyPlanningCompatibilitySnapshot;
    const compatibilitySpy = vi.spyOn(compatibilityStorage, 'parseWeeklyPlanningCompatibilitySnapshot').mockImplementation((value, owner, week) => {
      const parsed = JSON.parse(value);
      const savedState = parsed.version === 3 ? parsed.payload?.state : parsed.state;
      if (savedState) delete savedState.futureStateField;
      return currentCompatibilityParser(JSON.stringify(parsed), owner, week);
    });
    let indexReadFaultObserved = false;
    if (collision.endsWith('index-read-failure')) {
      const originalRead = storageHarness.storage.getItem.bind(storageHarness.storage);
      let indexReads = 0;
      storageHarness.storage.getItem = key => {
        if (key === `studyplanner.weeklyPlanning.activeSession.${ownerId}` && ++indexReads === (collision.includes('initial-index') ? 1 : 2)) {
          indexReadFaultObserved = true;
          throw new Error('selection unavailable during the selected storage read');
        }
        return originalRead(key);
      };
    }
    let second: RenderedApplicationHarness | undefined;
    try {
      second = await renderApplicationHarness({ saveWeeklyApprovedPlan: save });
      await act(async () => { expect(second!.ref.current!.chat.initialize().status).toBe('saved'); });
      expect(indexReadFaultObserved).toBe(collision.endsWith('index-read-failure'));
      expect(second.ref.current!.state.messages).toEqual([]);
      expect(second.ref.current!.exportConversationSnapshot({ includeEmpty: true })?.graph.revision).toBe(0);
      expect(second.ref.current!.chat.index.chats.some(chat => chat.id === deletedId)).toBe(false);
      expect(storageHarness.values.get(retainedKey)).toBe(retained);
      expect(save).not.toHaveBeenCalled();
      expect(executeWeeklyPlanningTurnMock).not.toHaveBeenCalled();
      executeWeeklyPlanningTurnMock.mockImplementation(async (input: WeeklyPlanningTurnExecutionInput) => {
        const runtime = getWeeklyPlanningStableV5RuntimeSession(input.conversationId!);
        expect(runtime?.graph.tasks).toEqual([]);
        expect(runtime?.graph.revision).toBe(0);
        return turnResult(input.userText);
      });
      await act(async () => {
        expect((await second!.ref.current!.submitTurn('Start fresh after deletion')).accepted).toBe(true);
      });
      expect(executeWeeklyPlanningTurnMock).toHaveBeenCalledTimes(1);
      expect(save).not.toHaveBeenCalled();
      expect(storageHarness.values.get(retainedKey)).toBe(retained);
    } finally {
      await second?.unmount();
      stableSpy.mockRestore();
      compatibilitySpy.mockRestore();
    }
  });

  it.each([1, 2, 'persistent'] as const)('preserves a normal selected checkpoint when index read %s fails and later reads recover', async failureRead => {
    const first = await renderApplicationHarness();
    await act(async () => { expect(first.ref.current!.chat.initialize().status).toBe('saved'); });
    await act(async () => {
      first.ref.current!.appendMessage({ id: 'normal-selected:turn:1:user', role: 'user',
        content: 'Normal selected conversation must survive a read fault', createdAt: '2026-07-14T00:00:00Z' });
    });
    const saved = first.ref.current!.exportConversationSnapshot({ includeEmpty: true })!;
    saved.graph.revision = 2;
    await act(async () => { expect(first.ref.current!.loadConversationSnapshot(saved)).toBe(true); });
    const expectedMessages = first.ref.current!.state.messages;
    const expectedGraph = first.ref.current!.exportConversationSnapshot({ includeEmpty: true })?.graph;
    const stableKey = getWeeklyPlanningStableV5SessionStorageKeyForTest('user-1', '2026-07-13');
    const expectedRaw = storageHarness.values.get(stableKey);
    expect(expectedRaw).toBeDefined();
    await first.unmount();
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    const originalRead = storageHarness.storage.getItem.bind(storageHarness.storage);
    let faultObserved = false;
    let indexReads = 0;
    storageHarness.storage.getItem = key => {
      if (key === 'studyplanner.weeklyPlanning.activeSession.user-1'
        && (failureRead === 'persistent' || ++indexReads === failureRead)) {
        faultObserved = true;
        throw new Error('initial selection temporarily unavailable');
      }
      return originalRead(key);
    };
    const second = await renderApplicationHarness();
    try {
      expect(faultObserved).toBe(true);
      if (failureRead !== 2) expect(storageHarness.values.get(stableKey)).toBe(expectedRaw);
      else expect(JSON.parse(storageHarness.values.get(stableKey)!).graph).toEqual(expectedGraph);
      if (failureRead === 'persistent') {
        await act(async () => { expect(second.ref.current!.chat.initialize()).toEqual({ status: 'blocked', reason: 'initialization-unavailable' }); });
        expect(second.ref.current!.chat.requiresInitialization).toBe(true);
        expect(second.ref.current!.chat.canStartWithoutRestoring).toBe(false);
        expect(second.ref.current!.exportConversationSnapshot({ includeEmpty: true })).toBeNull();
        await act(async () => { expect((await second.ref.current!.submitTurn('Must stay blocked')).accepted).toBe(false); });
        expect(executeWeeklyPlanningTurnMock).not.toHaveBeenCalled();
        expect(storageHarness.values.get(stableKey)).toBe(expectedRaw);
        storageHarness.storage.getItem = originalRead;
        await act(async () => { expect(second.ref.current!.chat.retry().status).toBe('saved'); });
      } else {
        await act(async () => { expect(second.ref.current!.chat.initialize().status).toBe('saved'); });
      }
      expect(second.ref.current!.state.messages).toEqual(expectedMessages);
      expect(second.ref.current!.exportConversationSnapshot({ includeEmpty: true })?.graph).toEqual(expectedGraph);
    } finally { await second.unmount(); }
  });

  it.each([
    ['stable', false], ['stable', true], ['compatibility', false], ['compatibility', true],
  ] as const)('keeps selected %s checkpoint read failures unavailable until retry (persistent=%s)', async (format, persistent) => {
    const ownerId = 'user-1';
    const weekStartDate = '2026-07-13';
    const planningState = { ...createInitialPlanningState(weekStartDate), messages: [{
      id: 'selected-body:turn:1:user', role: 'user' as const, content: 'Checkpoint body must survive failed reads', createdAt: '2026-07-14T00:00:00Z',
    }] };
    const key = format === 'stable' ? getWeeklyPlanningStableV5SessionStorageKeyForTest(ownerId, weekStartDate)
      : `studyplanner.weeklyPlanning.${ownerId}.${weekStartDate}`;
    if (format === 'stable') expect(saveWeeklyPlanningStableV5PersistedSession({ ownerId, weekStartDate,
      conversationId: 'selected-body', graph: { ...createEmptyWeeklyPlanningFactGraphV5(), revision: 2 }, planningState })).toBe(true);
    else storageHarness.values.set(key, JSON.stringify({ version: 3, ownerId, payload: { version: 2, state: planningState } }));
    const indexKey = `studyplanner.weeklyPlanning.activeSession.${ownerId}`;
    storageHarness.values.set(indexKey, JSON.stringify({ version: 1, ownerId, weekStartDate,
      conversationId: format === 'stable' ? 'selected-body' : null }));
    const originalRaw = storageHarness.values.get(key);
    const originalIndex = storageHarness.values.get(indexKey);
    const originalRead = storageHarness.storage.getItem.bind(storageHarness.storage);
    let failedReads = 0;
    storageHarness.storage.getItem = storedKey => {
      if (storedKey === key && (persistent || failedReads < 2)) { failedReads += 1; throw new Error('selected checkpoint unavailable'); }
      return originalRead(storedKey);
    };
    const app = await renderApplicationHarness();
    try {
      expect(failedReads).toBeGreaterThan(0);
      expect(storageHarness.values.get(key)).toBe(originalRaw);
      expect(storageHarness.values.get(indexKey)).toBe(originalIndex);
      expect(app.ref.current!.exportConversationSnapshot({ includeEmpty: true })).toBeNull();
      await act(async () => { expect(app.ref.current!.chat.initialize()).toEqual({ status: 'blocked', reason: 'initialization-unavailable' }); });
      expect(app.ref.current!.chat.canStartWithoutRestoring).toBe(false);
      await act(async () => { expect((await app.ref.current!.submitTurn('Do not overwrite unavailable work')).accepted).toBe(false); });
      expect(storageHarness.values.get(key)).toBe(originalRaw);
      expect(storageHarness.values.get(indexKey)).toBe(originalIndex);
      expect(executeWeeklyPlanningTurnMock).not.toHaveBeenCalled();
      storageHarness.storage.getItem = originalRead;
      await act(async () => { expect(app.ref.current!.chat.retry().status).toBe('saved'); });
      expect(app.ref.current!.state.messages).toEqual(planningState.messages);
      expect(app.ref.current!.exportConversationSnapshot({ includeEmpty: true })?.graph.revision).toBe(format === 'stable' ? 2 : 0);
    } finally { await app.unmount(); }
  });

  it('does not reuse unavailable state readiness or a retained retry across A to B to A owners', async () => {
    const ownerId = 'user-1';
    const weekStartDate = '2026-07-13';
    const planningState = { ...createInitialPlanningState(weekStartDate), messages: [{
      id: 'owner-a:turn:1:user', role: 'user' as const, content: 'Owner A saved work', createdAt: '2026-07-14T00:00:00Z',
    }] };
    expect(saveWeeklyPlanningStableV5PersistedSession({ ownerId, weekStartDate, conversationId: 'owner-a',
      graph: { ...createEmptyWeeklyPlanningFactGraphV5(), revision: 2 }, planningState })).toBe(true);
    const indexKey = `studyplanner.weeklyPlanning.activeSession.${ownerId}`;
    const stableKey = getWeeklyPlanningStableV5SessionStorageKeyForTest(ownerId, weekStartDate);
    storageHarness.values.set(indexKey, JSON.stringify({ version: 1, ownerId, weekStartDate, conversationId: 'owner-a' }));
    const originalRaw = storageHarness.values.get(stableKey);
    const originalIndex = storageHarness.values.get(indexKey);
    const originalRead = storageHarness.storage.getItem.bind(storageHarness.storage);
    storageHarness.storage.getItem = key => { if (key === indexKey) throw new Error('owner A unavailable'); return originalRead(key); };
    const app = await renderApplicationHarness();
    try {
      const oldChat = app.ref.current!.chat;
      await act(async () => { expect(oldChat.initialize().status).toBe('blocked'); });
      await app.update({ userId: 'user-2' });
      await act(async () => { expect(app.ref.current!.chat.initialize().status).toBe('saved'); });
      const ownerBSnapshot = app.ref.current!.exportConversationSnapshot({ includeEmpty: true });
      expect(ownerBSnapshot?.ownerId).toBe('user-2');
      expect(ownerBSnapshot?.graph.revision).toBe(0);
      await act(async () => { expect(app.ref.current!.chat.checkpoint().status).toBe('saved'); });
      expect(oldChat.retry()).toEqual({ status: 'blocked', reason: 'owner-changed' });
      await app.update({ userId: ownerId });
      expect(app.ref.current!.exportConversationSnapshot({ includeEmpty: true })).toBeNull();
      expect(oldChat.retry()).toEqual({ status: 'blocked', reason: 'owner-changed' });
      expect(storageHarness.values.get(stableKey)).toBe(originalRaw);
      expect(storageHarness.values.get(indexKey)).toBe(originalIndex);
      storageHarness.storage.getItem = originalRead;
      await act(async () => { expect(app.ref.current!.chat.retry().status).toBe('saved'); });
      expect(app.ref.current!.state.messages).toEqual(planningState.messages);
      const snapshot = app.ref.current!.exportConversationSnapshot({ includeEmpty: true });
      expect(snapshot?.ownerId).toBe(ownerId);
      expect(snapshot?.conversationId).toBe('owner-a');
      expect(snapshot?.graph.revision).toBe(2);
      expect(executeWeeklyPlanningTurnMock).not.toHaveBeenCalled();
    } finally { await app.unmount(); }
  });

  it('restores a valid weekly checkpoint saved before the blank chat metadata is updated', async () => {
    const first = await renderApplicationHarness();
    await act(async () => { expect(first.ref.current!.chat.initialize().status).toBe('saved'); });
    await act(async () => {
      first.ref.current!.appendMessage({ id: 'new-turn:turn:1:user', role: 'user',
        content: 'New work saved before chat metadata', createdAt: '2026-07-14T00:00:00Z' });
    });
    expect(first.ref.current!.chat.index.chats.find(chat => chat.id === first.ref.current!.chat.index.activeChatId)?.weekStartDate).toBeNull();
    const messages = first.ref.current!.state.messages;
    await first.unmount();
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    const second = await renderApplicationHarness();
    try {
      await act(async () => { expect(second.ref.current!.chat.initialize().status).toBe('saved'); });
      expect(second.ref.current!.state.messages).toEqual(messages);
    } finally { await second.unmount(); }
  });

  it.each([false, true])('rejects retained snapshot admission after pending (recovered=%s)', async (recovered) => {
    const authority = new PlannerDataReadAuthority();
    const load = authority.begin('user-1', '2026-07-14T00:00:00Z');
    authority.succeed(load.token, '2026-07-14T00:01:00Z');
    const oldLease = authority.captureProjectionLease()!;
    const oldActuals: Actual[] = [{ id: 'actual-old', userId: 'user-1', planId: null,
      occurrenceDate: '2026-07-14', actualStartTime: '10:00', actualEndTime: '10:30',
      subject: '数学', note: '', updatedAt: '2026-07-14T01:00:00Z' }];
    const oldMaterials: StudyMaterial[] = [{ id: 'material-old', userId: 'user-1', name: '旧教材',
      subjectId: 'math', subjectName: '数学', createdAt: '2026-07-14T00:00:00Z', updatedAt: '2026-07-14T00:00:00Z' }];
    const newActuals = [{ ...oldActuals[0], id: 'actual-current' }];
    const newMaterials = [{ ...oldMaterials[0], id: 'material-current' }];
    const admission = vi.spyOn(turnApplication, 'submitWeeklyPlanningApplicationTurn');
    executeWeeklyPlanningTurnMock.mockImplementation(async (input: WeeklyPlanningTurnExecutionInput) => turnResult(input.userText));
    const harness = await renderApplicationHarness({ actuals: oldActuals, studyMaterials: oldMaterials,
      plannerDataAvailability: authority.read(),
      isPlannerDataSnapshotCurrent: () => authority.isProjectionUsable(oldLease) });
    const retainedSubmit = harness.ref.current!.submitTurn;
    expect(harness.ref.current!.plannerDataReady).toBe(true);
    authority.requireActualMaterialReconciliation(oldLease, '2026-07-14T00:02:00Z');
    await harness.update({ plannerDataAvailability: authority.read() });
    expect(harness.ref.current!.plannerDataReady).toBe(false);
    if (recovered) {
      const ticket = authority.beginReconciliation(oldLease, '2026-07-14T00:03:00Z')!;
      authority.acceptReconciliation(ticket, '2026-07-14T00:04:00Z');
      const currentLease = authority.captureProjectionLease()!;
      await harness.update({ actuals: newActuals, studyMaterials: newMaterials,
        plannerDataAvailability: authority.read(),
        isPlannerDataSnapshotCurrent: () => authority.isProjectionUsable(currentLease) });
      expect(harness.ref.current!.plannerDataReady).toBe(true);
    }
    const before = harness.ref.current!.state;
    const savedBefore = new Map(storageHarness.values);
    await act(async () => {
      expect(await retainedSubmit('画像の予定')).toEqual({ accepted: false, draftCandidates: [], rejectionReason: 'planner-data-changed' });
    });
    expect(admission).not.toHaveBeenCalled();
    expect(executeWeeklyPlanningTurnMock).not.toHaveBeenCalled();
    expect(harness.ref.current!.state).toBe(before);
    expect(storageHarness.values).toEqual(savedBefore);
    if (recovered) {
      await act(async () => { expect((await harness.ref.current!.submitTurn('現在の予定')).accepted).toBe(true); });
      expect(admission).toHaveBeenCalledTimes(1);
      expect(executeWeeklyPlanningTurnMock).toHaveBeenCalledTimes(1);
      expect(executeWeeklyPlanningTurnMock.mock.calls[0][0].actuals).toBe(newActuals);
      expect(executeWeeklyPlanningTurnMock.mock.calls[0][0].studyMaterials).toBe(newMaterials);
    }
    admission.mockRestore();
    await harness.unmount();
  });

  it('rejects a revoked bound lease before code loading without requiring a render', async () => {
    const authority = new PlannerDataReadAuthority();
    const load = authority.begin('user-1', '2026-07-14T00:00:00Z');
    authority.succeed(load.token, '2026-07-14T00:01:00Z');
    const lease = authority.captureProjectionLease()!;
    const harness = await renderApplicationHarness({ plannerDataAvailability: authority.read(),
      isPlannerDataSnapshotCurrent: () => authority.isProjectionUsable(lease) });
    const retained = harness.ref.current!;
    authority.requireActualMaterialReconciliation(lease, '2026-07-14T00:02:00Z');
    await expect(retained.prepareTurn()).resolves.toEqual({ ready: false, reason: 'planner-data-changed' });
    await expect(retained.submitTurn('old arrays')).resolves.toEqual({ accepted: false,
      draftCandidates: [], rejectionReason: 'planner-data-changed' });
    expect(loadRuntimeMock).not.toHaveBeenCalled();
    expect(executeWeeklyPlanningTurnMock).not.toHaveBeenCalled();
    expect(harness.ref.current!.state.messages).toEqual([]);
    await harness.unmount();
  });

  it.each([false, true])('revokes preparation and admission across a runtime await even when latest data is ready (recovered=%s)', async (recovered) => {
    const authority = new PlannerDataReadAuthority();
    const load = authority.begin('user-1', '2026-07-14T00:00:00Z');
    authority.succeed(load.token, '2026-07-14T00:01:00Z');
    const lease = authority.captureProjectionLease()!;
    const harness = await renderApplicationHarness({ plannerDataAvailability: authority.read(),
      isPlannerDataSnapshotCurrent: () => authority.isProjectionUsable(lease) });
    const retained = harness.ref.current!;
    const pending = createDeferred<object>();
    loadRuntimeMock.mockReturnValue(pending.promise);
    const preparation = retained.prepareTurn();
    const submission = retained.submitTurn('old arrays');
    expect(loadRuntimeMock).toHaveBeenCalledTimes(2);
    authority.requireActualMaterialReconciliation(lease, '2026-07-14T00:02:00Z');
    // No pending render is needed to revoke the original callbacks.
    if (recovered) {
      const ticket = authority.beginReconciliation(lease, '2026-07-14T00:03:00Z')!;
      authority.acceptReconciliation(ticket, '2026-07-14T00:04:00Z');
      const currentLease = authority.captureProjectionLease()!;
      await harness.update({ plannerDataAvailability: authority.read(),
        isPlannerDataSnapshotCurrent: () => authority.isProjectionUsable(currentLease) });
      expect(harness.ref.current!.plannerDataReady).toBe(true);
    }
    const before = harness.ref.current!.state;
    const savedBefore = new Map(storageHarness.values);
    await act(async () => {
      pending.resolve({});
      await expect(preparation).resolves.toEqual({ ready: false, reason: 'planner-data-changed' });
      await expect(submission).resolves.toEqual({ accepted: false, draftCandidates: [], rejectionReason: 'planner-data-changed' });
    });
    expect(executeWeeklyPlanningTurnMock).not.toHaveBeenCalled();
    expect(harness.ref.current!.state).toBe(before);
    expect(storageHarness.values).toEqual(savedBefore);
    if (recovered) await expect(harness.ref.current!.prepareTurn()).resolves.toEqual({ ready: true });
    await harness.unmount();
  });

  it('rechecks the bound lease at admission after successful preparation has resolved', async () => {
    const authority = new PlannerDataReadAuthority();
    const load = authority.begin('user-1', '2026-07-14T00:00:00Z');
    authority.succeed(load.token, '2026-07-14T00:01:00Z');
    const lease = authority.captureProjectionLease()!;
    let revokeAfterCheck = false;
    const isPlannerDataSnapshotCurrent = () => {
      const current = authority.isProjectionUsable(lease);
      if (revokeAfterCheck && current) {
        revokeAfterCheck = false;
        // The preflight check succeeds, then its caller resumes against a revoked lease.
        queueMicrotask(() => authority.requireActualMaterialReconciliation(lease, '2026-07-14T00:02:00Z'));
      }
      return current;
    };
    const harness = await renderApplicationHarness({ plannerDataAvailability: authority.read(), isPlannerDataSnapshotCurrent });
    loadRuntimeMock.mockImplementation(async () => { revokeAfterCheck = true; return {}; });
    await act(async () => {
      await expect(harness.ref.current!.submitTurn('revoked before admission')).resolves.toEqual({
        accepted: false, draftCandidates: [], rejectionReason: 'planner-data-changed',
      });
    });
    expect(loadRuntimeMock).toHaveBeenCalledTimes(1);
    expect(executeWeeklyPlanningTurnMock).not.toHaveBeenCalled();
    expect(harness.ref.current!.state.messages).toEqual([]);
    await harness.unmount();
  });

  it('keeps committed preflight valid across a harmless rerender with the same request inputs and bound lease', async () => {
    const authority = new PlannerDataReadAuthority();
    const load = authority.begin('user-1', '2026-07-14T00:00:00Z');
    authority.succeed(load.token, '2026-07-14T00:01:00Z');
    const lease = authority.captureProjectionLease()!;
    const isPlannerDataSnapshotCurrent = () => authority.isProjectionUsable(lease);
    const harness = await renderApplicationHarness({ plannerDataAvailability: authority.read(), isPlannerDataSnapshotCurrent });
    const retained = harness.ref.current!;
    const pending = createDeferred<object>();
    loadRuntimeMock.mockReturnValue(pending.promise);
    executeWeeklyPlanningTurnMock.mockImplementation(async (input: WeeklyPlanningTurnExecutionInput) => turnResult(input.userText));
    const preparation = retained.prepareTurn();
    const submission = retained.submitTurn('same committed arrays');
    await harness.update({ saveWeeklyApprovedPlan: async (draft) => persistedPlan(draft, 'new-save-handler') });
    expect(harness.ref.current).not.toBe(retained);
    await act(async () => {
      pending.resolve({});
      await expect(preparation).resolves.toEqual({ ready: true });
      expect((await submission).accepted).toBe(true);
    });
    expect(executeWeeklyPlanningTurnMock).toHaveBeenCalledTimes(1);
    await harness.unmount();
  });

  it('keeps the committed request identity fence even when a retained lease remains usable', async () => {
    const harness = await renderApplicationHarness();
    const retained = harness.ref.current!;
    const pending = createDeferred<object>();
    loadRuntimeMock.mockReturnValue(pending.promise);
    const preparation = retained.prepareTurn();
    const submission = retained.submitTurn('old request context');
    await harness.update({ plans: [] });
    await act(async () => {
      pending.resolve({});
      await expect(preparation).resolves.toEqual({ ready: false, reason: 'request-changed' });
      await expect(submission).resolves.toEqual({ accepted: false, draftCandidates: [] });
    });
    expect(harness.ref.current!.plannerDataReady).toBe(true);
    expect(executeWeeklyPlanningTurnMock).not.toHaveBeenCalled();
    expect(harness.ref.current!.state.messages).toEqual([]);
    await harness.unmount();
  });

  it('rejects a second submission while the first turn is active', async () => {
    const pendingTurn = createDeferred<WeeklyPlanningTurnExecutionResult>();
    executeWeeklyPlanningTurnMock.mockImplementation(() => pendingTurn.promise);
    const harness = await renderApplicationHarness();
    let firstSubmission!: Promise<WeeklyPlanningTurnSubmissionResult>;

    await act(async () => {
      firstSubmission = harness.ref.current!.submitTurn('最初の送信');
      await Promise.resolve();
    });

    let secondResult: WeeklyPlanningTurnSubmissionResult | undefined;
    await act(async () => {
      secondResult = await harness.ref.current!.submitTurn('二重送信');
    });

    expect(secondResult).toEqual({ accepted: false, draftCandidates: [] });
    expect(executeWeeklyPlanningTurnMock).toHaveBeenCalledTimes(1);
    expect(harness.ref.current!.state.pendingTurn).toBeDefined();

    let firstResult: WeeklyPlanningTurnSubmissionResult | undefined;
    await act(async () => {
      pendingTurn.resolve(turnResult('最初の送信'));
      firstResult = await firstSubmission;
    });

    expect(firstResult?.accepted).toBe(true);
    expect(harness.ref.current!.state.pendingTurn).toBeUndefined();
    expect(harness.ref.current!.state.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ]);
    await harness.unmount();
  });

  it('keeps an in-flight turn valid and re-anchors only after a displayed-week change completes', async () => {
    const pendingTurn = createDeferred<WeeklyPlanningTurnExecutionResult>();
    executeWeeklyPlanningTurnMock.mockImplementation(() => pendingTurn.promise);
    const harness = await renderApplicationHarness();
    let submission!: Promise<WeeklyPlanningTurnSubmissionResult>;

    await act(async () => {
      submission = harness.ref.current!.submitTurn('旧表示週からの送信');
      await Promise.resolve();
    });
    expect(harness.ref.current!.state.pendingTurn).toBeDefined();

    await harness.update({ selectedDate: '2026-07-21' });
    expect(harness.ref.current!.state.weekStartDate).toBe('2026-07-13');
    expect(harness.ref.current!.state.pendingTurn).toBeDefined();

    let result: WeeklyPlanningTurnSubmissionResult | undefined;
    await act(async () => {
      pendingTurn.resolve(turnResult('旧表示週からの送信'));
      result = await submission;
    });

    expect(result?.accepted).toBe(true);
    expect(harness.ref.current!.state.weekStartDate).toBe('2026-07-20');
    expect(harness.ref.current!.state.pendingTurn).toBeUndefined();
    expect(harness.ref.current!.state.messages.map((message) => message.content)).toEqual([
      '旧表示週からの送信',
      '確認しました: 旧表示週からの送信',
    ]);
    expect(harness.ref.current!.state.intakeState?.sourceTurns).toEqual([
      '旧表示週からの送信',
    ]);
    await harness.unmount();
  });

  it('rotates conversation identity on user change but preserves it on displayed-week change', async () => {
    const conversationIds: string[] = [];
    const traceRequestIds: string[] = [];
    executeWeeklyPlanningTurnMock.mockImplementation(
      async (input: WeeklyPlanningTurnExecutionInput) => {
        conversationIds.push(input.conversationId);
        traceRequestIds.push(input.traceRequestId);
        return turnResult(input.userText);
      },
    );
    const harness = await renderApplicationHarness();

    await act(async () => {
      await harness.ref.current!.submitTurn('user-1の送信');
    });
    await harness.update({ userId: 'user-2' });
    await act(async () => {
      await harness.ref.current!.submitTurn('user-2の送信');
    });
    await harness.update({ selectedDate: '2026-07-21' });
    await act(async () => {
      await harness.ref.current!.submitTurn('別表示週の送信');
    });

    expect(conversationIds).toHaveLength(3);
    expect(new Set(conversationIds).size).toBe(2);
    expect(conversationIds[0]).not.toBe(conversationIds[1]);
    expect(conversationIds[2]).toBe(conversationIds[1]);
    expect(conversationIds.every((conversationId) => conversationId.startsWith('weekly-conversation-'))).toBe(true);
    expect(traceRequestIds).toEqual([
      `${conversationIds[0]}:request:1`,
      `${conversationIds[1]}:request:1`,
      `${conversationIds[1]}:request:2`,
    ]);
    await harness.unmount();
  });

  it('does not copy user A planning state into user B storage during account switch', async () => {
    const harness = await renderApplicationHarness({ userId: 'user-a' });
    const userABlock = createWeeklyPlanningTestDraftBlock({
      id: 'user-a-draft',
      userId: 'user-a',
    });

    await act(async () => {
      harness.ref.current!.createDraftBlocks([userABlock]);
    });
    const userACompatibilityKey = 'studyplanner.weeklyPlanning.user-a.2026-07-13';
    const userBCompatibilityKey = 'studyplanner.weeklyPlanning.user-b.2026-07-13';
    const userAStableKey = getWeeklyPlanningStableV5SessionStorageKeyForTest(
      'user-a',
      '2026-07-13',
    );
    const userBStableKey = getWeeklyPlanningStableV5SessionStorageKeyForTest(
      'user-b',
      '2026-07-13',
    );
    expect(storageHarness.values.get(userAStableKey)).toContain('user-a-draft');
    expect(storageHarness.values.has(userACompatibilityKey)).toBe(false);

    await harness.update({ userId: 'user-b' });

    expect(harness.ref.current!.pendingDraftBlocks).toEqual([]);
    expect(storageHarness.values.has(userBStableKey)).toBe(false);
    expect(storageHarness.values.has(userBCompatibilityKey)).toBe(false);
    expect(storageHarness.values.get(userAStableKey)).toContain('user-a-draft');

    await harness.update({ userId: 'user-a' });

    expect(harness.ref.current!.pendingDraftBlocks.map((block) => block.id)).toEqual([
      'user-a-draft',
    ]);
    await harness.unmount();
  });

  it('loads the approval ledger after remount and skips an already completed operation', async () => {
    const previewMetadata: WeeklyPreviewMetadata = {
      previewId: 'preview-ledger-round-trip',
      stateRevision: 0,
      assumptionDependencies: [],
      approvalEligibility: 'eligible',
      stale: false,
      authorizedUserId: 'user-1',
    };
    const block = createWeeklyPlanningTestDraftBlock({
      id: 'ledger-block',
      previewMetadata,
    });
    const firstSave = vi.fn(async (draft: PlanDraft) => persistedPlan(draft, 'persisted-ledger-plan'));
    const firstHarness = await renderApplicationHarness({ saveWeeklyApprovedPlan: firstSave });

    await act(async () => {
      firstHarness.ref.current!.createDraftBlocks([block]);
    });
    await act(async () => {
      await firstHarness.ref.current!.approveDraftBlocks();
    });

    expect(firstSave).toHaveBeenCalledTimes(1);
    const storedLedger = storageHarness.values.get(
      'studyplanner-weekly-approval-ledger-v2.user-1',
    );
    expect(storedLedger).toContain('preview-ledger-round-trip');
    expect(storedLedger).toContain('persisted-ledger-plan');
    await firstHarness.unmount();

    const secondSave = vi.fn(async (draft: PlanDraft) => persistedPlan(draft, 'unexpected-plan'));
    const secondHarness = await renderApplicationHarness({ saveWeeklyApprovedPlan: secondSave });
    await act(async () => {
      secondHarness.ref.current!.createDraftBlocks([block]);
    });
    await act(async () => {
      await secondHarness.ref.current!.approveDraftBlocks();
    });

    expect(secondSave).not.toHaveBeenCalled();
    expect(secondHarness.ref.current!.state.draftBlocks).toEqual([]);
    expect(secondHarness.ref.current!.state.lastAssistantMessage).toBe(
      '1件の仮予定を通常予定として保存しました。',
    );
    await secondHarness.unmount();
  });

  it('keeps a restored behavior draft visible but requires recomputation after runtime loss', async () => {
    const previewMetadata: WeeklyPreviewMetadata = {
      previewId: 'preview-restored-round-trip',
      conversationId: 'conversation-restored-round-trip',
      stateRevision: 0,
      assumptionDependencies: [],
      approvalEligibility: 'eligible',
      stale: false,
      authorizedUserId: 'user-1',
    };
    const block = createWeeklyPlanningTestDraftBlock({
      id: 'restored-block',
      previewMetadata,
    });
    publishWeeklyPlanningSessionRuntime({
      conversationId: 'conversation-restored-round-trip',
      stateRevision: 0,
      proposalRecords: [],
    });
    const firstHarness = await renderApplicationHarness();

    await act(async () => {
      firstHarness.ref.current!.createDraftBlocks([block]);
    });
    expect(firstHarness.ref.current!.approvalAvailability.kind).toBe('eligible');
    await firstHarness.unmount();

    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    clearWeeklyPlanningSessionRuntime();
    const save = vi.fn(async (draft: PlanDraft) => persistedPlan(draft, 'unexpected-plan'));
    const restoredHarness = await renderApplicationHarness({ saveWeeklyApprovedPlan: save });

    expect(restoredHarness.ref.current!.pendingDraftBlocks.map((item) => item.id)).toEqual([
      'restored-block',
    ]);
    expect(restoredHarness.ref.current!.approvalAvailability).toEqual({
      kind: 'recompute_required',
      reason: 'session_runtime_unavailable',
      message: '再読み込み前の仮予定です。最新条件で作り直してください。',
    });
    await act(async () => {
      await expect(restoredHarness.ref.current!.approveDraftBlocks()).rejects.toThrow(
        '現在の条件と一致しない仮予定です',
      );
    });
    expect(save).not.toHaveBeenCalled();
    expect(restoredHarness.ref.current!.pendingDraftBlocks).toHaveLength(1);
    await restoredHarness.unmount();
  });
});
