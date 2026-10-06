import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { ScheduleOccurrence } from '../domain/scheduleOccurrence';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { useExitMotion } from '../hooks/useExitMotion';
import { formatDateLabel } from '../lib/date';

// Template occurrences are a read-only projection, not saved Plans/MonthEvents.
// Keep this surface separate so it cannot send synthetic IDs into mutation APIs.
export function DayTimetableDetailModal({ occurrence, onClose, onOpenTimetable }: {
  occurrence: ScheduleOccurrence;
  onClose: () => void;
  onOpenTimetable?: () => void;
}) {
  const { isExiting, requestExit } = useExitMotion(onClose);
  const { dialogRef, initialFocusRef } = useDialogFocus<HTMLElement>(true, () => requestExit());
  return createPortal(
    <div className={`overlay modal-overlay daily-detail-modal-overlay schedule-action-overlay bottom-sheet-motion ${isExiting ? 'is-closing' : 'is-open'}`}
      style={{ paddingBottom: 'calc(var(--primary-nav-height, 74px) + env(safe-area-inset-bottom, 0px) + 12px)' }}
      onClick={() => requestExit()}>
      <section ref={dialogRef} tabIndex={-1} className="modal-card daily-detail-modal schedule-action-sheet"
        role="dialog" aria-modal="true" aria-label={`${occurrence.title}の詳細`} onClick={event => event.stopPropagation()}>
        <div className="schedule-action-topline">
          <button ref={node => { initialFocusRef.current = node; }} className="schedule-action-close" type="button" aria-label="閉じる" onClick={() => requestExit()}>
            <X aria-hidden="true" size={22} />
          </button>
          <div><strong>{occurrence.title}</strong><span>{occurrence.subject}</span></div>
        </div>
        <div className="section-stack">
          <p>{formatDateLabel(occurrence.start.date)} {occurrence.start.time} - {occurrence.end.date !== occurrence.start.date ? `${formatDateLabel(occurrence.end.date)} ` : ''}{occurrence.end.time}</p>
          <p>時間割から表示しています。内容の変更は時間割で行えます。</p>
          {onOpenTimetable ? <button className="primary-button" type="button" disabled={isExiting}
            onClick={() => { onClose(); onOpenTimetable(); }}>時間割を開く</button> : null}
        </div>
      </section>
    </div>, document.body,
  );
}
