import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  createEmptyMonthEventChecklistItem,
  createEmptyMonthEventDraft,
  createMonthEventDraftFromEvent,
} from '../domain/planner';
import {
  calculateAutoEndTimeForCreate,
  calculateShiftedEndTimeForEdit,
  calculateTimeRangeDurationMinutes,
  formatDateLabel,
  minutesBetween,
  parseTimeToMinutes,
} from '../lib/date';
import {
  doesMonthEventOccurOnDate,
  formatMonthEventTimeRange,
  getPreviousMonthEventOccurrenceDate,
  getMonthEventRepeatLabel,
  MONTH_EVENT_REPEAT_OPTIONS,
  sortMonthEvents,
} from '../lib/monthEvents';
import { DayCalendarDialog } from './DatePickerDialogs';
import { TimeWheelPicker } from './TimeRangeFields';
import type { MonthEvent, MonthEventDraft } from '../types/domain';

interface MonthEventDialogProps {
  openDate: string | null;
  userId: string;
  monthEvents: MonthEvent[];
  initialEventId?: string | null;
  onSave: (draft: MonthEventDraft, targetMonthEventId?: string) => Promise<void>;
  onDelete: (monthEvent: MonthEvent) => Promise<void>;
  onClose: () => void;
}

type MonthEventAddonKey = 'repeat' | 'url' | 'location' | 'memo' | 'checklist';

const MONTH_EVENT_ADDONS: Array<{ key: MonthEventAddonKey; label: string }> = [
  { key: 'repeat', label: '繰り返し' },
  { key: 'url', label: 'URL' },
  { key: 'location', label: '場所' },
  { key: 'memo', label: 'メモ' },
  { key: 'checklist', label: 'チェックリスト' },
];

const FULL_WEEKDAY_LABELS = [
  '日曜日',
  '月曜日',
  '火曜日',
  '水曜日',
  '木曜日',
  '金曜日',
  '土曜日',
];

const MONTH_EVENT_BAR_COLORS = ['#56c59a', '#e56d9a', '#5f9df7', '#f2ad4e', '#8a7cf6'];
const MINUTES_PER_DAY = 24 * 60;

function formatMonthEventDateHeading(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  return `${date.getMonth() + 1}月${date.getDate()}日 ${FULL_WEEKDAY_LABELS[date.getDay()]}`;
}

