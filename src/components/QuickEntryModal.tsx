import { useState, type FormEvent } from 'react';
import { minutesFromTime, timeFromMinutes } from '../lib/date';
import { getRecurrenceWeekday } from '../lib/planRecurrence';
import { PLAN_TYPE_OPTIONS } from '../lib/plans';
import { NaturalLanguageAssistant } from './NaturalLanguageAssistant';
import type {
  Plan,
  PlanDraft,
  PlanType,
  RecurrenceRule,
  RecurrenceWeekday,
  TodoTaskDraft,
} from '../types/domain';

type QuickEntryMode = 'later' | 'scheduled' | 'repeat';
type QuickEntryInputMethod = 'ai' | 'manual';

interface QuickEntryModalProps {
  userId: string;
  selectedDate: string;
  plans: Plan[];
  onClose: () => void;
  onSaveTodo: (draft: TodoTaskDraft) => Promise<void>;
  onSavePlan: (draft: PlanDraft, targetPlanId?: string) => Promise<void>;
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

const WEEKDAY_OPTIONS: Array<{ value: RecurrenceWeekday; label: string }> = [
  { value: 'mon', label: '月' },
  { value: 'tue', label: '火' },
  { value: 'wed', label: '水' },
  { value: 'thu', label: '木' },
  { value: 'fri', label: '金' },
  { value: 'sat', label: '土' },
  { value: 'sun', label: '日' },
];

function getModeIcon(mode: QuickEntryMode): string {
  if (mode === 'scheduled') {
    return '○';
  }

  if (mode === 'repeat') {
    return '↻';
  }

  return '✓';
}

export function QuickEntryModal({
  userId,
  selectedDate,
  plans,
  onClose,
  onSaveTodo,
  onSavePlan,
}: QuickEntryModalProps) {
  const [inputMethod, setInputMethod] = useState<QuickEntryInputMethod>('manual');
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
  const [weekday, setWeekday] = useState<RecurrenceWeekday>(() =>
    getRecurrenceWeekday(selectedDate),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canSave =
    inputMethod === 'manual' &&
    title.trim().length > 0 &&
    !isSubmitting &&
    (mode === 'later' ||
      (mode === 'scheduled' && estimatedMinutes !== null) ||
      (mode === 'repeat' &&
        estimatedMinutes !== null &&
        (repeatKind === 'daily' || repeatKind === 'weekly')));

  function resolveEndTime(): string {
    const startMinutes = minutesFromTime(startTime);
    const endMinutes = Math.min(startMinutes + (estimatedMinutes ?? 60), 23 * 60 + 59);
    return timeFromMinutes(endMinutes);
  }

  function buildRepeatRule(endTime: string): RecurrenceRule {
    return {
      id: 'recurrence-base',
      kind: repeatKind === 'weekly' ? 'weekday' : 'daily',
      startDate: date,
      until: null,
      dates: [],
      weekdays: repeatKind === 'weekly' ? [weekday] : [],
      dayType: null,
      startTime,
      endTime,
      title: title.trim(),
      subject: subject.trim() || undefined,
      type,
      memo: memo.trim() || undefined,
      isOverride: false,
    };
  }

  function renderDurationCard() {
    return (
      <section className="quick-entry-card">
        <div className="quick-entry-card-head">
          <span className="quick-entry-card-icon" aria-hidden="true">
            ○
          </span>
          <h3>所要時間</h3>
        </div>
        <div className="quick-entry-chip-row">
          {DURATION_OPTIONS.map((option) => (
            <button
              className={
                estimatedMinutes === option.value
                  ? 'quick-entry-chip active'
                  : 'quick-entry-chip'
              }
              key={option.label}
              onClick={() => setEstimatedMinutes(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSave) {
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'scheduled' || mode === 'repeat') {
        const endTime = resolveEndTime();
        const recurrenceRules =
          mode === 'repeat' ? [buildRepeatRule(endTime)] : [];

        await onSavePlan({
          userId,
          title: title.trim(),
          subject: subject.trim(),
          date,
          startTime,
          endTime,
          repeat:
            mode === 'repeat'
              ? repeatKind === 'weekly'
                ? 'weekly'
                : 'daily'
              : 'none',
          repeatUntil: null,
          excludedDates: [],
          recurrenceRules,
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
          <button
            className="ghost-button quick-entry-close-button"
            onClick={onClose}
            type="button"
          >
            閉じる
          </button>
          <button
            className="primary-button quick-entry-save-button"
            disabled={!canSave}
            type="submit"
          >
            保存
          </button>
        </div>

        <div className="segmented-control quick-entry-input-method-tabs">
          {(
            [
              ['ai', 'AI入力'],
              ['manual', '手動入力'],
            ] as const
          ).map(([value, label]) => (
            <button
              className={inputMethod === value ? 'segment active' : 'segment'}
              key={value}
              onClick={() => setInputMethod(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

        {inputMethod === 'ai' ? (
          <section className="quick-entry-ai-panel">
            <NaturalLanguageAssistant
              selectedDate={selectedDate}
              userId={userId}
              plans={plans}
              onApplyDraft={onSavePlan}
              embedded
            />
          </section>
        ) : (
          <div className="quick-entry-manual-panel">
            <section className="quick-entry-title-card">
              <span className="quick-entry-title-icon" aria-hidden="true">
                {getModeIcon(mode)}
              </span>
              <label className="quick-entry-title-field">
                <span>
                  {MODE_OPTIONS.find((option) => option.value === mode)?.label}
                </span>
                <input
                  autoFocus
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="タスク名を入力"
                />
              </label>
            </section>

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
              <section className="quick-entry-card quick-entry-memo-card">
                <label className="field">
                  <span>メモ</span>
                  <textarea
                    rows={2}
                    value={memo}
                    onChange={(event) => setMemo(event.target.value)}
                    placeholder="メモを追加"
                  />
                </label>
              </section>

              <section className="quick-entry-card">
                <div className="quick-entry-card-head">
                  <span className="quick-entry-card-icon" aria-hidden="true">
                    #
                  </span>
                  <h3>分類</h3>
                </div>
                <div className="form-grid compact quick-entry-compact-grid">
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
              </section>

              {mode === 'later' ? (
                <>
                  <section className="quick-entry-card">
                    <div className="quick-entry-card-head">
                      <span className="quick-entry-card-icon" aria-hidden="true">
                        !
                      </span>
                      <h3>締切</h3>
                    </div>
                    <label className="field">
                      <span>日付</span>
                      <input
                        type="date"
                        value={dueDate}
                        onChange={(event) => setDueDate(event.target.value)}
                      />
                    </label>
                  </section>
                  {renderDurationCard()}
                </>
              ) : null}

              {mode === 'scheduled' ? (
                <>
                  <section className="quick-entry-card">
                    <div className="quick-entry-card-head">
                      <span className="quick-entry-card-icon" aria-hidden="true">
                        D
                      </span>
                      <h3>日付と開始時刻</h3>
                    </div>
                    <div className="form-grid compact quick-entry-compact-grid">
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
                  </section>
                  {renderDurationCard()}
                </>
              ) : null}

              {mode === 'repeat' ? (
                <>
                  <section className="quick-entry-card">
                    <div className="quick-entry-card-head">
                      <span className="quick-entry-card-icon" aria-hidden="true">
                        ↻
                      </span>
                      <h3>繰り返し</h3>
                    </div>
                    <div className="quick-entry-chip-row">
                      {(
                        [
                          ['daily', '毎日'],
                          ['weekly', '毎週'],
                          ['monthly', '毎月'],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          className={
                            repeatKind === value
                              ? 'quick-entry-chip active'
                              : 'quick-entry-chip'
                          }
                          key={value}
                          onClick={() => setRepeatKind(value)}
                          type="button"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {repeatKind === 'weekly' ? (
                      <div className="quick-entry-weekdays">
                        <span>曜日</span>
                        <div className="quick-entry-chip-row">
                          {WEEKDAY_OPTIONS.map((option) => (
                            <button
                              className={
                                weekday === option.value
                                  ? 'quick-entry-weekday-chip active'
                                  : 'quick-entry-weekday-chip'
                              }
                              key={option.value}
                              onClick={() => setWeekday(option.value)}
                              type="button"
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </section>

                  <section className="quick-entry-card">
                    <div className="quick-entry-card-head">
                      <span className="quick-entry-card-icon" aria-hidden="true">
                        D
                      </span>
                      <h3>開始</h3>
                    </div>
                    <div className="form-grid compact quick-entry-compact-grid">
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
                  </section>
                  {renderDurationCard()}
                </>
              ) : null}
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
