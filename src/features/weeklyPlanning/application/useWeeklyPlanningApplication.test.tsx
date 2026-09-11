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
import type { Plan, PlanDraft } from '../../../types/domain';
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
    clearWeeklyPlanningSessionRuntime();
  });

  afterEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    clearWeeklyPlanningSessionRuntime();
    restoreWindow();
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
