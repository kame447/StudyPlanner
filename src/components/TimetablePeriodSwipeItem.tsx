import {
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import type { TimetableTerm } from '../types/domain';

const ACTION_REVEAL_WIDTH_PX = 84;
const HORIZONTAL_SWIPE_START_PX = 6;
const OPEN_THRESHOLD_RATIO = 0.38;

interface TimetablePeriodSwipeItemProps {
  term: TimetableTerm;
  rangeLabel: string;
  active: boolean;
  disabled: boolean;
  deleting: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: () => void;
  onDelete: () => void;
}

interface SwipePointerState {
  pointerId: number;
  startX: number;
  startY: number;
  startOffset: number;
  horizontal: boolean;
}

function clampSwipeOffset(value: number): number {
  return Math.max(-ACTION_REVEAL_WIDTH_PX, Math.min(0, value));
}

export function TimetablePeriodSwipeItem({
  term,
  rangeLabel,
  active,
  disabled,
  deleting,
  isOpen,
  onOpenChange,
  onSelect,
  onDelete,
}: TimetablePeriodSwipeItemProps) {
  const pointerRef = useRef<SwipePointerState | null>(null);
  const suppressClickRef = useRef(false);
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const restingOffset = isOpen ? -ACTION_REVEAL_WIDTH_PX : 0;
  const offset = dragOffset ?? restingOffset;
  const revealProgress = Math.min(1, Math.abs(offset) / ACTION_REVEAL_WIDTH_PX);
  const actionStyle: CSSProperties = {
    opacity: revealProgress,
    transform: `translate3d(${18 * (1 - revealProgress)}px, 0, 0) scale(${0.96 + 0.04 * revealProgress})`,
  };

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (disabled) {
      return;
    }

    pointerRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: restingOffset,
      horizontal: false,
    };
    suppressClickRef.current = false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - pointer.startX;
    const deltaY = event.clientY - pointer.startY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (!pointer.horizontal) {
      if (Math.max(absX, absY) < HORIZONTAL_SWIPE_START_PX) {
        return;
      }

      if (absY > absX) {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        pointerRef.current = null;
        setDragOffset(null);
        setDragging(false);
        return;
      }

      pointer.horizontal = true;
      suppressClickRef.current = true;
      setDragging(true);
    }

    setDragOffset(clampSwipeOffset(pointer.startOffset + deltaX));
  }

  function finishPointer(event: PointerEvent<HTMLButtonElement>) {
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) {
      return;
    }

    if (pointer.horizontal) {
      const nextOffset = clampSwipeOffset(
        pointer.startOffset + event.clientX - pointer.startX,
      );
      onOpenChange(
        nextOffset <= -ACTION_REVEAL_WIDTH_PX * OPEN_THRESHOLD_RATIO,
      );
      suppressClickRef.current = true;
    }

    pointerRef.current = null;
    setDragOffset(null);
    setDragging(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function cancelPointer(event: PointerEvent<HTMLButtonElement>) {
    if (pointerRef.current?.pointerId === event.pointerId) {
      pointerRef.current = null;
    }
    setDragOffset(null);
    setDragging(false);
  }

  return (
    <div
      className={[
        'timetable-period-swipe-row',
        offset < -1 ? 'is-revealed' : '',
        dragging ? 'is-dragging' : '',
      ].filter(Boolean).join(' ')}
    >
      <div className="timetable-period-swipe-actions">
        <button
          aria-label={`${term.label}を削除`}
          className="timetable-period-delete-action"
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          onFocus={() => {
            if (!disabled) {
              onOpenChange(true);
            }
          }}
          style={actionStyle}
          type="button"
        >
          {deleting ? '削除中…' : '削除'}
        </button>
      </div>
      <button
        aria-expanded={isOpen}
        aria-label={`${term.label}を選択`}
        className={
          active
            ? 'timetable-period-list-item active'
            : 'timetable-period-list-item'
        }
        disabled={disabled}
        onClick={(event) => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            event.preventDefault();
            return;
          }

          if (isOpen) {
            onOpenChange(false);
            return;
          }

          onSelect();
        }}
        onPointerCancel={cancelPointer}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        style={{ transform: `translate3d(${offset}px, 0, 0)` }}
        type="button"
      >
        <strong>{term.label}</strong>
        <span>{rangeLabel}</span>
      </button>
    </div>
  );
}
