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

    setEditingEventId(initialEvent?.id ?? null);
    setDraft(
      initialEvent
        ? createMonthEventDraftFromEvent(initialEvent)
        : createEmptyMonthEventDraft(userId, openDate),
    );
    setStatus('');
    setError('');
    setShowDeleteScopePrompt(false);
  }, [initialEventId, monthEvents, openDate, userId]);

  if (!openDate) {
    return null;
  }

  const activeDate = openDate;

  function resetEditor(nextStatus = '') {
    setEditingEventId(null);
    setDraft(createEmptyMonthEventDraft(userId, activeDate));
    setError('');
    setStatus(nextStatus);
    setShowDeleteScopePrompt(false);
  }

  function handleNewEvent() {
    resetEditor();
  }

  function handleSelectEvent(monthEvent: MonthEvent) {
    setEditingEventId(monthEvent.id);
    setDraft(createMonthEventDraftFromEvent(monthEvent));
    setStatus('');
    setError('');
    setShowDeleteScopePrompt(false);
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
    await onSave(nextDraft, editingEventId ?? undefined);

    if (!editingEvent) {
      resetEditor('月の主要予定を追加しました。');
    } else {
      setStatus('月の主要予定を更新しました。');
      setDraft(nextDraft);
    }
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

    await onDelete(editingEvent);
    resetEditor('月の主要予定を削除しました。');
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

      await onSave(nextDraft, editingEvent.id);
      resetEditor('この予定だけ削除しました。');
      return;
    }

    const previousOccurrenceDate = getPreviousMonthEventOccurrenceDate(
      editingEvent,
      activeDate,
    );

    if (!previousOccurrenceDate) {
      await onDelete(editingEvent);
      resetEditor('この日以降の繰り返し予定を削除しました。');
      return;
    }

    const nextDraft = sanitizeDraft({
      ...baseDraft,
      repeatUntil: previousOccurrenceDate,
      excludedDates: baseDraft.excludedDates.filter(
        (date) => date.localeCompare(previousOccurrenceDate) <= 0,
      ),
    });

    await onSave(nextDraft, editingEvent.id);
    resetEditor('この日以降の繰り返し予定を削除しました。');
  }

  return (
    <div className="overlay modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="section-stack">
          <div className="section-header">
            <div>
              <h2>月の主要予定</h2>
              <p>{formatDateLabel(activeDate)} の主な用事を管理します。</p>
            </div>
            <button className="ghost-button" onClick={onClose} type="button">
              閉じる
            </button>
          </div>

          <section className="assistant-settings-card month-event-list-card">
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
              <p className="detail-note">
                この日に表示される主要予定はまだありません。TimeTree のイベント詳細にある
                ような `繰り返し / 場所 / URL / メモ / To-do` を最小構成で入れられます。
              </p>
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

          <div className="form-grid">
            <label className="field field-full">
              <span>タイトル</span>
              <input
                value={draft.title}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    title: event.target.value,
                  })
                }
                placeholder="例: 体育祭 / バイト / 面接"
              />
            </label>

            <label className="field">
              <span>開始時刻</span>
              <input
                type="time"
                value={draft.startTime}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    startTime: event.target.value,
                  })
                }
              />
            </label>

            <label className="field">
              <span>終了時刻</span>
              <input
                type="time"
                value={draft.endTime}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    endTime: event.target.value,
                  })
                }
              />
            </label>

            <label className="field">
              <span>繰り返し</span>
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

            <label className="field field-full">
              <span>場所タグ</span>
              <input
                value={draft.locationTags.join(', ')}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    locationTags: event.target.value.split(','),
                  })
                }
                placeholder="例: 学校, 体育館, 渋谷"
              />
            </label>

            <label className="field field-full">
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
                placeholder="持ち物や補足を書けます"
              />
            </label>
          </div>

          <section className="assistant-settings-card month-event-checklist-card">
            <div className="label-row">
              <strong>チェックリスト</strong>
              <button
                className="ghost-button"
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
                      placeholder="例: 履歴書を持つ"
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

          {error ? <p className="inline-error">{error}</p> : null}
          {status ? <p className="inline-note">{status}</p> : null}

          <div className="row-actions">
            {editingEvent ? (
              <button className="ghost-button danger" onClick={() => void handleDelete()} type="button">
                削除
              </button>
            ) : null}
            <button className="primary-button" onClick={() => void handleSave()} type="button">
              {editingEvent ? '主要予定を更新' : '主要予定を追加'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
