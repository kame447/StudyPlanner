import { PLAN_TYPE_OPTIONS } from '../lib/plans';
import { PLAN_REPEAT_OPTIONS } from '../lib/planRecurrence';
import { TimeRangeFields } from './TimeRangeFields';
import type { PlanDraft } from '../types/domain';

interface PlanFieldsEditorProps {
  draft: PlanDraft;
  onChange: (draft: PlanDraft) => void;
  disableDateField?: boolean;
  disableRepeatFields?: boolean;
  timeRangeMode?: 'create' | 'edit';
}

export function PlanFieldsEditor({
  draft,
  onChange,
  disableDateField = false,
  disableRepeatFields = false,
  timeRangeMode = 'create',
}: PlanFieldsEditorProps) {
  function updateField<K extends keyof PlanDraft>(field: K, value: PlanDraft[K]) {
    onChange({
      ...draft,
      [field]: value,
    });
  }

  return (
    <div className="form-grid">
      <div className="field-pair field-full">
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
      </div>

      <div className="field-pair field-full">
        <label className="field">
          <span>日付</span>
          <input
            type="date"
            value={draft.date}
            onChange={(event) => updateField('date', event.target.value)}
            disabled={disableDateField}
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
      </div>

      <div className="field-pair field-full">
        <TimeRangeFields
          startTime={draft.startTime}
          endTime={draft.endTime}
          mode={timeRangeMode}
          onChange={(range) =>
            onChange({
              ...draft,
              startTime: range.startTime,
              endTime: range.endTime,
            })
          }
        />
      </div>

      <div className="field-pair field-full">
        <label className="field">
          <span>繰り返し</span>
          <select
            value={draft.repeat}
            onChange={(event) =>
              updateField('repeat', event.target.value as PlanDraft['repeat'])
            }
            disabled={disableRepeatFields}
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
            disabled={disableRepeatFields || draft.repeat === 'none'}
          />
        </label>
      </div>

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
