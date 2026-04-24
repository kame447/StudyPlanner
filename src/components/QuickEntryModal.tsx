import { useState, type FormEvent } from 'react';
import { minutesFromTime, timeFromMinutes } from '../lib/date';
import { PLAN_TYPE_OPTIONS } from '../lib/plans';
import type { PlanDraft, PlanType, TodoTaskDraft } from '../types/domain';

type QuickEntryMode = 'later' | 'scheduled' | 'repeat';

interface QuickEntryModalProps {
  userId: string;
  selectedDate: string;
  onClose: () => void;
  onSaveTodo: (draft: TodoTaskDraft) => Promise<void>;
  onSavePlan: (draft: PlanDraft) => Promise<void>;
}

const MODE_OPTIONS: Array<{ value: QuickEntryMode; label: string }> = [
  { value: 'later', label: 'あとで' },
  { value: 'scheduled', label: '時間指定' },
  { value: 'repeat', label: '繰り返し' },
];

const DURATION_OPTIONS = [
  { value: null, label: 'なし' },
  { value: 15, label: '15分' },
  { value: 30, label: '30分' },
  { value: 45, label: '45分' },
  { value: 60, label: '60分' },
  { value: 90, label: '90分' },
] as const;

export function QuickEntryModal({
  userId,
  selectedDate,
  onClose,
  onSaveTodo,
  onSavePlan,
}: QuickEntryModalProps) {
  const [mode, setMode] = useState<QuickEntryMode>('later');
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [type, setType] = useState<PlanType>('study');
  const [estimatedMinutes, setEstimatedMinutes] = useState<number | null>(null);
  const [dueDate, setDueDate] = useState<string>('');
  const [memo, setMemo] = useState('');
  const [date, setDate] = useState(selectedDate);
  const [startTime, setStartTime] = useState('19:00');
  const [repeatKind, setRepeatKind] = useState<'daily' | 'weekly' | 'monthly'>(
    'daily',
  );
  const [weekday, setWeekday] = useState('mon');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canSave =
    title.trim().length > 0 &&
    !isSubmitting &&
    (mode === 'later' || (mode === 'scheduled' && estimatedMinutes !== null));

  function resolveEndTime(): string {
    const startMinutes = minutesFromTime(startTime);
    const endMinutes = Math.min(startMinutes + (estimatedMinutes ?? 60), 23 * 60 + 59);
    return timeFromMinutes(endMinutes);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSave) {
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'scheduled') {
        await onSavePlan({
          userId,
          title: title.trim(),
          subject: subject.trim(),
          date,
          startTime,
          endTime: resolveEndTime(),
          repeat: 'none',
          repeatUntil: null,
          excludedDates: [],
          recurrenceRules: [],
          type,
          memo: memo.trim(),
          sourceType: 'manual',
          sourceId: null,
        });
      } else {
        await onSaveTodo({
          userId,
          title: title.trim(),
          subject: subject.trim(),
          type,
          estimatedMinutes,
          dueDate: dueDate || null,
          memo: memo.trim(),
        });
      }
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="overlay modal-overlay" onClick={onClose}>
      <form
        className="modal-card quick-entry-modal"
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="quick-entry-header">
          <button className="ghost-button" onClick={onClose} type="button">
            閉じる
          </button>
          <button className="primary-button" disabled={!canSave} type="submit">
            保存
          </button>
        </div>

        <label className="field quick-entry-title-field">
          <span>タイトル</span>
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="タスク名"
          />
        </label>

        <div className="segmented-control quick-entry-mode-tabs">
          {MODE_OPTIONS.map((option) => (
            <button
              className={mode === option.value ? 'segment active' : 'segment'}
              key={option.value}
              onClick={() => setMode(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="quick-entry-body">
          <div className="form-grid compact">
            <label className="field">
              <span>教科</span>
              <input
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="数学"
              />
            </label>

            <label className="field">
              <span>種別</span>
              <select
                value={type}
                onChange={(event) => setType(event.target.value as PlanType)}
              >
                {PLAN_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="quick-entry-duration-group">
            <span>所要時間</span>
            <div className="quick-entry-duration-options">
              {DURATION_OPTIONS.map((option) => (
                <button
                  className={
                    estimatedMinutes === option.value
                      ? 'quick-entry-duration-chip active'
                      : 'quick-entry-duration-chip'
                  }
                  key={option.label}
                  onClick={() => setEstimatedMinutes(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {mode === 'later' ? (
            <label className="field">
              <span>締切</span>
              <input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </label>
          ) : null}

          {mode === 'scheduled' ? (
            <div className="form-grid compact">
              <label className="field">
                <span>日付</span>
                <input
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </label>
              <label className="field">
                <span>開始時刻</span>
                <input
                  type="time"
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                />
              </label>
            </div>
          ) : null}

          {mode === 'repeat' ? (
            <div className="form-grid compact">
              <label className="field">
                <span>繰り返し</span>
                <select
                  value={repeatKind}
                  onChange={(event) =>
                    setRepeatKind(event.target.value as 'daily' | 'weekly' | 'monthly')
                  }
                >
                  <option value="daily">毎日</option>
                  <option value="weekly">毎週</option>
                  <option value="monthly">毎月</option>
                </select>
              </label>
              {repeatKind === 'weekly' ? (
                <label className="field">
                  <span>曜日</span>
                  <select
                    value={weekday}
                    onChange={(event) => setWeekday(event.target.value)}
                  >
                    <option value="mon">月</option>
                    <option value="tue">火</option>
                    <option value="wed">水</option>
                    <option value="thu">木</option>
                    <option value="fri">金</option>
                    <option value="sat">土</option>
                    <option value="sun">日</option>
                  </select>
                </label>
              ) : null}
              <label className="field">
                <span>開始日</span>
                <input
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </label>
              <label className="field">
                <span>開始時刻</span>
                <input
                  type="time"
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                />
              </label>
            </div>
          ) : null}

          <label className="field">
            <span>メモ</span>
            <textarea
              rows={3}
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
            />
          </label>
        </div>
      </form>
    </div>
  );
}
