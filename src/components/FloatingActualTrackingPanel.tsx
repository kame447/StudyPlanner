import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { ActualTrackingTools } from './ActualTrackingTools';

interface FloatingActualTrackingPanelProps {
  hasApplyTarget: boolean;
  onApplyMeasuredRange: (startTime: string, endTime: string) => void;
  onClose: () => void;
  targetLabel?: string;
}

type PanelPosition = {
  x: number;
  y: number;
};

const LONG_PRESS_MS = 320;
const VIEWPORT_MARGIN = 8;

function isInteractiveElement(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    ? Boolean(target.closest('button, input, select, textarea, a, [role="button"]'))
    : false;
}

function clampPosition(position: PanelPosition, panel: HTMLElement): PanelPosition {
  const rect = panel.getBoundingClientRect();
  const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.width - VIEWPORT_MARGIN);
  const maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.height - VIEWPORT_MARGIN);

  return {
    x: Math.min(Math.max(position.x, VIEWPORT_MARGIN), maxX),
    y: Math.min(Math.max(position.y, VIEWPORT_MARGIN), maxY),
  };
}

export function FloatingActualTrackingPanel({
  hasApplyTarget,
  onApplyMeasuredRange,
  onClose,
  targetLabel,
}: FloatingActualTrackingPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const dragOffsetRef = useRef<PanelPosition>({ x: 0, y: 0 });
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current === null) {
      return;
    }

    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }, []);

  useEffect(() => {
    return clearLongPressTimer;
  }, [clearLongPressTimer]);

  useEffect(() => {
    function handleResize() {
      const panel = panelRef.current;
      if (!panel) {
        return;
      }

      setPosition((current) => (current ? clampPosition(current, panel) : current));
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  function startDragging(event: PointerEvent<HTMLDivElement>) {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }

    const rect = panel.getBoundingClientRect();
    dragPointerIdRef.current = event.pointerId;
    dragOffsetRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    setPosition({ x: rect.left, y: rect.top });
    setIsDragging(true);
    panel.setPointerCapture(event.pointerId);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || isInteractiveElement(event.target)) {
      return;
    }

    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      startDragging(event);
    }, LONG_PRESS_MS);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const panel = panelRef.current;
    if (!panel || dragPointerIdRef.current !== event.pointerId) {
      return;
    }

    event.preventDefault();
    setPosition(
      clampPosition(
        {
          x: event.clientX - dragOffsetRef.current.x,
          y: event.clientY - dragOffsetRef.current.y,
        },
        panel,
      ),
    );
  }

  function stopDragging(event: PointerEvent<HTMLDivElement>) {
    clearLongPressTimer();

    const panel = panelRef.current;
    if (panel && dragPointerIdRef.current === event.pointerId) {
      panel.releasePointerCapture(event.pointerId);
    }

    dragPointerIdRef.current = null;
    setIsDragging(false);
  }

  const positionStyle = position
    ? {
        left: `${position.x}px`,
        right: 'auto',
        top: `${position.y}px`,
      }
    : undefined;

  return (
    <div
      ref={panelRef}
      className={
        isDragging
          ? 'floating-tracking-panel dragging print-hide'
          : 'floating-tracking-panel print-hide'
      }
      style={positionStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
    >
      <div className="floating-tracking-panel-header">
        <div>
          <strong>計測補助</strong>
          <span>{targetLabel || 'フローティング表示'}</span>
        </div>
        <button
          className="floating-tracking-close"
          onClick={onClose}
          type="button"
          aria-label="計測補助を閉じる"
        >
          ×
        </button>
      </div>

      <ActualTrackingTools
        onApplyMeasuredRange={onApplyMeasuredRange}
        canApplyMeasuredRange={hasApplyTarget}
        applyDisabledReason="詳細入力を開いている間だけ記録時刻へ反映できます。"
      />
    </div>
  );
}
