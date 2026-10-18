import { useEffect } from 'react';

// Shown while the radial 移動 action has lifted an event: the event itself is
// dragged (no hold needed); the dialog stays one tap away for precise entry.
// Shown at the top so it never covers the timeline events being dragged.
export function ScheduleMoveModeBanner({ title, onOpenDialog, onCancel }: {
  title: string; onOpenDialog: () => void; onCancel: () => void;
}) {
  useEffect(() => {
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener('keydown', cancelOnEscape);
    return () => window.removeEventListener('keydown', cancelOnEscape);
  }, [onCancel]);
  return (
    <div className="app-toast-layer print-hide top schedule-move-mode-layer">
      <div className="app-notice app-toast info schedule-move-mode-banner" role="region" aria-label="予定の移動">
        <span role="status">「{title}」をドラッグして移動先へ</span>
        <button className="app-toast-action" type="button" onClick={onOpenDialog}>日時で指定</button>
        <button className="app-toast-action" type="button" onClick={onCancel}>終了</button>
      </div>
    </div>
  );
}
