import { useEffect, useMemo, useState } from 'react';
import {
  createEmptyMonthEventChecklistItem,
  createEmptyMonthEventDraft,
  createMonthEventDraftFromEvent,
} from '../domain/planner';
import { formatDateLabel, minutesBetween } from '../lib/date';
import {
  doesMonthEventOccurOnDate,
  formatMonthEventTimeRange,
  getPreviousMonthEventOccurrenceDate,
  getMonthEventRepeatLabel,
  MONTH_EVENT_REPEAT_OPTIONS,
  sortMonthEvents,
} from '../lib/monthEvents';
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
    setIsAllDay(nextDraft.startTime === '00:00' && nextDraft.endTime === '23:59');
    setIsSavingMonthEvent(false);
  }, [initialEventId, monthEvents, openDate, userId]);

  if (!openDate) {
    return null;
  }

  const activeDate = openDate;

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
    setIsAllDay(nextDraft.startTime === '00:00' && nextDraft.endTime === '23:59');
  }

  function expandAddon(key: MonthEventAddonKey) {
    setExpandedAddons((current) => new Set(current).add(key));
  }

  function collapseAddon(key: MonthEventAddonKey) {
    setExpandedAddons((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });

    if (key === 'repeat') {
      setDraft((current) => ({
        ...current,
        repeat: 'none',
        repeatUntil: null,
        excludedDates: [],
      }));
    } else if (key === 'url') {
      setDraft((current) => ({ ...current, url: '' }));
    } else if (key === 'location') {
      setDraft((current) => ({ ...current, locationTags: [] }));
    } else if (key === 'memo') {
      setDraft((current) => ({ ...current, memo: '' }));
    } else if (key === 'checklist') {
      setDraft((current) => ({ ...current, checklist: [] }));
    }
  }

  function toggleAllDay(nextChecked: boolean) {
    setIsAllDay(nextChecked);

    if (nextChecked) {
      setDraft((current) => ({
        ...current,
        startTime: '00:00',
        endTime: '23:59',
      }));
    }
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
    try {
      await onSave(nextDraft, editingEventId ?? undefined);
    } catch {
      setError('月の主要予定を保存できませんでした。');
      return;
    } finally {
      setIsSavingMonthEvent(false);
    }

    if (!editingEvent) {
      resetEditor('月の主要予定を追加しました。');
    } else {
      setStatus('月の主要予定を更新しました。');
      setDraft(nextDraft);
    }
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

    try {
      await onDelete(editingEvent);
    } catch {
      setError('月の主要予定を削除できませんでした。');
      return;
    }
    resetEditor('月の主要予定を削除しました。');
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

      try {
        await onSave(nextDraft, editingEvent.id);
      } catch {
        setError('月の主要予定を削除できませんでした。');
        return;
      }
      resetEditor('この予定だけ削除しました。');
      onClose();
      return;
    }

    const previousOccurrenceDate = getPreviousMonthEventOccurrenceDate(
      editingEvent,
      activeDate,
    );

    if (!previousOccurrenceDate) {
      try {
        await onDelete(editingEvent);
      } catch {
        setError('月の主要予定を削除できませんでした。');
        return;
      }
      resetEditor('この日以降の繰り返し予定を削除しました。');
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

    try {
      await onSave(nextDraft, editingEvent.id);
    } catch {
      setError('月の主要予定を削除できませんでした。');
      return;
    }
    resetEditor('この日以降の繰り返し予定を削除しました。');
    onClose();
  }

  return (
    <div className="overlay modal-overlay month-event-modal-overlay" onClick={onClose}>
      <div className="modal-card month-event-modal" onClick={(event) => event.stopPropagation()}>
        <div className="month-event-editor-header">
          <button className="ghost-button" onClick={onClose} type="button">
            閉じる
          </button>
          <div className="month-event-editor-heading">
            <h2>{editingEvent ? '主要予定を編集' : '主要予定を追加'}</h2>
            <p>{formatDateLabel(activeDate)}</p>
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
              <span>タイトル</span>
              <input
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
            <div className="month-event-datetime-grid">
              <label className="field">
                <span>開始日</span>
                <input
                  type="date"
                  value={draft.date}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      date: event.target.value,
                    })
                  }
                />
              </label>
              <label className="field">
                <span>開始時刻</span>
                <input
                  type="time"
                  value={draft.startTime}
                  disabled={isAllDay}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      startTime: event.target.value,
                    })
                  }
                />
              </label>
              <label className="field">
                <span>終了日</span>
                <input
                  type="date"
                  value={draft.date}
                  disabled
                  aria-label="終了日"
                />
              </label>
              <label className="field">
                <span>終了時刻</span>
                <input
                  type="time"
                  value={draft.endTime}
                  disabled={isAllDay}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      endTime: event.target.value,
                    })
                  }
                />
              </label>
            </div>
          </section>

          <section className="month-event-subtle-section month-event-list-card">
            <div className="label-row">
              <strong>登録済みの主要予定</strong>
              <button className="ghost-button" onClick={handleNewEvent} type="button">
                新規予定
              </button>
            </div>

            {visibleEvents.length > 0 ? (
              <div className="month-event-chip-list">
                {visibleEvents.map((monthEvent) => (
                  <button
                    key={monthEvent.id}
                    className={
                      editingEventId === monthEvent.id
                        ? 'month-event-chip active'
                        : 'month-event-chip'
                    }
                    onClick={() => handleSelectEvent(monthEvent)}
                    type="button"
                  >
                    <strong>{monthEvent.title}</strong>
                    <span>{formatMonthEventTimeRange(monthEvent)}</span>
                    <span>{getMonthEventRepeatLabel(monthEvent.repeat)}</span>
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
              <span className="month-event-addon-prefix">＋</span>
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
                    onClick={() =>
                      isExpanded ? collapseAddon(addon.key) : expandAddon(addon.key)
                    }
                    type="button"
                    aria-pressed={isExpanded}
                  >
                    {isExpanded ? '−' : '＋'} {addon.label}
                  </button>
                );
              })}
            </div>

            {expandedAddons.has('repeat') ? (
              <section className="month-event-addon-panel">
                <div className="label-row">
                  <strong>繰り返し</strong>
                  <button
                    className="mini-button"
                    onClick={() => collapseAddon('repeat')}
                    type="button"
                  >
                    外す
                  </button>
                </div>
                <label className="field">
                  <span>設定</span>
                  <select
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
                  <button
                    className="mini-button"
                    onClick={() => collapseAddon('url')}
                    type="button"
                  >
                    外す
                  </button>
                </div>
                <label className="field">
                  <span>URL</span>
                  <input
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
                  <button
                    className="mini-button"
                    onClick={() => collapseAddon('location')}
                    type="button"
                  >
                    外す
                  </button>
                </div>
                <label className="field">
                  <span>場所タグ</span>
                  <input
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
                  <button
                    className="mini-button"
                    onClick={() => collapseAddon('memo')}
                    type="button"
                  >
                    外す
                  </button>
                </div>
                <label className="field">
                  <span>メモ</span>
                  <textarea
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
                    <button
                      className="mini-button"
                      onClick={() => collapseAddon('checklist')}
                      type="button"
                    >
                      外す
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
    </div>
  );
}
