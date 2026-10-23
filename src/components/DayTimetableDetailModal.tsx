import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { ScheduleOccurrence } from '../domain/scheduleOccurrence';
import type { DayTimetableTimeChange } from '../domain/dayTimetableTimeEdit';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { useExitMotion } from '../hooks/useExitMotion';
import { formatDateLabel } from '../lib/date';
import { dayOccurrenceCancellationPresentation } from '../lib/dayOccurrenceCancellationPresentation';

// Keep projected template identity separate from saved Plan mutation targets.
export function DayTimetableDetailModal({ occurrence, onClose, onOpenTimetable, onDeleteOccurrence, onSaveTime, onPrepareRecord }: {
  occurrence: ScheduleOccurrence;
  onClose: () => void;
  onPrepareRecord?: () => Promise<void>;
  onOpenTimetable?: () => void;
  onDeleteOccurrence?: () => Promise<void>;
  onSaveTime?: (occurrence: ScheduleOccurrence, time: DayTimetableTimeChange) => Promise<void>;
}) {
  const deletion = dayOccurrenceCancellationPresentation(occurrence);
  const [edit, setEdit] = useState<(DayTimetableTimeChange & { occurrence: ScheduleOccurrence }) | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState<'save' | 'delete' | 'record' | null>(null);
  const pending = useRef<object | null>(null);
  const leaving = useRef(false);
  const active = useRef(false);
  useLayoutEffect(() => { active.current = true; return () => { active.current = false; pending.current = null; }; }, []);
  const { isExiting, requestExit } = useExitMotion(onClose);
  const close = () => { if (active.current && !pending.current && !leaving.current) { leaving.current = true; requestExit(); } };
  const { dialogRef, initialFocusRef } = useDialogFocus<HTMLElement>(true, close);
  const disabled = working !== null || isExiting;
  async function run(kind: 'save' | 'delete' | 'record', action: () => Promise<void>) {
    if (!active.current || pending.current || leaving.current) return;
    const attempt = {};
    pending.current = attempt;
    setWorking(kind); setError('');
    try { await action(); }
    catch (error) {
      if (pending.current === attempt) {
        pending.current = null; setWorking(null);
        setError(error instanceof Error ? error.message : '予定を変更できませんでした。もう一度試してください。');
      }
      return;
    }
    if (pending.current === attempt) { pending.current = null; if (kind !== 'record') close(); }
  }
  return createPortal(
    <div className={`overlay modal-overlay daily-detail-modal-overlay schedule-action-overlay bottom-sheet-motion ${isExiting ? 'is-closing' : 'is-open'}`}
      style={{ paddingBottom: 'calc(var(--primary-nav-height, 74px) + env(safe-area-inset-bottom, 0px) + 12px)' }} onClick={close}>
      <section ref={dialogRef} tabIndex={-1} className="modal-card daily-detail-modal schedule-action-sheet"
        role="dialog" aria-modal="true" aria-label={`${occurrence.title}の詳細`} onClick={event => event.stopPropagation()}>
        <div className="schedule-action-topline">
          <button ref={node => { initialFocusRef.current = node; }} className="schedule-action-close" type="button" aria-label="閉じる"
            disabled={disabled} onClick={close}><X aria-hidden="true" size={22} /></button>
          <div><strong>{occurrence.title}</strong><span>{occurrence.subject}</span></div>
        </div>
        <div className="section-stack">
          <p>{formatDateLabel(occurrence.start.date)} {occurrence.start.time} - {occurrence.end.date !== occurrence.start.date ? `${formatDateLabel(occurrence.end.date)} ` : ''}{occurrence.end.time}</p>
          {edit && onSaveTime ? <form className="section-stack" aria-label="この日の時間を変更" onSubmit={event => {
            event.preventDefault(); void run('save', () => onSaveTime(edit.occurrence, { startTime: edit.startTime, endTime: edit.endTime }));
          }}>
            <div className="day-timetable-time-fields">
              <label className="field"><span>開始</span><input type="time" value={edit.startTime} required disabled={disabled}
                onChange={event => setEdit({ ...edit, startTime: event.target.value })} /></label>
              <label className="field"><span>終了</span><input type="time" value={edit.endTime} required disabled={disabled}
                onChange={event => setEdit({ ...edit, endTime: event.target.value })} /></label>
            </div>
            <button className="primary-button" type="submit" disabled={disabled}>{working === 'save' ? '保存中…' : 'この日だけ保存'}</button>
            <button className="ghost-button" type="button" disabled={disabled} onClick={() => {
              if (!pending.current && !leaving.current) { setEdit(null); setError(''); }
            }}>キャンセル</button>
          </form> : <>
            {onPrepareRecord ? <button className="primary-button" type="button" disabled={disabled}
              onClick={() => void run('record', onPrepareRecord)}>{working === 'record' ? '予定に反映中…' : '予定に反映して記録'}</button> : null}
            {onSaveTime ? <button className="primary-button" type="button" disabled={disabled} onClick={() => {
              if (!pending.current && !leaving.current) {
                setError(''); setEdit({ occurrence, startTime: occurrence.start.time, endTime: occurrence.end.time });
              }
            }}>この日の時間を変更</button> : null}
            {onDeleteOccurrence && deletion.description ? <p>{deletion.description}</p> : null}
            {onDeleteOccurrence ? <button className="ghost-button danger-button day-timetable-delete-button" type="button" disabled={disabled}
              onClick={() => void run('delete', onDeleteOccurrence)}>{working === 'delete' ? '削除中…' : deletion.label}</button> : null}
            {onOpenTimetable ? <button className="ghost-button" type="button" disabled={disabled}
              onClick={() => { if (!active.current || pending.current || leaving.current) return; leaving.current = true; onClose(); onOpenTimetable(); }}>時間割を開く</button> : null}
          </>}
          {error ? <p className="inline-error" role="alert">{error}</p> : null}
        </div>
      </section>
    </div>, document.body,
  );
}
