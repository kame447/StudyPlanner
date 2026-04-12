import { PLAN_TYPE_OPTIONS } from '../lib/plans';
import { PLAN_REPEAT_OPTIONS } from '../lib/planRecurrence';
import type { PlanDraft } from '../types/domain';

interface PlanFieldsEditorProps {
  draft: PlanDraft;
  onChange: (draft: PlanDraft) => void;
}

export function PlanFieldsEditor({
  draft,
  onChange,
}: PlanFieldsEditorProps) {
  function updateField<K extends keyof PlanDraft>(field: K, value: PlanDraft[K]) {
    onChange({
      ...draft,
      [field]: value,
    });
  }

  return (
    <div className="form-grid">
      <label className="field">
        <span>予定名</span>
        <input
          value={draft.title}
          onChange={(event) => updateField('title', event.target.value)}
          placeholder="例: 数学の勉強"
        />
      </label>

      <label className="field">
        <span>科目</span>
        <input
          value={draft.subject}
          onChange={(event) => updateField('subject', event.target.value)}
          placeholder="例: 数学"
        />
      </label>

      <label className="field">
        <span>日付</span>
        <input
          type="date"
          value={draft.date}
          onChange={(event) => updateField('date', event.target.value)}
        />
      </label>

      <label className="field">
        <span>開始</span>
        <input
          type="time"
          value={draft.startTime}
          onChange={(event) => updateField('startTime', event.target.value)}
        />
      </label>

      <label className="field">
        <span>終了</span>
        <input
          type="time"
          value={draft.endTime}
          onChange={(event) => updateField('endTime', event.target.value)}
        />
      </label>

      <label className="field">
        <span>繰り返し</span>
        <select
          value={draft.repeat}
          onChange={(event) =>
            updateField('repeat', event.target.value as PlanDraft['repeat'])
          }
        >
          {PLAN_REPEAT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>繰り返し終了</span>
        <input
          type="date"
          value={draft.repeatUntil ?? ''}
          onChange={(event) =>
            updateField('repeatUntil', event.target.value || null)
          }
          disabled={draft.repeat === 'none'}
        />
      </label>

      <label className="field">
        <span>種別</span>
        <select
          value={draft.type}
          onChange={(event) =>
            updateField('type', event.target.value as PlanDraft['type'])
          }
        >
          {PLAN_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field field-full">
        <span>メモ</span>
        <textarea
          value={draft.memo}
          onChange={(event) => updateField('memo', event.target.value)}
          rows={3}
          placeholder="必要なら補足を残す"
        />
      </label>
    </div>
  );
}
