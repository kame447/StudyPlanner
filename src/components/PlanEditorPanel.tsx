import { minutesBetween } from '../lib/date';
import { PlanFieldsEditor } from './PlanFieldsEditor';
import type { PlanDraft } from '../types/domain';

interface PlanEditorPanelProps {
  draft: PlanDraft | null;
  submitLabel: string;
  heading: string;
  onChange: (draft: PlanDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function PlanEditorPanel({
  draft,
  submitLabel,
  heading,
  onChange,
  onSubmit,
  onCancel,
}: PlanEditorPanelProps) {
  if (!draft) {
    return null;
  }

  const hasInvalidTime =
    minutesBetween(draft.startTime, draft.endTime) <= 0;

  return (
    <div className="overlay">
      <aside className="drawer">
        <div className="section-header">
          <div>
            <h2>{heading}</h2>
            <p>入力項目は最小限に絞っています。</p>
          </div>
          <button className="ghost-button" onClick={onCancel} type="button">
            閉じる
          </button>
        </div>

        <PlanFieldsEditor draft={draft} onChange={onChange} />

        {hasInvalidTime ? (
          <p className="inline-error">終了時刻は開始時刻より後にしてください。</p>
        ) : null}

        <div className="drawer-actions">
          <button className="ghost-button" onClick={onCancel} type="button">
            キャンセル
          </button>
          <button
            className="primary-button"
            onClick={onSubmit}
            type="button"
            disabled={hasInvalidTime || !draft.title.trim()}
          >
            {submitLabel}
          </button>
        </div>
      </aside>
    </div>
  );
}
