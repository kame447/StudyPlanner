import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { WeeklyPlanningApplication } from '../features/weeklyPlanning/application/useWeeklyPlanningApplication';
import {
  createAiPlanningChat,
  deriveAiPlanningChatTitle,
  loadAiPlanningChatIndex,
  saveAiPlanningChatIndex,
  saveAiPlanningChatSnapshot,
  updateAiPlanningChatRecord,
} from '../features/weeklyPlanning/chat/aiPlanningChatStore';
import {
  createWeeklyDraftBlocksFromPreviewCandidates,
  createWeeklyPlanningPreviewBlocks,
  createWeeklyPlanningPreviewDisplayBlock,
} from '../features/weeklyPlanning/preview/weeklyPlanningPreviewBlocks';
import { normalizeAiPlanningPreviewBlocks } from './aiPlanningPreviewPeriod';
import { useExitMotion } from '../hooks/useExitMotion';
import type { Plan } from '../types/domain';
import { AiPlanningView as AiPlanningViewLegacy } from './AiPlanningViewLegacy';
import { AiPlanningPreviewDialog } from './AiPlanningPreviewDialog';
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
  const { application, userId, plans } = props;
  const { state, pendingDraftBlocks, approvalAvailability } = application;
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const shellRef = useRef<HTMLDivElement | null>(null);
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
  const isBusy = Boolean(state.pendingTurn || state.pendingApproval);

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
    const snapshot = application.exportConversationSnapshot();
    if (!snapshot) return;

    const currentIndex = loadAiPlanningChatIndex(userId);
    const activeChatId = currentIndex.activeChatId;
    const activeChat = currentIndex.chats.find((chat) => chat.id === activeChatId);
    if (!activeChat) {
      const created = createAiPlanningChat(currentIndex);
      saveAiPlanningChatSnapshot(userId, created.chat.id, snapshot);
      const nextCreatedIndex = updateAiPlanningChatRecord(created.index, created.chat.id, {
        title: deriveAiPlanningChatTitle(snapshot.planningState.messages),
        updatedAt: snapshot.savedAt,
        weekStartDate: snapshot.weekStartDate,
      });
      saveAiPlanningChatIndex(userId, nextCreatedIndex);
      return;
    }

    saveAiPlanningChatSnapshot(userId, activeChatId, snapshot);
    const nextIndex = updateAiPlanningChatRecord(currentIndex, activeChatId, {
      title: deriveAiPlanningChatTitle(snapshot.planningState.messages),
      updatedAt: snapshot.savedAt,
      weekStartDate: snapshot.weekStartDate,
    });
    saveAiPlanningChatIndex(userId, nextIndex);
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

  function promotePreview() {
    if (previewCandidates.length === 0 || allPreviewBlocks.length === 0) return;
    const blockIds = new Set(allPreviewBlocks.map((block) => block.id));
    const candidates = previewCandidates.filter((candidate) =>
      blockIds.has(candidate.stableKey),
    );
    const blocks = createWeeklyDraftBlocksFromPreviewCandidates({
      candidates,
      userId,
      createdAt: new Date().toISOString(),
    });
    if (blocks.length === 0) return;

    if (pendingDraftBlocks.length > 0) {
      application.clearDraftBlocks();
    }
    application.createDraftBlocks(blocks);
    window.requestAnimationFrame(persistActiveChatSnapshot);
  }

  async function saveDrafts() {
    if (
      pendingDraftBlocks.length === 0 ||
      approvalAvailability.kind !== 'eligible'
    ) {
      return;
    }

    setPreviewError('');
    try {
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

  function focusComposer() {
    requestClosePreview(() => {
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLTextAreaElement>('.ai-planning-composer textarea')?.focus();
      });
    });
  }

  return (
    <div
      ref={shellRef}
      className={`ai-planning-view-shell-v2 ${isPreviewOpen ? 'is-preview-open' : ''}`}
      onClickCapture={openPreviewFromLegacySurface}
    >
      <AiPlanningViewLegacy {...props} />
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
            onAdjust={focusComposer}
            onPromote={promotePreview}
            onSave={() => void saveDrafts()}
          />
        </div>
      ) : null}
    </div>
  );
}
