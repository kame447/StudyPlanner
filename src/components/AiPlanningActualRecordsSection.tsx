import {
  formatActualRecordRow,
  formatActualRecordsTotal,
  sumActualRecordMinutes,
  SAVING_ACTUAL_RECORDS_LABEL,
  PROVISIONAL_ACTUAL_RECORDS_LABEL,
  PROVISIONAL_ACTUAL_RECORDS_CONFIRMATION_LABEL,
  ACTUAL_RECORDS_REFLECTION_QUESTION,
  SAVE_ACTUAL_RECORDS_BUTTON_LABEL,
  RETRY_ACTUAL_RECORDS_BUTTON_LABEL,
  type PendingWeeklyPlanningActualRecord,
} from '../features/weeklyPlanning/application/weeklyPlanningActualRecords';
import './AiPlanningActualRecordsSection.css';

interface AiPlanningActualRecordsSectionProps {
  records: PendingWeeklyPlanningActualRecord[];
  isSaving: boolean;
  /** Disabled while the conversation is busy or a plan approval is running. */
  disabled: boolean;
  error: string;
  onSave: () => void;
}

/**
 * The study records a conversation proposed, shown for confirmation. Their only save authority is this
 * section's button: no chat reply saves them, and no clock time is shown because none was ever stated.
 */
export function AiPlanningActualRecordsSection({ records, isSaving, disabled, error, onSave }: AiPlanningActualRecordsSectionProps) {
  if (records.length === 0) return null;
  return (
    <section className="ai-planning-actual-records" aria-label={PROVISIONAL_ACTUAL_RECORDS_CONFIRMATION_LABEL}>
      <h3>{PROVISIONAL_ACTUAL_RECORDS_LABEL}</h3>
      <p className="ai-planning-actual-records-note">{isSaving ? SAVING_ACTUAL_RECORDS_LABEL : '時刻なしで、日ごとの勉強時間だけを記録します。'}</p>
      <ul className="ai-planning-actual-records-list">
        {records.map(record => <li key={record.id}>{formatActualRecordRow(record)}</li>)}
      </ul>
      <p className="ai-planning-actual-records-total" aria-label="実績の合計">
        合計 {formatActualRecordsTotal(sumActualRecordMinutes(records))}
      </p>
      {error ? <p className="ai-planning-preview-error" role="alert">{error}</p> : null}
      <p>{ACTUAL_RECORDS_REFLECTION_QUESTION}</p>
      <button
        className="ai-planning-primary-action ai-planning-actual-records-save"
        type="button"
        disabled={disabled || isSaving}
        onClick={() => { if (!disabled && !isSaving) onSave(); }}
      >
        {isSaving ? '保存中...' : error ? RETRY_ACTUAL_RECORDS_BUTTON_LABEL : SAVE_ACTUAL_RECORDS_BUTTON_LABEL}
      </button>
    </section>
  );
}
