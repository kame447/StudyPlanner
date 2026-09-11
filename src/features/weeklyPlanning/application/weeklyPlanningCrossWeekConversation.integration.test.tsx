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
import type { PlanDraft } from '../../../types/domain';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
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

const Harness = forwardRef<WeeklyPlanningApplication, UseWeeklyPlanningApplicationInput>(
  function Harness(props, ref) {
    const application = useWeeklyPlanningApplication(props);
    useImperativeHandle(ref, () => application, [application]);
    return null;
  },
);

interface RenderedHarness {
  ref: RefObject<WeeklyPlanningApplication>;
  update(overrides: Partial<UseWeeklyPlanningApplicationInput>): Promise<void>;
  unmount(): Promise<void>;
}

async function renderHarness(
  overrides: Partial<UseWeeklyPlanningApplicationInput> = {},
): Promise<RenderedHarness> {
  const ref = createRef<WeeklyPlanningApplication>();
  let props: UseWeeklyPlanningApplicationInput = {
    userId: 'user-1',
    selectedDate: '2026-08-11',
    plans: [],
    scheduleTemplates: [],
    saveWeeklyApprovedPlan: async (draft: PlanDraft) => ({
      ...createPlanFromDraft(draft),
      id: 'plan-1',
    }),
    ...overrides,
    plannerDataAvailability:
      overrides.plannerDataAvailability
      ?? createReadyPlannerDataAvailability(overrides.userId ?? 'user-1'),
  };
  let renderer!: ReactTestRenderer;

  await act(async () => {
    renderer = create(<Harness ref={ref} {...props} />);
  });

  return {
    ref,
    async update(nextOverrides) {
      props = { ...props, ...nextOverrides };
      await act(async () => {
        renderer.update(<Harness ref={ref} {...props} />);
      });
    },
    async unmount() {
      await act(async () => renderer.unmount());
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

describe('cross-week weekly planning conversation continuity', () => {
  let storageHarness: MemoryStorageHarness;
  let restoreWindow: () => void;

  beforeEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    storageHarness = createMemoryStorageHarness();
    restoreWindow = installWeeklyPlanningTestStorage(storageHarness.storage);
    executeWeeklyPlanningTurnMock.mockReset();
  });

  afterEach(() => {
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();
    restoreWindow();
  });

  it('keeps the same conversation and prior messages after only the displayed week changes', async () => {
    const conversationIds: string[] = [];
    const requestIds: string[] = [];
    executeWeeklyPlanningTurnMock.mockImplementation(
      async (input: WeeklyPlanningTurnExecutionInput) => {
        conversationIds.push(input.conversationId);
        requestIds.push(input.traceRequestId);
        return turnResult(input.userText);
      },
    );
    const harness = await renderHarness();

    await act(async () => {
      await harness.ref.current!.submitTurn('来週の数学を進めたい');
    });
    const messagesBeforeWeekChange = harness.ref.current!.state.messages.map(
      (message) => message.content,
    );

    await harness.update({ selectedDate: '2026-08-18' });
    expect(harness.ref.current!.state.messages.map((message) => message.content)).toEqual(
      messagesBeforeWeekChange,
    );

    await act(async () => {
      await harness.ref.current!.submitTurn('英語も追加したい');
    });

    expect(conversationIds).toHaveLength(2);
    expect(conversationIds[1]).toBe(conversationIds[0]);
    expect(requestIds).toEqual([
      `${conversationIds[0]}:request:1`,
      `${conversationIds[0]}:request:2`,
    ]);
    expect(harness.ref.current!.state.messages.map((message) => message.content)).toEqual([
      '来週の数学を進めたい',
      '確認しました: 来週の数学を進めたい',
      '英語も追加したい',
      '確認しました: 英語も追加したい',
    ]);
    await harness.unmount();
  });

  it('does not invalidate an in-flight conversational turn when the user only changes displayed week', async () => {
    const deferred = createDeferred<WeeklyPlanningTurnExecutionResult>();
    executeWeeklyPlanningTurnMock.mockImplementation(() => deferred.promise);
    const harness = await renderHarness();
    let submission!: Promise<WeeklyPlanningTurnSubmissionResult>;

    await act(async () => {
      submission = harness.ref.current!.submitTurn('数学の予定を相談したい');
      await Promise.resolve();
    });
    expect(harness.ref.current!.state.pendingTurn).toBeDefined();

    await harness.update({ selectedDate: '2026-08-18' });
    expect(harness.ref.current!.state.pendingTurn).toBeDefined();

    let result: WeeklyPlanningTurnSubmissionResult | undefined;
    await act(async () => {
      deferred.resolve(turnResult('数学の予定を相談したい'));
      result = await submission;
    });

    expect(result?.accepted).toBe(true);
    expect(harness.ref.current!.state.pendingTurn).toBeUndefined();
    expect(harness.ref.current!.state.messages.map((message) => message.content)).toEqual([
      '数学の予定を相談したい',
      '確認しました: 数学の予定を相談したい',
    ]);
    await harness.unmount();
  });

  it('does not interrupt an in-flight approval when the displayed week changes', async () => {
    const saveGate = createDeferred<void>();
    let saveCount = 0;
    const harness = await renderHarness({
      saveWeeklyApprovedPlan: async (draft) => {
        saveCount += 1;
        await saveGate.promise;
        return {
          ...createPlanFromDraft(draft),
          id: `saved-plan-${saveCount}`,
        };
      },
    });
    const block = createWeeklyPlanningTestDraftBlock({
      id: 'cross-week-approval-block',
      previewMetadata: {
        previewId: 'cross-week-approval-preview',
        stateRevision: 0,
        assumptionDependencies: [],
        approvalEligibility: 'eligible',
        stale: false,
        authorizedUserId: 'user-1',
      },
      overrides: {
        date: '2026-08-12',
      },
    });

    await act(async () => {
      harness.ref.current!.createDraftBlocks([block]);
    });
    const originalWeek = harness.ref.current!.state.weekStartDate;
    let approval!: Promise<void>;
    await act(async () => {
      approval = harness.ref.current!.approveDraftBlocks();
      await Promise.resolve();
    });
    expect(harness.ref.current!.state.pendingApproval).toBeDefined();

    await harness.update({ selectedDate: '2026-08-18' });
    expect(harness.ref.current!.state.weekStartDate).toBe(originalWeek);
    expect(harness.ref.current!.state.pendingApproval).toBeDefined();
    expect(harness.ref.current!.pendingDraftBlocks.map((item) => item.id)).toEqual([
      'cross-week-approval-block',
    ]);

    await act(async () => {
      saveGate.resolve();
      await approval;
    });

    expect(saveCount).toBe(1);
    expect(harness.ref.current!.state.pendingApproval).toBeUndefined();
    expect(harness.ref.current!.pendingDraftBlocks).toEqual([]);
    expect(harness.ref.current!.state.weekStartDate).toBe('2026-08-17');
    await harness.unmount();
  });

  it('restores the active conversation after remounting from another displayed week', async () => {
    const conversationIds: string[] = [];
    const requestIds: string[] = [];
    executeWeeklyPlanningTurnMock.mockImplementation(
      async (input: WeeklyPlanningTurnExecutionInput) => {
        conversationIds.push(input.conversationId);
        requestIds.push(input.traceRequestId);
        return turnResult(input.userText);
      },
    );

    const firstHarness = await renderHarness();
    await act(async () => {
      await firstHarness.ref.current!.submitTurn('数学の予定を相談したい');
    });
    const firstMessages = firstHarness.ref.current!.state.messages.map((message) => message.content);
    await firstHarness.unmount();
    resetWeeklyPlanningStableV5RuntimeSessionsForTest();

    const restoredHarness = await renderHarness({ selectedDate: '2026-08-18' });
    expect(restoredHarness.ref.current!.state.messages.map((message) => message.content)).toEqual(
      firstMessages,
    );

    await act(async () => {
      await restoredHarness.ref.current!.submitTurn('英語も追加したい');
    });

    expect(conversationIds).toHaveLength(2);
    expect(conversationIds[1]).toBe(conversationIds[0]);
    expect(requestIds).toEqual([
      `${conversationIds[0]}:request:1`,
      `${conversationIds[0]}:request:2`,
    ]);
    await restoredHarness.unmount();
  });
});
