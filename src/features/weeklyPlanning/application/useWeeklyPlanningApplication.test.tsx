import {
  createRef,
  forwardRef,
  useImperativeHandle,
  type RefObject,
} from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanDraft } from '../../../types/domain';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import type { WeeklyPreviewMetadata } from '../planning/weeklyPlanningApprovalTypes';
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

async function renderApplicationHarness(
  overrides: Partial<UseWeeklyPlanningApplicationInput> = {},
): Promise<RenderedApplicationHarness> {
  const ref = createRef<WeeklyPlanningApplication>();
  let currentProps: UseWeeklyPlanningApplicationInput = {
    userId: 'user-1',
    selectedDate: '2026-07-14',
    plans: [],
    scheduleTemplates: [],
    savePlanDraft: async () => undefined,
    ...overrides,
  };
  let renderer!: ReactTestRenderer;

  await act(async () => {
    renderer = create(<ApplicationHarness ref={ref} {...currentProps} />);
  });

  return {
    ref,
    async update(nextOverrides) {
      currentProps = { ...currentProps, ...nextOverrides };
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
    storageHarness = createMemoryStorageHarness();
    restoreWindow = installWeeklyPlanningTestStorage(storageHarness.storage);
    executeWeeklyPlanningTurnMock.mockReset();
  });

  afterEach(() => {
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

  it('discards an old turn result after the selected week changes', async () => {
    const pendingTurn = createDeferred<WeeklyPlanningTurnExecutionResult>();
    executeWeeklyPlanningTurnMock.mockImplementation(() => pendingTurn.promise);
    const harness = await renderApplicationHarness();
    let submission!: Promise<WeeklyPlanningTurnSubmissionResult>;

    await act(async () => {
      submission = harness.ref.current!.submitTurn('旧週の送信');
      await Promise.resolve();
    });
    expect(harness.ref.current!.state.pendingTurn).toBeDefined();

    await harness.update({ selectedDate: '2026-07-21' });
    expect(harness.ref.current!.state.weekStartDate).toBe('2026-07-20');
    expect(harness.ref.current!.state.pendingTurn).toBeUndefined();

    let result: WeeklyPlanningTurnSubmissionResult | undefined;
    await act(async () => {
      pendingTurn.resolve(turnResult('旧週の送信'));
      result = await submission;
    });

    expect(result).toEqual({ accepted: false, draftCandidates: [] });
    expect(harness.ref.current!.state.weekStartDate).toBe('2026-07-20');
    expect(harness.ref.current!.state.messages).toEqual([]);
    expect(harness.ref.current!.state.intakeState).toBeUndefined();
    await harness.unmount();
  });

  it('rotates controller conversation scope after user and week changes', async () => {
    const traceRequestIds: string[] = [];
    executeWeeklyPlanningTurnMock.mockImplementation(
      async (input: WeeklyPlanningTurnExecutionInput) => {
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
      await harness.ref.current!.submitTurn('別週の送信');
    });

    expect(traceRequestIds).toHaveLength(3);
    expect(new Set(traceRequestIds).size).toBe(3);
    expect(traceRequestIds.every((requestId) => requestId.endsWith(':request:1'))).toBe(true);
    await harness.unmount();
  });

  it('loads the approval ledger after remount and skips an already completed operation', async () => {
    const previewMetadata: WeeklyPreviewMetadata = {
      previewId: 'preview-ledger-round-trip',
      stateRevision: 4,
      assumptionDependencies: [],
      approvalEligibility: 'eligible',
      stale: false,
      authorizedUserId: 'user-1',
    };
    const block = createWeeklyPlanningTestDraftBlock({
      id: 'ledger-block',
      previewMetadata,
    });
    const firstSave = vi.fn(async (_draft: PlanDraft) => undefined);
    const firstHarness = await renderApplicationHarness({ savePlanDraft: firstSave });

    await act(async () => {
      firstHarness.ref.current!.createDraftBlocks([block]);
    });
    await act(async () => {
      await firstHarness.ref.current!.approveDraftBlocks();
    });

    expect(firstSave).toHaveBeenCalledTimes(1);
    expect(storageHarness.values.get('studyplanner-weekly-approval-ledger-v1')).toContain(
      'preview-ledger-round-trip',
    );
    await firstHarness.unmount();

    const secondSave = vi.fn(async (_draft: PlanDraft) => undefined);
    const secondHarness = await renderApplicationHarness({ savePlanDraft: secondSave });
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
});