function formatMonthEventDateButton(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  const weekdayLabel = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];

  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日(${weekdayLabel})`;
}

function getTimelineItemStyle(index: number): CSSProperties {
  return {
    '--month-event-bar-color':
      MONTH_EVENT_BAR_COLORS[index % MONTH_EVENT_BAR_COLORS.length],
  } as CSSProperties;
}

function sanitizeDraft(draft: MonthEventDraft): MonthEventDraft {
  const checklist = draft.checklist
    .map((item) => ({
      ...item,
      text: item.text.trim(),
    }))
    .filter((item) => item.text.length > 0);
  const locationTags = draft.locationTags
    .map((tag) => tag.trim())
    .filter((tag, index, array) => tag.length > 0 && array.indexOf(tag) === index);
  const repeatUntil =
    draft.repeat === 'none' ||
    !draft.repeatUntil ||
    draft.repeatUntil.localeCompare(draft.date) < 0
      ? null
      : draft.repeatUntil;
  const excludedDates =
    draft.repeat === 'none'
      ? []
      : [...new Set(draft.excludedDates)]
          .filter((date) => date.localeCompare(draft.date) >= 0)
          .sort((left, right) => left.localeCompare(right));

  return {
    ...draft,
    title: draft.title.trim(),
    repeatUntil,
    excludedDates,
    url: draft.url.trim(),
    memo: draft.memo.trim(),
    checklist,
    locationTags,
  };
}

function getInitialExpandedAddons(draft: MonthEventDraft): Set<MonthEventAddonKey> {
  const next = new Set<MonthEventAddonKey>();

  if (draft.repeat !== 'none') {
    next.add('repeat');
  }

  if (draft.url.trim()) {
    next.add('url');
  }

  if (draft.locationTags.some((tag) => tag.trim().length > 0)) {
    next.add('location');
  }

  if (draft.memo.trim()) {
    next.add('memo');
  }

  if (draft.checklist.length > 0) {
    next.add('checklist');
  }

  return next;
}

function isAllDayTimeRange(draft: MonthEventDraft): boolean {
  return (
    draft.startTime === '00:00' &&
    (draft.endTime === '24:00' ||
      draft.endTime === '00:00' ||
      draft.endTime === '23:59')
  );
}

export function MonthEventDialog({
  openDate,
  userId,
  monthEvents,
  initialEventId = null,
  onSave,
  onDelete,
  onClose,
}: MonthEventDialogProps) {
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MonthEventDraft>(
    createEmptyMonthEventDraft(userId, openDate ?? ''),
  );
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [showDeleteScopePrompt, setShowDeleteScopePrompt] = useState(false);
  const [expandedAddons, setExpandedAddons] = useState<Set<MonthEventAddonKey>>(
    () => getInitialExpandedAddons(createEmptyMonthEventDraft(userId, openDate ?? '')),
  );
  const [isAllDay, setIsAllDay] = useState(false);
  const [isSavingMonthEvent, setIsSavingMonthEvent] = useState(false);
  const [datePickerTarget, setDatePickerTarget] = useState<'start' | 'end' | null>(
    null,
  );

  const visibleEvents = useMemo(() => {
    if (!openDate) {
      return [];
    }

    return sortMonthEvents(
      monthEvents.filter((monthEvent) => doesMonthEventOccurOnDate(monthEvent, openDate)),
    );
  }, [monthEvents, openDate]);

  const editingEvent =
    (editingEventId
      ? monthEvents.find((monthEvent) => monthEvent.id === editingEventId)
      : undefined) ?? null;

  useEffect(() => {
    if (!openDate) {
      return;
    }

    const initialEvent =
      initialEventId
        ? monthEvents.find((monthEvent) => monthEvent.id === initialEventId) ?? null
        : null;

    const nextDraft =
      initialEvent
        ? createMonthEventDraftFromEvent(initialEvent)
        : createEmptyMonthEventDraft(userId, openDate);

    setEditingEventId(initialEvent?.id ?? null);
    setDraft(nextDraft);
    setStatus('');
    setError('');
    setShowDeleteScopePrompt(false);
    setExpandedAddons(getInitialExpandedAddons(nextDraft));
    setIsAllDay(isAllDayTimeRange(nextDraft));
    setIsSavingMonthEvent(false);
    setDatePickerTarget(null);
  }, [initialEventId, monthEvents, openDate, userId]);

  if (!openDate) {
    return null;
  }

  const activeDate = openDate;
  const startMinutes = parseTimeToMinutes(draft.startTime, 'start');
  const datetimeButtonDate = formatMonthEventDateButton(draft.date);

  function resetEditor(nextStatus = '') {
    const nextDraft = createEmptyMonthEventDraft(userId, activeDate);

    setEditingEventId(null);
    setDraft(nextDraft);
    setError('');
    setStatus(nextStatus);
    setShowDeleteScopePrompt(false);
    setExpandedAddons(getInitialExpandedAddons(nextDraft));
    setIsAllDay(false);
    setIsSavingMonthEvent(false);
    setDatePickerTarget(null);
  }

  function handleNewEvent() {
    resetEditor();
  }

  function handleSelectEvent(monthEvent: MonthEvent) {
    const nextDraft = createMonthEventDraftFromEvent(monthEvent);

    setEditingEventId(monthEvent.id);
    setDraft(nextDraft);
    setStatus('');
    setError('');
    setShowDeleteScopePrompt(false);
    setExpandedAddons(getInitialExpandedAddons(nextDraft));
    setIsAllDay(isAllDayTimeRange(nextDraft));
    setDatePickerTarget(null);
  }

  function expandAddon(key: MonthEventAddonKey) {
    setExpandedAddons((current) => new Set(current).add(key));
  }

  function toggleAllDay(nextChecked: boolean) {
    setIsAllDay(nextChecked);

    if (nextChecked) {
      setDraft((current) => ({
        ...current,
        startTime: '00:00',
        endTime: '24:00',
      }));
    }
  }

  function updateStartTime(nextStartTime: string) {
    setDraft((current) => {
      const nextStartMinutes = parseTimeToMinutes(nextStartTime, 'start');
      const nextEndTime = editingEventId
        ? calculateShiftedEndTimeForEdit(
            nextStartMinutes,
            calculateTimeRangeDurationMinutes(current.startTime, current.endTime),
          )
        : calculateAutoEndTimeForCreate(nextStartMinutes);

      return {
        ...current,
        startTime: nextStartTime,
        endTime: nextEndTime,
      };
    });
  }

  function updateEndTime(nextEndTime: string) {
    setDraft((current) => ({
      ...current,
      endTime: nextEndTime,
    }));
  }

  async function handleSave() {
    const nextDraft = sanitizeDraft(draft);

    if (!nextDraft.title) {
      setError('タイトルを入れてください。');
      return;
    }

    if (minutesBetween(nextDraft.startTime, nextDraft.endTime) <= 0) {
      setError('終了時刻は開始時刻より後にしてください。');
      return;
    }

    setError('');
    setShowDeleteScopePrompt(false);
    setIsSavingMonthEvent(true);
    void onSave(nextDraft, editingEventId ?? undefined).catch(() => undefined);
    onClose();
  }

  async function handleDelete() {
    if (!editingEvent) {
      return;
    }

    setStatus('');
    setError('');

    if (editingEvent.repeat !== 'none') {
      setShowDeleteScopePrompt(true);
      return;
    }

    if (!window.confirm('この主要予定を削除しますか？')) {
      return;
    }

    setIsSavingMonthEvent(true);
    void onDelete(editingEvent).catch(() => undefined);
    onClose();
  }

  async function handleDeleteScope(scope: 'single' | 'future') {
    if (!editingEvent) {
      return;
    }

    const baseDraft = createMonthEventDraftFromEvent(editingEvent);

    if (scope === 'single') {
      const nextDraft = sanitizeDraft({
        ...baseDraft,
        excludedDates: [...baseDraft.excludedDates, activeDate],
      });

      setIsSavingMonthEvent(true);
      void onSave(nextDraft, editingEvent.id).catch(() => undefined);
      onClose();
      return;
    }

    const previousOccurrenceDate = getPreviousMonthEventOccurrenceDate(
      editingEvent,
      activeDate,
    );

    if (!previousOccurrenceDate) {
      setIsSavingMonthEvent(true);
      void onDelete(editingEvent).catch(() => undefined);
      onClose();
      return;
    }

    const nextDraft = sanitizeDraft({
      ...baseDraft,
      repeatUntil: previousOccurrenceDate,
      excludedDates: baseDraft.excludedDates.filter(
        (date) => date.localeCompare(previousOccurrenceDate) <= 0,
      ),
    });

    setIsSavingMonthEvent(true);
    void onSave(nextDraft, editingEvent.id).catch(() => undefined);
    onClose();
  }

  return (
    <div className="overlay modal-overlay month-event-modal-overlay" onClick={onClose}>
      <div className="modal-card month-event-modal" onClick={(event) => event.stopPropagation()}>
        <div className="month-event-editor-header">
          <button className="ghost-button" onClick={onClose} type="button">
            閉じる
          </button>
          <div className="month-event-date-heading" aria-label={formatDateLabel(activeDate)}>
            {formatMonthEventDateHeading(activeDate)}
          </div>
          <button
            className="primary-button month-event-save-button"
            disabled={isSavingMonthEvent}
            onClick={() => void handleSave()}
            type="button"
          >
            保存
          </button>
        </div>

        <div className="month-event-editor-body">
          <section className="month-event-core-section month-event-title-card">
            <label className="field month-event-title-field">
              <input
                aria-label="タイトル"
                value={draft.title}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    title: event.target.value,
                  })
                }
                placeholder="タイトル"
              />
            </label>
          </section>

          <section className="month-event-core-section">
            <div className="month-event-toggle-row">
              <span>終日</span>
              <label className="month-event-all-day-switch">
                <input
                  type="checkbox"
                  checked={isAllDay}
                  onChange={(event) => toggleAllDay(event.target.checked)}
                />
                <span />
              </label>
            </div>
            <div className="month-event-datetime-rows">
              <div className="month-event-datetime-row">
                <span className="month-event-datetime-label">開始</span>
                <button
                  className="month-event-date-button"
                  onClick={() => setDatePickerTarget('start')}
                  type="button"
                  aria-label="開始日"
                >
                  {datetimeButtonDate}
                </button>
                <TimeWheelPicker
                  value={draft.startTime}
                  role="start"
                  disabled={isAllDay}
                  inputClassName="month-event-time-input"
                  onChange={updateStartTime}
                />
              </div>
              <div className="month-event-datetime-row">
                <span className="month-event-datetime-label">終了</span>
                <button
                  className="month-event-date-button"
                  onClick={() => setDatePickerTarget('end')}
                  type="button"
                  aria-label="終了日"
                >
                  {datetimeButtonDate}
                </button>
                <TimeWheelPicker
                  value={draft.endTime}
                  role="end"
                  disabled={isAllDay}
                  inputClassName="month-event-time-input"
                  minMinutes={Math.min(startMinutes + 1, MINUTES_PER_DAY)}
                  onChange={updateEndTime}
                />
              </div>
            </div>
          </section>

          <section className="month-event-subtle-section month-event-list-card">
            <div className="label-row">
              <strong>この日の予定</strong>
              <button className="ghost-button" onClick={handleNewEvent} type="button">
                新規
              </button>
            </div>

            {visibleEvents.length > 0 ? (
              <div className="month-event-timeline-list">
                {visibleEvents.map((monthEvent, index) => (
                  <button
                    key={monthEvent.id}
                    className={
                      editingEventId === monthEvent.id
                        ? 'month-event-timeline-item active'
                        : 'month-event-timeline-item'
                    }
                    style={getTimelineItemStyle(index)}
                    onClick={() => handleSelectEvent(monthEvent)}
                    type="button"
                  >
                    <span className="month-event-timeline-times">
                      <span>{monthEvent.startTime}</span>
                      <span>{monthEvent.endTime}</span>
                    </span>
                    <span className="month-event-timeline-bar" aria-hidden="true" />
                    <span className="month-event-timeline-copy">
                      <strong>{monthEvent.title}</strong>
                      <span>
                        {formatMonthEventTimeRange(monthEvent)}
                        {monthEvent.repeat !== 'none'
                          ? ` / ${getMonthEventRepeatLabel(monthEvent.repeat)}`
                          : ''}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="detail-note">この日に表示される主要予定はまだありません。</p>
            )}
          </section>

          {showDeleteScopePrompt && editingEvent ? (
            <section className="assistant-feedback-card warning">
              <strong>繰り返し予定の削除範囲</strong>
              <p className="detail-note">
                {formatDateLabel(activeDate)} の予定を消します。今回だけ消すか、この日以降の
                繰り返しもまとめて止めるかを選んでください。
              </p>
              <div className="row-actions">
                <button
                  className="ghost-button danger"
                  onClick={() => void handleDeleteScope('single')}
                  type="button"
                >
                  この予定だけ削除
                </button>
                <button
                  className="ghost-button danger"
                  onClick={() => void handleDeleteScope('future')}
                  type="button"
                >
                  これ以降も全部削除
                </button>
                <button
                  className="ghost-button"
                  onClick={() => setShowDeleteScopePrompt(false)}
                  type="button"
                >
                  キャンセル
                </button>
              </div>
            </section>
          ) : null}

          <section className="month-event-addons">
            <div className="month-event-addon-chip-row">
              {MONTH_EVENT_ADDONS.map((addon) => {
                const isExpanded = expandedAddons.has(addon.key);

                return (
                  <button
                    className={
                      isExpanded
                        ? 'month-event-addon-chip active'
                        : 'month-event-addon-chip'
                    }
                    key={addon.key}
                    onClick={() => expandAddon(addon.key)}
                    type="button"
                    aria-pressed={isExpanded}
                  >
                    <span className="month-event-addon-plus" aria-hidden="true">
                      ＋
                    </span>
                    <span>{addon.label}</span>
                  </button>
                );
              })}
            </div>

            {expandedAddons.has('repeat') ? (
              <section className="month-event-addon-panel">
                <div className="label-row">
                  <strong>繰り返し</strong>
                </div>
                <label className="field">
                  <select
                    aria-label="繰り返し"
                    value={draft.repeat}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        repeat: event.target.value as MonthEventDraft['repeat'],
                      })
                    }
                  >
                    {MONTH_EVENT_REPEAT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </section>
            ) : null}

            {expandedAddons.has('url') ? (
              <section className="month-event-addon-panel">
                <div className="label-row">
                  <strong>URL</strong>
                </div>
                <label className="field">
                  <input
                    aria-label="URL"
                    value={draft.url}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        url: event.target.value,
                      })
                    }
                    placeholder="https://..."
                  />
                </label>
              </section>
            ) : null}

            {expandedAddons.has('location') ? (
              <section className="month-event-addon-panel">
                <div className="label-row">
                  <strong>場所</strong>
                </div>
                <label className="field">
                  <input
                    aria-label="場所"
                    value={draft.locationTags.join(', ')}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        locationTags: event.target.value.split(','),
                      })
                    }
                    placeholder="学校, 体育館"
                  />
                </label>
              </section>
            ) : null}

            {expandedAddons.has('memo') ? (
              <section className="month-event-addon-panel">
                <div className="label-row">
                  <strong>メモ</strong>
                </div>
                <label className="field">
                  <textarea
                    aria-label="メモ"
                    rows={3}
                    value={draft.memo}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        memo: event.target.value,
                      })
                    }
                    placeholder="持ち物や補足"
                  />
                </label>
              </section>
            ) : null}

            {expandedAddons.has('checklist') ? (
              <section className="month-event-addon-panel month-event-checklist-card">
                <div className="label-row">
                  <strong>チェックリスト</strong>
                  <div className="row-actions">
                    <button
                      className="mini-button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          checklist: [...draft.checklist, createEmptyMonthEventChecklistItem()],
                        })
                      }
                      type="button"
                    >
                      項目を追加
                    </button>
                  </div>
                </div>

                {draft.checklist.length > 0 ? (
                  <div className="month-event-checklist">
                    {draft.checklist.map((item) => (
                      <div key={item.id} className="month-event-checklist-item">
                        <input
                          type="checkbox"
                          checked={item.checked}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              checklist: draft.checklist.map((entry) =>
                                entry.id === item.id
                                  ? { ...entry, checked: event.target.checked }
                                  : entry,
                              ),
                            })
                          }
                        />
                        <input
                          value={item.text}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              checklist: draft.checklist.map((entry) =>
                                entry.id === item.id
                                  ? { ...entry, text: event.target.value }
                                  : entry,
                              ),
                            })
                          }
                          placeholder="確認事項"
                        />
                        <button
                          className="mini-button danger"
                          onClick={() =>
                            setDraft({
                              ...draft,
                              checklist: draft.checklist.filter((entry) => entry.id !== item.id),
                            })
                          }
                          type="button"
                        >
                          削除
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="detail-note">必要な持ち物や確認事項を追加できます。</p>
                )}
              </section>
            ) : null}
          </section>

          {error ? <p className="inline-error">{error}</p> : null}
          {status ? <p className="inline-note">{status}</p> : null}
        </div>

        {editingEvent ? (
          <div className="row-actions month-event-editor-actions">
            <button
              className="ghost-button danger"
              disabled={isSavingMonthEvent}
              onClick={() => void handleDelete()}
              type="button"
            >
              削除
            </button>
          </div>
        ) : null}
      </div>
      <DayCalendarDialog
        open={datePickerTarget !== null}
        selectedDate={draft.date}
        onSelectDate={(nextDate) =>
          setDraft((current) => ({
            ...current,
            date: nextDate,
          }))
        }
        onClose={() => setDatePickerTarget(null)}
      />
    </div>
  );
}
