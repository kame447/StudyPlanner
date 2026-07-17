import {
  createRef,
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NaturalLanguageAssistant } from '../../components/NaturalLanguageAssistant';
import { createInitialPlanningIntakeState } from './intake/weeklyPlanningIntakeReducer';
import type { PlanningIntakeState } from './intake/weeklyPlanningIntakeTypes';
import type { BehaviorAwarePreviewMetadata } from './planning/weeklyPlanningBehaviorAwarePreviewBridge';
import type { WeeklyDraftCandidate } from './scheduling/weeklyDraftCandidateGenerator';
import type {
  PlanningState,
  WeeklyPlanningPendingTurn,
} from './types';
import { useWeeklyPlanningState } from './useWeeklyPlanningState';

const storedValues = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storedValues.get(key) ?? null,
  setItem: (key: string, value: string) => { storedValues.set(key, value); },
  removeItem: (key: string) => { storedValues.delete(key); },
  clear: () => { storedValues.clear(); },
  key: (index: number) => Array.from(storedValues.keys())[index] ?? null,
  get length() { return storedValues.size; },
} as Storage;

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { localStorage: localStorageMock, sessionStorage: localStorageMock },
});

const NOW = '2026-07-16T00:00:00.000Z';
const SELECTED_DATE = '2026-07-16';
const USER_ID = 'user-1';

type BehaviorAwareCandidate = WeeklyDraftCandidate & {
  behaviorMetadata: BehaviorAwarePreviewMetadata;
};

