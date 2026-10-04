import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
  parseTimeToMinutes,
} from '../lib/date';
import {
  doesMonthEventOccurOnDate,
  formatMonthEventTimeRangeForDate,
  getMonthEventRepeatLabel,
  MONTH_EVENT_REPEAT_OPTIONS,
  sortMonthEvents,
} from '../lib/monthEvents';
import {
  resolveMonthEventDeleteMutation,
  sanitizeMonthEventDraft,
  validateMonthEventDraft,
  type MonthEventDeleteScope,
} from '../lib/monthEventEditor';
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

function createRangeAwareEmptyDraft(userId: string, date: string): MonthEventDraft {
  return {
    ...createEmptyMonthEventDraft(userId, date),
    endDate: date,
  };
}

function createRangeAwareDraftFromEvent(event: MonthEvent): MonthEventDraft {
  return {
    ...createMonthEventDraftFromEvent(event),
    endDate: event.endDate ?? event.date,
  };
}

export function MonthEventDialog(props: MonthEventDialogProps) {
  if (!props.openDate) return null;
  return <MonthEventEditor key={JSON.stringify([props.userId, props.openDate, props.initialEventId ?? null])} {...props} openDate={props.openDate} />;
}

function MonthEventEditor({
  openDate,
  userId,
  monthEvents,
  initialEventId = null,
  onSave,
  onDelete,
  onClose,
}: MonthEventDialogProps & { openDate: string }) {
  const initialEvent = initialEventId ? monthEvents.find(event => event.id === initialEventId) : undefined;
  const [waitingForInitialEvent, setWaitingForInitialEvent] = useState(Boolean(initialEventId && !initialEvent));
  const pendingMutation = useRef<object | null>(null);
  useLayoutEffect(() => () => { pendingMutation.current = null; }, []);
  const [editingEventId, setEditingEventId] = useState<string | null>(initialEvent?.id ?? null);
  const [draft, setDraft] = useState<MonthEventDraft>(
    () => initialEvent ? createRangeAwareDraftFromEvent(initialEvent) : createRangeAwareEmptyDraft(userId, openDate),
  );
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [showDeleteScopePrompt, setShowDeleteScopePrompt] = useState(false);
  const [expandedAddons, setExpandedAddons] = useState<Set<MonthEventAddonKey>>(
    () => getInitialExpandedAddons(draft),
  );
  const [isAllDay, setIsAllDay] = useState(() => isAllDayTimeRange(draft));
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

  // A late initial target may initialize once; later list updates must not replace typed input.
  useEffect(() => {
    if (!waitingForInitialEvent) return;
    const event = monthEvents.find(candidate => candidate.id === initialEventId);
    if (!event) return;
    const nextDraft = createRangeAwareDraftFromEvent(event);
    setEditingEventId(event.id);
    setDraft(nextDraft);
    setExpandedAddons(getInitialExpandedAddons(nextDraft));
    setIsAllDay(isAllDayTimeRange(nextDraft));
    setWaitingForInitialEvent(false);
  }, [initialEventId, monthEvents, waitingForInitialEvent]);

  function requestClose() {
    if (!pendingMutation.current) onClose();
  }

  async function runMutation(action: () => Promise<void>, failureMessage: string) {
    if (pendingMutation.current || waitingForInitialEvent) return;
    const attempt = {};
    pendingMutation.current = attempt;
    setIsSavingMonthEvent(true);
    setError('');
    try {
      await action();
    } catch {
      if (pendingMutation.current === attempt) {
        pendingMutation.current = null;
        setIsSavingMonthEvent(false);
        setError(failureMessage);
      }
      return;
    }
    // Keep the operation locked during exit motion; unmount revokes late completions.
    if (pendingMutation.current === attempt) onClose();
  }

  const activeDate = openDate;
  const startMinutes = parseTimeToMinutes(draft.startTime, 'start');
  const resolvedEndDate = draft.endDate ?? draft.date;
  const startDateButtonLabel = formatMonthEventDateButton(draft.date);
  const endDateButtonLabel = formatMonthEventDateButton(resolvedEndDate);
  const isSameDayRange = resolvedEndDate === draft.date;

  function resetEditor(nextStatus = '') {
    const nextDraft = createRangeAwareEmptyDraft(userId, activeDate);

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
    if (pendingMutation.current || waitingForInitialEvent) return;
    resetEditor();
  }

  function handleSelectEvent(monthEvent: MonthEvent) {
    if (pendingMutation.current || waitingForInitialEvent) return;
    const nextDraft = createRangeAwareDraftFromEvent(monthEvent);

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
    if (pendingMutation.current) return;
    setDraft((current) => {
      const currentEndDate = current.endDate ?? current.date;

      if (currentEndDate !== current.date) {
        return {
          ...current,
          startTime: nextStartTime,
        };
      }

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
    if (pendingMutation.current) return;
    setDraft((current) => ({
      ...current,
      endTime: nextEndTime,
    }));
  }

  function updateEventDate(target: 'start' | 'end' | null, nextDate: string) {
    if (!target || pendingMutation.current) {
      return;
    }

    setDraft((current) => {
      const currentEndDate = current.endDate ?? current.date;

      if (target === 'end') {
        const nextEndTime =
          nextDate === current.date &&
          parseTimeToMinutes(current.endTime, 'end') <=
            parseTimeToMinutes(current.startTime, 'start')
            ? calculateAutoEndTimeForCreate(
                parseTimeToMinutes(current.startTime, 'start'),
              )
            : current.endTime;

        return {
          ...current,
          endDate: nextDate,
          endTime: nextEndTime,
        };
      }

      const nextEndDate =
        currentEndDate.localeCompare(nextDate) < 0 ? nextDate : currentEndDate;
      const nextEndTime =
        nextEndDate === nextDate &&
        parseTimeToMinutes(current.endTime, 'end') <=
          parseTimeToMinutes(current.startTime, 'start')
          ? calculateAutoEndTimeForCreate(
              parseTimeToMinutes(current.startTime, 'start'),
            )
          : current.endTime;

      return {
        ...current,
        date: nextDate,
        endDate: nextEndDate,
        endTime: nextEndTime,
      };
    });
  }

  async function handleSave() {
    if (pendingMutation.current || waitingForInitialEvent) return;
    const nextDraft = sanitizeMonthEventDraft(draft);
    const validationError = validateMonthEventDraft(nextDraft);

    if (validationError) {
      setError(validationError);
      return;
    }

    setError('');
    setShowDeleteScopePrompt(false);
    await runMutation(() => onSave(nextDraft, editingEventId ?? undefined),
      '保存できませんでした。入力内容は残っています。もう一度保存してください。');
  }

  async function handleDelete() {
    if (!editingEvent || pendingMutation.current) {
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

    await runMutation(() => onDelete(editingEvent), '削除できませんでした。もう一度試してください。');
  }

  async function handleDeleteScope(scope: MonthEventDeleteScope) {
    if (!editingEvent || pendingMutation.current) {
      return;
    }

    const mutation = resolveMonthEventDeleteMutation(
      editingEvent,
      activeDate,
      scope,
    );

    await runMutation(() => mutation.type === 'delete'
      ? onDelete(mutation.monthEvent)
      : onSave(mutation.draft, mutation.targetMonthEventId), '削除できませんでした。もう一度試してください。');
  }

  return (
    <div className="overlay modal-overlay month-event-modal-overlay" onClick={requestClose}>
      <div className="modal-card month-event-modal" onClick={(event) => event.stopPropagation()}>
        <div className="month-event-editor-header">
          <button className="ghost-button" onClick={requestClose} disabled={isSavingMonthEvent} type="button">
            閉じる
          </button>
          <div className="month-event-date-heading" aria-label={formatDateLabel(activeDate)}>
            {formatMonthEventDateHeading(activeDate)}
          </div>
          <button
            className="primary-button month-event-save-button"
            disabled={isSavingMonthEvent || waitingForInitialEvent}
            onClick={() => void handleSave()}
            type="button"
          >
            保存
          </button>
        </div>

        <fieldset className="month-event-editor-body" aria-label="予定の入力内容" disabled={isSavingMonthEvent || waitingForInitialEvent}>
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
                  {startDateButtonLabel}
                </button>
                <TimeWheelPicker
                  value={draft.startTime}
                  role="start"
                  disabled={isAllDay || isSavingMonthEvent || waitingForInitialEvent}
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
                  {endDateButtonLabel}
                </button>
                <TimeWheelPicker
                  value={draft.endTime}
                  role="end"
                  disabled={isAllDay || isSavingMonthEvent || waitingForInitialEvent}
                  inputClassName="month-event-time-input"
                  minMinutes={
                    isSameDayRange
                      ? Math.min(startMinutes + 1, MINUTES_PER_DAY)
                      : 0
                  }
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
                        {formatMonthEventTimeRangeForDate(monthEvent, activeDate)}
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

          {waitingForInitialEvent ? <p className="inline-error" role="alert">この予定を読み込めません。予定の読み込みを待つか、一度閉じてください。</p> : null}
          {error ? <p className="inline-error" role="alert">{error}</p> : null}
          {status ? <p className="inline-note">{status}</p> : null}
        </fieldset>

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
        selectedDate={datePickerTarget === 'end' ? resolvedEndDate : draft.date}
        onSelectDate={(nextDate) => updateEventDate(datePickerTarget, nextDate)}
        onClose={() => setDatePickerTarget(null)}
      />
    </div>
  );
}
