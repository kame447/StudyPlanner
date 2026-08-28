import { createPortal } from 'react-dom';
import type { TimelineDragVisualState } from '../hooks/useTimelineDragController';
import '../styles/week-plan-drag.css';

interface TimelineDragOverlayProps {
  visual: TimelineDragVisualState | null;
  placement?: 'schedule' | 'preview';
}

export function TimelineDragOverlay({
  visual,
  placement = 'schedule',
}: TimelineDragOverlayProps) {
  if (!visual || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className={`schedule-week-drag-overlay ${visual.toneClass}`.trim()}
      style={{
        left: visual.overlayX,
        top: visual.overlayY,
        width: visual.width,
        height: visual.height,
        zIndex: placement === 'preview' ? 970 : undefined,
        transform: `translate3d(0, 0, 0) rotate(${visual.tilt}deg) scale(1.04)`,
      }}
      aria-hidden="true"
    >
      <strong>{visual.title}</strong>
      <small>
        {visual.target.startTime}-{visual.target.endTime}
      </small>
      {visual.lockLabel ? (
        <span className="schedule-week-drag-lock">{visual.lockLabel}</span>
      ) : null}
    </div>,
    document.body,
  );
}