function previewCandidate(): BehaviorAwareCandidate {
  return {
    stableKey: 'preview-report-1',
    date: '2026-07-16',
    startTime: '19:00',
    endTime: '20:00',
    durationMinutes: 60,
    title: 'レポート作成',
    field: '情報学',
    year: 0,
    estimatedMinutes: 60,
    source: 'weekly_exam_prep',
    approvalStatus: 'unapproved',
    workItemKey: 'task:report',
    behaviorMetadata: {
      conversationId: 'conversation-1',
      stateRevision: 2,
      sourceFactRefs: ['task:report'],
      usedAssumptionProposalRefs: [],
      taskRef: 'task:report',
      opportunityTags: ['long_contiguous_window'],
      reasoningKey: 'explicit-duration',
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

interface TurnResult {
  state: PlanningIntakeState;
  message: string;
  draftCandidates: WeeklyDraftCandidate[];
}

interface SessionOwnerHandle {
  setModalOpen(open: boolean): void;
  getState(): PlanningState;
  getSubmission(): Promise<void> | undefined;
}

const SessionOwnerHarness = forwardRef<SessionOwnerHandle, {
  turnResult: Promise<TurnResult>;
}>(function SessionOwnerHarness({ turnResult }, ref) {
  const [modalOpen, setModalOpen] = useState(true);
  const submissionRef = useRef<Promise<void>>();
  const {
    planningState,
    dispatchPlanningAction,
    getPlanningState,
  } = useWeeklyPlanningState(USER_ID, SELECTED_DATE);

  async function submit(text: string): Promise<void> {
    const snapshot = getPlanningState();
    const pending: WeeklyPlanningPendingTurn = {
      requestId: 'turn-1',
      weekStartDate: snapshot.weekStartDate,
      baseRevision: snapshot.revision,
      startedAt: NOW,
    };
    const begun = dispatchPlanningAction({
      type: 'begin_turn',
      pending,
      userMessage: {
        id: 'user-1',
        role: 'user',
        content: text,
        createdAt: NOW,
      },
    });
    if (begun.pendingTurn?.requestId !== pending.requestId) return;

    const result = await turnResult;
    dispatchPlanningAction({
      type: 'commit_turn',
      pending,
      intakeState: result.state,
      assistantMessage: {
        id: 'assistant-1',
        role: 'assistant',
        content: result.message,
        createdAt: NOW,
      },
      draftCandidates: result.draftCandidates,
    });
  }

  useImperativeHandle(ref, () => ({
    setModalOpen,
    getState: getPlanningState,
    getSubmission: () => submissionRef.current,
  }));

  if (!modalOpen) return null;

  return (
    <NaturalLanguageAssistant
      selectedDate={SELECTED_DATE}
      userId={USER_ID}
      plans={[]}
      onApplyDraft={vi.fn(async () => undefined)}
      weeklyDraftBlocks={planningState.draftBlocks}
      weeklyPlanningPreviewCandidates={planningState.previewCandidates}
      weeklyPlanningMessages={planningState.messages}
      weeklyPlanningIntakeState={planningState.intakeState ?? null}
      weeklyPlanningWeekStartDate={planningState.weekStartDate}
      weeklyPlanningRevision={planningState.revision}
      weeklyPlanningPendingTurn={planningState.pendingTurn}
      weeklyPlanningPendingApproval={planningState.pendingApproval}
      onSubmitWeeklyPlanningTurn={async (text) => {
        const submission = submit(text);
        submissionRef.current = submission;
        await submission!;
        const latest = getPlanningState();
        return {
          accepted: latest.pendingTurn === undefined,
          draftCandidates: latest.previewCandidates ?? [],
        };
      }}
      onAppendWeeklyPlanningMessage={(message) => {
        dispatchPlanningAction({ type: 'append_message', message });
      }}
      onResetWeeklyPlanningSession={() => {
        dispatchPlanningAction({ type: 'reset_session' });
      }}
      onCreateWeeklyDraftBlocks={(blocks) => {
        dispatchPlanningAction({ type: 'add_draft_blocks', blocks });
      }}
      onRemoveWeeklyPlanningPreviewCandidate={(candidateId) => {
        dispatchPlanningAction({ type: 'remove_preview_candidate', candidateId });
      }}
      onClearWeeklyDraftBlocks={() => {
        dispatchPlanningAction({ type: 'clear_draft_blocks' });
      }}
      embedded
    />
  );
});

describe('weekly planning preview session lifecycle', () => {
  beforeEach(() => storedValues.clear());

  it('commits an App-owned Promise result while the modal child is unmounted and restores it on remount', async () => {
    const turn = deferred<TurnResult>();
    const ownerRef = createRef<SessionOwnerHandle>();
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <SessionOwnerHarness ref={ownerRef} turnResult={turn.promise} />,
      );
    });

    await act(async () => {
      const weeklyPlanningButton = renderer.root.findAllByType('button').find(
        (button) => button.children.join('') === '週間計画',
      );
      expect(weeklyPlanningButton).toBeDefined();
      weeklyPlanningButton!.props.onClick();
    });
    const textarea = renderer.root.findByType('textarea');
    act(() => textarea.props.onChange({ target: { value: 'レポートを1時間進めたい' } }));
    await act(async () => {
      const sendButton = renderer.root.findAllByType('button').find(
        (button) => button.children.join('') === '送信',
      );
      expect(sendButton).toBeDefined();
      sendButton!.props.onClick();
      await Promise.resolve();
    });
    const submission = ownerRef.current!.getSubmission();
    expect(submission).toBeDefined();
    expect(ownerRef.current!.getState().pendingTurn).toBeDefined();

    act(() => ownerRef.current!.setModalOpen(false));
    expect(renderer.toJSON()).toBeNull();

    await act(async () => {
      turn.resolve({
        state: {
          ...createInitialPlanningIntakeState(),
          sourceTurns: ['レポートを1時間進めたい'],
        },
        message: '仮予定を作成しました。',
        draftCandidates: [previewCandidate()],
      });
      await submission;
    });

    expect(ownerRef.current!.getState().pendingTurn).toBeUndefined();
    expect(ownerRef.current!.getState().previewCandidates).toEqual([previewCandidate()]);

    act(() => ownerRef.current!.setModalOpen(true));
    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain('レポートを1時間進めたい');
    expect(rendered).toContain('仮予定を作成しました。');
    expect(rendered).toContain('レポート作成');
    expect(rendered).toContain('この内容で仮予定にする');

    act(() => renderer.unmount());
  });
});
