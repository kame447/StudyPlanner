import { useLayoutEffect, useRef, useState } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { supportsScopedRecurringPlanEdits } from '../domain/recurringPlan';
import { scheduleMoveTarget } from '../lib/scheduleItemActions';
import type { WeekPlanMoveTarget } from '../lib/weekPlanDrag';
import type { Plan } from '../types/domain';

export function ScheduleMoveDialog({ plan, onMove, onClose }: {
  plan: Plan; onMove: (plan: Plan, target: WeekPlanMoveTarget) => Promise<void>; onClose: () => void;
}) {
  const [date, setDate] = useState(plan.occurrenceDate ?? plan.date);
  const [startTime, setStartTime] = useState(plan.startTime);
  const [pending, setPending] = useState(false);
  const attemptRef = useRef<object | null>(null);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    attemptRef.current = null;
    setDate(plan.occurrenceDate ?? plan.date); setStartTime(plan.startTime); setPending(false); setError('');
    return () => { mounted.current = false; attemptRef.current = null; };
  }, [plan]);
  const [error, setError] = useState('');
  const close = () => { if (mounted.current && !attemptRef.current) onClose(); };
  const { dialogRef } = useDialogFocus<HTMLElement>(true, close);
  const target = scheduleMoveTarget(plan, date, startTime);
  return <div className="overlay modal-overlay" onClick={close}>
    <section ref={dialogRef} className="modal-card" role="dialog" aria-modal="true" aria-label={`${plan.title}を移動`} tabIndex={-1} onClick={event => event.stopPropagation()}>
      <h2>予定を移動</h2>
      <form className="section-stack" onSubmit={async event => {
        event.preventDefault();
        if (!target || !mounted.current || attemptRef.current) return;
        const attempt = {};
        attemptRef.current = attempt; setPending(true); setError('');
        const isCurrent = () => mounted.current && attemptRef.current === attempt;
        try { await onMove(plan, target); if (isCurrent()) onClose(); }
        catch (caught) { if (isCurrent()) setError(caught instanceof Error ? caught.message : '予定を移動できませんでした'); }
        finally { if (isCurrent()) { attemptRef.current = null; setPending(false); } }
      }}>
        <label>日付<input type="date" value={date} required disabled={pending || supportsScopedRecurringPlanEdits(plan)} onChange={event => setDate(event.target.value)} /></label>
        {supportsScopedRecurringPlanEdits(plan) ? <p>繰り返し予定は同じ日の時刻を変更します。</p> : null}
        <label>開始時刻<input type="time" value={startTime} required disabled={pending} onChange={event => setStartTime(event.target.value)} /></label>
        <p>終了時刻: {target?.endTime ?? '—'}（長さは変わりません）</p>
        {error ? <p role="alert" className="inline-error">{error}</p> : null}
        <div className="button-row"><button type="button" className="secondary-button" disabled={pending} onClick={close}>キャンセル</button>
          <button type="submit" className="primary-button" disabled={pending || !target}>{pending ? '移動中…' : '移動する'}</button></div>
      </form>
    </section>
  </div>;
}
