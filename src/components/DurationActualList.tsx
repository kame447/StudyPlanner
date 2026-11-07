import { useLayoutEffect, useRef, useState } from 'react';
import { ActualMutationAdmissionError } from '../hooks/useActualMutationAdmission';
import { getActualDurationMinutes } from '../lib/actualDuration';
import { formatActualRecordMinutes, formatActualRecordsTotal } from '../features/weeklyPlanning/application/weeklyPlanningActualRecords';
import type { Actual, DurationActual } from '../types/domain';

/** Day-view rows for actuals that state only a length ("時刻なし ○分"). They have no clock times, so they are listed here
 *  and never drawn on the time-of-day timeline. */
export function DurationActualList({ actuals, onSelect }: {
  actuals: readonly DurationActual[];
  onSelect: (actual: DurationActual) => void;
}) {
  if (actuals.length === 0) return null;
  const total = actuals.reduce((sum, actual) => sum + getActualDurationMinutes(actual), 0);
  return (
    <section className="duration-actual-list" aria-label="時刻なしの記録">
      <div className="duration-actual-list-head">
        <strong>時刻なしの記録</strong>
        <span>合計 {formatActualRecordsTotal(total)}</span>
      </div>
      <ul>
        {actuals.map((actual) => (
          <li key={actual.id}>
            <button type="button" className="duration-actual-row" onClick={() => onSelect(actual)}>
              <span>時刻なし</span>
              <strong>{formatActualRecordMinutes(getActualDurationMinutes(actual))}</strong>
              <span>{[actual.subject.trim(), actual.title?.trim()].filter(Boolean).join(' / ') || '記録'}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The existing standalone editor edits clock times, which this record does not have: it is shown and may be deleted. */
export function DurationActualDetail({ actual, onDeleteActual, onClose, onPendingChange }: {
  actual: DurationActual;
  onDeleteActual: (actual: Actual) => Promise<void>;
  onClose: () => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const pending = useRef(false);
  const observer = useRef(onPendingChange);
  useLayoutEffect(() => { observer.current = onPendingChange; }, [onPendingChange]);
  useLayoutEffect(() => () => { pending.current = false; observer.current?.(false); }, []);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleDelete() {
    if (pending.current) return;
    pending.current = true;
    setIsSubmitting(true);
    observer.current?.(true);
    setError('');
    try {
      await onDeleteActual(actual);
    } catch (failure) {
      pending.current = false;
      setIsSubmitting(false);
      observer.current?.(false);
      setError(failure instanceof ActualMutationAdmissionError ? failure.message : '削除できませんでした。もう一度試してください。');
      return;
    }
    onClose();
  }

  return (
    <article className="plan-detail-card actual-editor-card standalone-actual-editor-card duration-actual-detail">
      <div className="plan-detail-head actual-editor-head">
        <div>
          <div className="label-row">
            <strong>{actual.title?.trim() || actual.subject.trim() || '記録'}</strong>
            <span className="type-badge">時刻なし</span>
          </div>
          <p className="comparison-subtitle">
            記録 {actual.occurrenceDate} / {formatActualRecordMinutes(getActualDurationMinutes(actual))}
            {actual.subject ? ` / ${actual.subject}` : ''}
          </p>
        </div>
        <div className="row-actions actual-editor-head-actions">
          <button
            className="ghost-button danger"
            disabled={isSubmitting}
            onClick={() => { if (!pending.current && window.confirm('この記録を削除しますか？')) void handleDelete(); }}
            type="button"
          >
            記録を削除
          </button>
        </div>
      </div>
      {actual.note ? <p className="comparison-subtitle">{actual.note}</p> : null}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </article>
  );
}
