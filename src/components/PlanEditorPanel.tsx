import { minutesBetween } from '../lib/date';
import { PlanFieldsEditor } from './PlanFieldsEditor';
import type { PlanDraft } from '../types/domain';

interface PlanEditorPanelProps {
  draft: PlanDraft | null;
  submitLabel: string;
  heading: string;
  recurringEditMode?: boolean;
  onChange: (draft: PlanDraft) => void;
  onSubmit: () => void | Promise<void>;
  onCancel: () => void;
}

export function PlanEditorPanel({
  draft,
  submitLabel,
  heading,
  recurringEditMode = false,
  onChange,
  onSubmit,
  onCancel,
}: PlanEditorPanelProps) {
  if (!draft) {
    return null;
  }

  const currentDraft = draft;

  const hasInvalidTime =
    minutesBetween(currentDraft.startTime, currentDraft.endTime) <= 0;

  async function handleSubmit() {
    if (hasInvalidTime || !currentDraft.title.trim()) {
      return;
    }

    try {
      await onSubmit();
      onCancel();
    } catch {
      // Keep the editor open; the data layer already reports the failure.
    }
  }

  return (
    <div className="overlay modal-overlay">
      <aside className="modal-card plan-editor-modal">
        <div className="section-stack">
          <div className="section-header">
            <div>
              <h2>{heading}</h2>
              <p>入力項目は最小限に絞っています。</p>
            </div>
            <button className="ghost-button" onClick={onCancel} type="button">
              閉じる
            </button>
          </div>

          {recurringEditMode ? (
            <div className="assistant-feedback-card">
              <strong>繰り返し予定を編集中です</strong>
              <p className="detail-note">
                保存時に適用範囲を選びます。初期対応では日付と繰り返し条件の直接変更は無効です。
              </p>
            </div>
          ) : null}

          <PlanFieldsEditor
            draft={currentDraft}
            onChange={onChange}
            disableDateField={recurringEditMode}
            disableRepeatFields={recurringEditMode}
          />

          {hasInvalidTime ? (
            <p className="inline-error">終了時刻は開始時刻より後にしてください。</p>
          ) : null}

          <div className="drawer-actions">
            <button className="ghost-button" onClick={onCancel} type="button">
              キャンセル
            </button>
            <button
              className="primary-button"
              onClick={handleSubmit}
              type="button"
              disabled={hasInvalidTime || !currentDraft.title.trim()}
            >
              {submitLabel}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
