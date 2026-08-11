import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { PlanningIntakeState } from '../features/weeklyPlanning/intake/weeklyPlanningIntakeTypes';
import { createWeeklyPlanningTestDraftBlock } from '../features/weeklyPlanning/testUtils/weeklyPlanningApplicationTestHarness';
import { NaturalLanguageAssistant } from './NaturalLanguageAssistant';

const message = {
  id: 'assistant-1',
  role: 'assistant' as const,
  content: '条件を教えてください。',
  createdAt: '2026-07-17T10:00:00.000Z',
};

const repairPendingIntakeState: PlanningIntakeState = {
  status: 'revision_pending',
  intent: 'weekly_study_planning',
  tasks: [],
  progress: [],
  unitRates: [],
  constraints: [],
  priorityPolicy: { kind: 'unknown' },
  missing: [],
  assumptions: [],
  uncertainties: [],
  questions: ['英単語80語にはどれくらい時間がかかりますか？'],
  lastQuestionContext: {
    kind: 'missing',
    targetSlot: 'stable_v5:missing_effort_estimate',
    intent: 'missing_effort_estimate',
    topicId: 'workload-english',
  },
  shouldCreateDraft: false,
  shouldSavePlan: false,
  draftGenerationIntent: 'user_authorized',
  sourceTurns: [],
};

function renderAssistant(overrides: Record<string, unknown> = {}) {
  const onSubmitWeeklyPlanningTurn = vi.fn(async () => ({
    accepted: true,
    draftCandidates: [],
  }));
  const onCancelWeeklyPlanningTurn = vi.fn(() => true);
  const onClearWeeklyPlanningConversation = vi.fn(() => true);
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <NaturalLanguageAssistant
        selectedDate="2026-07-17"
        userId="user-1"
        plans={[]}
        materials={[]}
        subjects={[]}
        onApplyDraft={async () => undefined}
        weeklyDraftBlocks={[]}
        weeklyPlanningPreviewCandidates={[]}
        weeklyPlanningMessages={[message]}
        weeklyPlanningIntakeState={null}
        weeklyPlanningWeekStartDate="2026-07-13"
        weeklyPlanningRevision={0}
        onSubmitWeeklyPlanningTurn={onSubmitWeeklyPlanningTurn}
        onCancelWeeklyPlanningTurn={onCancelWeeklyPlanningTurn}
        onClearWeeklyPlanningConversation={onClearWeeklyPlanningConversation}
        onAppendWeeklyPlanningMessage={() => undefined}
        onResetWeeklyPlanningSession={() => undefined}
        onCreateWeeklyDraftBlocks={() => undefined}
        onRemoveWeeklyDraftBlock={() => undefined}
        onClearWeeklyDraftBlocks={() => undefined}
        onApproveWeeklyDraftBlocks={async () => undefined}
        embedded
        {...overrides}
      />,
    );
  });
  return {
    renderer,
    onSubmitWeeklyPlanningTurn,
    onCancelWeeklyPlanningTurn,
    onClearWeeklyPlanningConversation,
  };
}

function findWeeklyTextarea(renderer: ReactTestRenderer) {
  return renderer.root.findByProps({
    placeholder: '例: 来週、計算理論と英語を少しずつ進めたい',
  });
}

