import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { NaturalLanguageAssistant } from './NaturalLanguageAssistant';

const message = {
  id: 'assistant-1',
  role: 'assistant' as const,
  content: '条件を教えてください。',
  createdAt: '2026-07-17T10:00:00.000Z',
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
