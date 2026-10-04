import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { WeeklyPlanningApplication } from '../features/weeklyPlanning/application/useWeeklyPlanningApplication';

import { applyEditedPreviewPositions } from '../features/weeklyPlanning/preview/weeklyPlanningPreviewEdits';
import {
  createWeeklyDraftBlocksFromPreviewCandidates,
  createWeeklyPlanningPreviewBlocks,
  createWeeklyPlanningPreviewDisplayBlock,
} from '../features/weeklyPlanning/preview/weeklyPlanningPreviewBlocks';
import type { WeeklyPlanDraftBlock } from '../features/weeklyPlanning/types';
import { useExitMotion } from '../hooks/useExitMotion';
import type { Plan } from '../types/domain';
import { normalizeAiPlanningPreviewBlocks } from './aiPlanningPreviewPeriod';
import { AiPlanningPreviewDialog } from './AiPlanningPreviewDialog';
import { AiPlanningView as AiPlanningViewLegacy } from './AiPlanningViewLegacy';
import './AiPlanningPreviewDialog.css';
import './AiPlanningPreviewDialogLayout.css';
import './AiPlanningPreviewBottomSheet.css';

interface AiPlanningViewProps {
  application: WeeklyPlanningApplication;
  userId: string;
  selectedDate: string;
  plans: Plan[];
}

export function AiPlanningView(props: AiPlanningViewProps) {
  return <OwnerScopedAiPlanningView key={props.userId} {...props} />;
}

