import { Redo2, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import '../styles/drag-undo-redo.css';

interface DragUndoRedoControlsProps {
  visible: boolean;
  canUndo: boolean;
  canRedo: boolean;
  isBusy?: boolean;
  placement?: 'schedule' | 'preview';
  centerAction?: ReactNode;
  ariaLabel?: string;
  onUndo: () => void;
  onRedo: () => void;
}

export function DragUndoRedoControls({
  visible,
  canUndo,
  canRedo,
  isBusy = false,
  placement = 'schedule',
  centerAction = null,
  ariaLabel = '予定移動の履歴操作',
  onUndo,
  onRedo,
}: DragUndoRedoControlsProps) {
  const centerSlotRef = useRef<HTMLSpanElement | null>(null);
  const [hasCenterAction, setHasCenterAction] = useState(Boolean(centerAction));

  useEffect(() => {
    const centerSlot = centerSlotRef.current;
    if (!centerSlot || typeof MutationObserver === 'undefined') return;

    const syncCenterActionState = () => {
      setHasCenterAction(Boolean(centerAction) || centerSlot.childElementCount > 0);
    };
    syncCenterActionState();

    const observer = new MutationObserver(syncCenterActionState);
    observer.observe(centerSlot, { childList: true });
    return () => observer.disconnect();
  }, [centerAction]);

  if (typeof document === 'undefined') {
    return null;
  }

  const shouldHide = !visible && !hasCenterAction;

  return createPortal(
    <div
      className={`drag-undo-redo-controls drag-undo-redo-controls--${placement}`}
      role="group"
      aria-label={ariaLabel}
      style={
        shouldHide
          ? { visibility: 'hidden', pointerEvents: 'none', opacity: 0 }
          : undefined
      }
    >
      <button
        type="button"
        aria-label="変更を元に戻す"
        title="変更を元に戻す"
        disabled={!canUndo || isBusy}
        onClick={onUndo}
      >
        <Undo2 size={20} strokeWidth={2.2} aria-hidden="true" />
      </button>
      <span
        ref={centerSlotRef}
        style={{ display: 'contents', color: 'var(--danger)' }}
        data-drag-undo-redo-center-slot="true"
      >
        {centerAction}
      </span>
      <button
        type="button"
        aria-label="変更をやり直す"
        title="変更をやり直す"
        disabled={!canRedo || isBusy}
        onClick={onRedo}
      >
        <Redo2 size={20} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </div>,
    document.body,
  );
}
