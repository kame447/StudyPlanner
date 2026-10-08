import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { ScheduleOccurrence } from '../domain/scheduleOccurrence';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { useExitMotion } from '../hooks/useExitMotion';
import { formatDateLabel } from '../lib/date';
import { dayOccurrenceCancellationPresentation } from '../lib/dayOccurrenceCancellationPresentation';

// Keep projected template identity separate from saved Plan mutation targets.
export function DayTimetableDetailModal({ occurrence, onClose, onOpenTimetable, onDeleteOccurrence }: {
  occurrence: ScheduleOccurrence;
  onClose: () => void;
  onOpenTimetable?: () => void;
  onDeleteOccurrence?: () => Promise<void>;
}) {
  const deletion = dayOccurrenceCancellationPresentation(occurrence);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const pending = useRef<object | null>(null);
  const leaving = useRef(false);
  const active = useRef(false);
  useLayoutEffect(() => { active.current = true; return () => { active.current = false; pending.current = null; }; }, []);
  const { isExiting, requestExit } = useExitMotion(onClose);
  const close = () => { if (active.current && !pending.current && !leaving.current) { leaving.current = true; requestExit(); } };
  const { dialogRef, initialFocusRef } = useDialogFocus<HTMLElement>(true, close);
  async function remove() {
    if (!active.current || !onDeleteOccurrence || pending.current || leaving.current) return;
    const attempt = {};
    pending.current = attempt;
    setDeleting(true); setError('');
    try { await onDeleteOccurrence(); }
    catch (error) {
      if (pending.current === attempt) {
        pending.current = null; setDeleting(false);
        setError(error instanceof Error ? error.message : 'この日の予定を削除できませんでした。もう一度試してください。');
      }
      return;
    }
    if (pending.current === attempt) { pending.current = null; close(); }
  }
  return createPortal(
    <div className={`overlay modal-overlay daily-detail-modal-overlay schedule-action-overlay bottom-sheet-motion ${isExiting ? 'is-closing' : 'is-open'}`}
      style={{ paddingBottom: 'calc(var(--primary-nav-height, 74px) + env(safe-area-inset-bottom, 0px) + 12px)' }} onClick={close}>
      <section ref={dialogRef} tabIndex={-1} className="modal-card daily-detail-modal schedule-action-sheet"
        role="dialog" aria-modal="true" aria-label={`${occurrence.title}の詳細`} onClick={event => event.stopPropagation()}>
        <div className="schedule-action-topline">
          <button ref={node => { initialFocusRef.current = node; }} className="schedule-action-close" type="button" aria-label="閉じる"
            disabled={deleting || isExiting} onClick={close}><X aria-hidden="true" size={22} /></button>
          <div><strong>{occurrence.title}</strong><span>{occurrence.subject}</span></div>
        </div>
        <div className="section-stack">
          <p>{formatDateLabel(occurrence.start.date)} {occurrence.start.time} - {occurrence.end.date !== occurrence.start.date ? `${formatDateLabel(occurrence.end.date)} ` : ''}{occurrence.end.time}</p>
          <p>時間割から表示しています。内容の変更は時間割で行えます。</p>
          {onDeleteOccurrence && deletion.description ? <p>{deletion.description}</p> : null}
          {onDeleteOccurrence ? <button className="ghost-button danger-button" type="button" disabled={deleting || isExiting}
            onClick={() => void remove()}>{deleting ? '削除中…' : deletion.label}</button> : null}
          {error ? <p className="inline-error" role="alert">{error}</p> : null}
          {onOpenTimetable ? <button className="primary-button" type="button" disabled={deleting || isExiting}
            onClick={() => { if (!active.current || pending.current || leaving.current) return; leaving.current = true; onClose(); onOpenTimetable(); }}>時間割を開く</button> : null}
        </div>
      </section>
    </div>, document.body,
  );
}