describe('NaturalLanguageAssistant weekly planning controls', () => {
  it('submits with Ctrl+Enter but not with plain Enter or IME keyCode 229', async () => {
    const { renderer, onSubmitWeeklyPlanningTurn } = renderAssistant();
    act(() => {
      findWeeklyTextarea(renderer).props.onChange({ target: { value: '来週の予定を作りたい' } });
    });
    const textarea = findWeeklyTextarea(renderer);
    const preventDefault = vi.fn();

    act(() => {
      textarea.props.onKeyDown({
        key: 'Enter',
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        nativeEvent: { isComposing: false, keyCode: 13 },
        preventDefault,
      });
    });
    expect(onSubmitWeeklyPlanningTurn).not.toHaveBeenCalled();

    act(() => {
      textarea.props.onKeyDown({
        key: 'Enter',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        nativeEvent: { isComposing: false, keyCode: 229 },
        preventDefault,
      });
    });
    expect(onSubmitWeeklyPlanningTurn).not.toHaveBeenCalled();

    await act(async () => {
      textarea.props.onKeyDown({
        key: 'Enter',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        nativeEvent: { isComposing: false, keyCode: 13 },
        preventDefault,
      });
      await Promise.resolve();
    });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onSubmitWeeklyPlanningTurn).toHaveBeenCalledWith('来週の予定を作りたい');
  });

  it('promotes the visible Stable V5 preview through the explicit UI control', () => {
    const onCreateWeeklyDraftBlocks = vi.fn();
    const preview = [{
      stableKey: 'stable-v5:8:math:0',
      date: '2026-08-18',
      startTime: '21:00',
      endTime: '24:00',
      durationMinutes: 180,
      title: '数学のワーク 50ページ',
      field: '数学のワーク',
      year: 0,
      estimatedMinutes: 180,
      source: 'weekly_exam_prep' as const,
      approvalStatus: 'unapproved' as const,
      workItemKey: 'math-work',
    }];
    const { renderer } = renderAssistant({
      weeklyPlanningPreviewCandidates: preview,
      onCreateWeeklyDraftBlocks,
    });
    const promoteButton = renderer.root.findAllByType('button').find(
      (button) => button.children.join('') === 'この内容で仮予定にする',
    );

    expect(promoteButton).toBeDefined();
    act(() => promoteButton?.props.onClick());
    expect(onCreateWeeklyDraftBlocks).toHaveBeenCalledTimes(1);
    expect(onCreateWeeklyDraftBlocks.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        date: '2026-08-18',
        startTime: '21:00',
        endTime: '24:00',
        title: '数学のワーク 50ページ',
        status: 'draft',
      }),
    ]);
  });

  it('keeps a visible preview as reference but blocks promotion while a repair question is pending', () => {
    const onCreateWeeklyDraftBlocks = vi.fn();
    const preview = [{
      stableKey: 'stable-v5:8:math:0',
      date: '2026-08-18',
      startTime: '19:00',
      endTime: '20:00',
      durationMinutes: 60,
      title: '数学 10ページ',
      field: '数学',
      year: 0,
      estimatedMinutes: 60,
      source: 'weekly_exam_prep' as const,
      approvalStatus: 'unapproved' as const,
      workItemKey: 'math-work',
    }];
    const { renderer } = renderAssistant({
      weeklyPlanningPreviewCandidates: preview,
      weeklyPlanningIntakeState: repairPendingIntakeState,
      onCreateWeeklyDraftBlocks,
    });
    const promoteButton = renderer.root.findAllByType('button').find(
      (button) => button.children.join('') === 'この内容で仮予定にする',
    );

    expect(promoteButton).toBeDefined();
    expect(promoteButton?.props.disabled).toBe(true);
    act(() => promoteButton?.props.onClick());
    expect(onCreateWeeklyDraftBlocks).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType('small').some(
      (node) => node.children.join('').includes('確認が終わるまで保存できません'),
    )).toBe(true);
  });

  it('routes explicit draft approval to the application approval boundary', async () => {
    const onApproveWeeklyDraftBlocks = vi.fn(async () => undefined);
    const draft = createWeeklyPlanningTestDraftBlock({
      id: 'math-draft',
      overrides: {
        date: '2026-08-18',
        startTime: '21:00',
        endTime: '24:00',
        title: '数学のワーク 50ページ',
      },
    });
    const { renderer } = renderAssistant({
      weeklyDraftBlocks: [draft],
      onApproveWeeklyDraftBlocks,
    });
    const approveButton = renderer.root.findAllByType('button').find(
      (button) => button.children.join('') === '一括承認して保存',
    );

    expect(approveButton).toBeDefined();
    await act(async () => {
      approveButton?.props.onClick();
      await Promise.resolve();
    });
    expect(onApproveWeeklyDraftBlocks).toHaveBeenCalledTimes(1);
  });

  it('connects clear conversation and explicit cancellation as separate operations', () => {
    const cleared = renderAssistant();
    const clearButton = cleared.renderer.root.findAllByType('button').find(
      (button) => button.children.join('') === '会話履歴だけ消す',
    );
    expect(clearButton).toBeDefined();
    act(() => clearButton?.props.onClick());
    expect(cleared.onClearWeeklyPlanningConversation).toHaveBeenCalledTimes(1);

    const pending = {
      conversationId: 'conversation-1',
      turnId: 'conversation-1:turn:1',
      requestId: 'conversation-1:request:1',
      weekStartDate: '2026-07-13',
      baseRevision: 0,
      startedAt: '2026-07-17T10:00:00.000Z',
    };
    const cancelled = renderAssistant({ weeklyPlanningPendingTurn: pending });
    const cancelButtons = cancelled.renderer.root.findAllByType('button').filter(
      (button) => button.children.join('') === '処理をキャンセル',
    );
    expect(cancelButtons).toHaveLength(1);
    act(() => cancelButtons[0].props.onClick());
    expect(cancelled.onCancelWeeklyPlanningTurn).toHaveBeenCalledTimes(1);
  });
});