function OwnerScopedAiPlanningView(props: AiPlanningViewProps) {
  const { application, userId, plans } = props;
  const { state, pendingDraftBlocks, approvalAvailability } = application;
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const shellRef = useRef<HTMLDivElement | null>(null);
  const cancellationEpoch = useRef(0);
  const { isExiting: isPreviewClosing, requestExit: requestClosePreview } =
    useExitMotion(() => setIsPreviewOpen(false));
  const previewCandidates = state.previewCandidates ?? [];
  const localPreviewBlocks = useMemo(
    () =>
      createWeeklyPlanningPreviewBlocks(previewCandidates).map((block) =>
        createWeeklyPlanningPreviewDisplayBlock(block, userId),
      ),
    [previewCandidates, userId],
  );
  const hasLocalPreview = localPreviewBlocks.length > 0;
  const allPreviewBlocks = useMemo(
    () =>
      normalizeAiPlanningPreviewBlocks(
        hasLocalPreview ? localPreviewBlocks : pendingDraftBlocks,
      ),
    [hasLocalPreview, localPreviewBlocks, pendingDraftBlocks],
  );
  const isBusy = Boolean(state.pendingTurn || state.pendingApproval || application.chat.requiresInitialization);

  useLayoutEffect(() => {
    if (!isPreviewOpen) return;
    const conversation = shellRef.current?.querySelector<HTMLElement>(
      '.ai-planning-conversation',
    );
    if (!conversation) return;

    const root = document.documentElement;
    const body = document.body;
    const lockedConversationScrollTop = conversation.scrollTop;
    const lockedWindowScrollX = window.scrollX;
    const lockedWindowScrollY = window.scrollY;
    const previousRootOverflow = root.style.overflow;
    const previousRootOverscrollBehavior = root.style.overscrollBehavior;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyOverscrollBehavior = body.style.overscrollBehavior;
    const previousBodyPosition = body.style.position;
    const previousBodyTop = body.style.top;
    const previousBodyLeft = body.style.left;
    const previousBodyRight = body.style.right;
    const previousBodyWidth = body.style.width;

    const keepBackgroundScrollPinned = () => {
      if (conversation.scrollTop !== lockedConversationScrollTop) {
        conversation.scrollTop = lockedConversationScrollTop;
      }
    };

    root.style.overflow = 'hidden';
    root.style.overscrollBehavior = 'none';
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    body.style.position = 'fixed';
    body.style.top = `-${lockedWindowScrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';

    keepBackgroundScrollPinned();
    conversation.addEventListener('scroll', keepBackgroundScrollPinned, { passive: true });
    return () => {
      conversation.removeEventListener('scroll', keepBackgroundScrollPinned);
      root.style.overflow = previousRootOverflow;
      root.style.overscrollBehavior = previousRootOverscrollBehavior;
      body.style.overflow = previousBodyOverflow;
      body.style.overscrollBehavior = previousBodyOverscrollBehavior;
      body.style.position = previousBodyPosition;
      body.style.top = previousBodyTop;
      body.style.left = previousBodyLeft;
      body.style.right = previousBodyRight;
      body.style.width = previousBodyWidth;
      window.scrollTo(lockedWindowScrollX, lockedWindowScrollY);
    };
  }, [isPreviewOpen]);

  function persistActiveChatSnapshot() {
    return application.chat.checkpoint();
  }

  function openPreviewFromLegacySurface(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const trigger = target.closest('.ai-planning-preview-button');
    if (!trigger) return;

    event.preventDefault();
    event.stopPropagation();
    setPreviewError('');
    setIsPreviewOpen(true);
  }

  function removePreviewBlock(blockId: string) {
    if (isBusy) return;
    if (hasLocalPreview) {
      application.removePreviewCandidate(blockId);
    } else {
      application.removeDraftBlock(blockId);
    }
    // The application dispatch updates its authoritative state ref synchronously.
    // Persist before the deletion can close the dialog or navigation discards a
    // queued frame; otherwise chat restoration can revive the removed block.
    persistActiveChatSnapshot();
  }

  function promotePreview(editedPreviewBlocks: WeeklyPlanDraftBlock[]) {
    if (previewCandidates.length === 0 || editedPreviewBlocks.length === 0) return;
    const blockIds = new Set(editedPreviewBlocks.map((block) => block.id));
    const candidates = previewCandidates.filter((candidate) =>
      blockIds.has(candidate.stableKey),
    );
    const generatedBlocks = createWeeklyDraftBlocksFromPreviewCandidates({
      candidates,
      userId,
      createdAt: new Date().toISOString(),
    });
    if (generatedBlocks.length === 0) return;

    const { blocks } = applyEditedPreviewPositions(
      generatedBlocks,
      editedPreviewBlocks,
    );
    if (pendingDraftBlocks.length > 0) {
      application.clearDraftBlocks();
    }
    application.createDraftBlocks(blocks);
    persistActiveChatSnapshot();
  }

  async function saveDrafts(editedPreviewBlocks: WeeklyPlanDraftBlock[]) {
    if (
      pendingDraftBlocks.length === 0 ||
      approvalAvailability.kind !== 'eligible'
    ) {
      return;
    }

    setPreviewError('');
    try {
      const edited = applyEditedPreviewPositions(
        pendingDraftBlocks,
        editedPreviewBlocks,
      );
      if (edited.changed) {
        application.clearDraftBlocks();
        application.createDraftBlocks(edited.blocks);
      }
      await application.approveDraftBlocks();
      persistActiveChatSnapshot();
      requestClosePreview();
    } catch (error) {
      setPreviewError(
        error instanceof Error ? error.message : '週間計画を保存できませんでした。',
      );
      persistActiveChatSnapshot();
    }
  }

  function closePreviewForAdjustment() {
    requestClosePreview();
  }

  function cancelPendingTurn() {
    if (!state.pendingTurn) return;
    const cancelled = application.cancelTurn();
    if (cancelled) {
      cancellationEpoch.current += 1;
      persistActiveChatSnapshot();
    }
  }

  return (
    <div
      ref={shellRef}
      className={`ai-planning-view-shell-v2 ${isPreviewOpen ? 'is-preview-open' : ''}`}
      onClickCapture={openPreviewFromLegacySurface}
    >
      <AiPlanningViewLegacy {...props} cancellationEpoch={cancellationEpoch} />
      {application.chat.result?.status === 'blocked' ? (
        <div className="ai-planning-error" role="alert">
          {application.chat.requiresInitialization
            ? '保存済みチャットを読み込めません。保存データは変更していません。再試行してください。'
            : application.chat.result.reason === 'target-unavailable'
            ? 'このチャットの保存データを開けません。今の会話は変更していません。'
            : 'チャットの保存を完了できませんでした。今の内容は保持しています。画面を閉じずに再試行してください。'}
          {application.chat.dirty || application.chat.requiresInitialization ? <button type="button" aria-label="チャットの保存を再試行"
            onClick={() => application.chat.retry()}>{application.chat.requiresInitialization ? '読み込みを再試行' : '保存を再試行'}</button> : null}
          {application.chat.canStartWithoutRestoring ? <button type="button" aria-label="読み込めないチャットを残して新規作成" onClick={() => {
            if (window.confirm('今表示している未保存内容は引き継がれません。読み込めなかった保存済みチャットは残して、新しいチャットを開始しますか？')) application.chat.startWithoutRestoring();
          }}>保存済みチャットを残して新しく開始</button> : null}
        </div>
      ) : null}
      {state.pendingTurn ? (
        <div className="ai-planning-pending-turn-actions">
          <button
            className="ghost-button"
            type="button"
            onClick={cancelPendingTurn}
          >
            処理をキャンセル
          </button>
        </div>
      ) : null}
      {isPreviewOpen && allPreviewBlocks.length > 0 ? (
        <div
          className={`ai-planning-preview-motion ${isPreviewClosing ? 'is-closing' : 'is-open'}`}
        >
          <AiPlanningPreviewDialog
            blocks={allPreviewBlocks}
            plans={plans}
            error={previewError}
            hasLocalPreview={hasLocalPreview}
            isBusy={isBusy}
            isSaving={Boolean(state.pendingApproval)}
            canSave={approvalAvailability.kind === 'eligible'}
            onClose={() => requestClosePreview()}
            onAdjust={closePreviewForAdjustment}
            onRemove={removePreviewBlock}
            onPromote={promotePreview}
            onSave={(blocks) => void saveDrafts(blocks)}
          />
        </div>
      ) : null}
    </div>
  );
}
