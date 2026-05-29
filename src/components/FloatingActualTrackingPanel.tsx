import { useEffect, useRef, useState, type PointerEvent } from 'react';
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

const VIEWPORT_MARGIN = 8;

function isInteractiveElement(target: EventTarget | null): boolean {
  return target instanceof Element
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
  const dragPointerIdRef = useRef<number | null>(null);
  const dragOffsetRef = useRef<PanelPosition>({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [trackingDisplay, setTrackingDisplay] = useState('00:00:00');

  useEffect(() => {
    return () => {
      dragPointerIdRef.current = null;
      isDraggingRef.current = false;
    };
  }, []);

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

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || isInteractiveElement(event.target)) {
      event.stopPropagation();
      return;
    }

    const panel = panelRef.current;
    if (!panel) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const rect = panel.getBoundingClientRect();
    dragPointerIdRef.current = event.pointerId;
    dragOffsetRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    setPosition({ x: rect.left, y: rect.top });
    panel.setPointerCapture(event.pointerId);
    isDraggingRef.current = true;
    setIsDragging(true);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const panel = panelRef.current;
    if (!panel || dragPointerIdRef.current !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (!isDraggingRef.current) {
      return;
    }

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
    if (dragPointerIdRef.current !== event.pointerId) {
      event.stopPropagation();
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const panel = panelRef.current;
    if (
      panel &&
      dragPointerIdRef.current === event.pointerId &&
      panel.hasPointerCapture(event.pointerId)
    ) {
      panel.releasePointerCapture(event.pointerId);
    }

    dragPointerIdRef.current = null;
    isDraggingRef.current = false;
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
    <>
      {isDragging ? (
        <div className="floating-tracking-event-shield print-hide" aria-hidden="true" />
      ) : null}
      <div
        ref={panelRef}
        className={
          isDragging
            ? `floating-tracking-panel dragging${isCollapsed ? ' collapsed' : ''} print-hide`
            : `floating-tracking-panel${isCollapsed ? ' collapsed' : ''} print-hide`
        }
        style={positionStyle}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      >
        <div className="floating-tracking-panel-header">
          <button
            className="floating-tracking-collapse"
            onClick={(event) => {
              event.stopPropagation();
              setIsCollapsed((current) => !current);
            }}
            type="button"
            aria-label={isCollapsed ? '計測補助を展開' : '計測補助を折りたたむ'}
          >
            {isCollapsed ? '＋' : '−'}
          </button>
          <div className="floating-tracking-panel-title">
            <strong>計測補助</strong>
            <span>
              {isCollapsed
                ? `${trackingDisplay}${targetLabel ? ` / ${targetLabel}` : ''}`
                : targetLabel || 'フローティング表示'}
            </span>
          </div>
          <button
            className="floating-tracking-close"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            type="button"
            aria-label="計測補助を閉じる"
          >
            ×
          </button>
        </div>

        <div className="floating-tracking-panel-body" hidden={isCollapsed}>
          <ActualTrackingTools
            onApplyMeasuredRange={onApplyMeasuredRange}
            canApplyMeasuredRange={hasApplyTarget}
            applyDisabledReason="反映先がありません。詳細入力から計測補助を開いてください。"
            onDisplayChange={setTrackingDisplay}
          />
        </div>
      </div>
    </>
  );
}
