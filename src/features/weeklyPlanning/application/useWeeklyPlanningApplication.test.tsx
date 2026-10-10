// Hold code loading independently of planner-data authority and turn execution.
vi.mock('./weeklyPlanningRuntimeModule', async () => ({
  ...await vi.importActual('./weeklyPlanningRuntimeModule'),
  loadWeeklyPlanningRuntimeModule: loadRuntimeMock,
}));
import { PlannerDataReadAuthority } from '../../../domain/plannerDataReadAuthority';
import * as turnApplication from './weeklyPlanningTurnApplication';
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
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import * as sessionCodec from './weeklyPlanningStableV5SessionCodec';
import * as compatibilityStorage from '../weeklyPlanningStorage';
import { saveWeeklyPlanningStableV5PersistedSession } from './weeklyPlanningStableV5SessionStorage';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
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
