import { useMemo, useState } from 'react';
import {
  inferSubjectFromTitle,
  isClassroomOnlyTitle,
  type TimetableOcrItemCandidate,
  type TimetableOcrPeriodCandidate,
  type TimetableOcrResult,
} from '../lib/timetableOcrImport';
import type {
  RecurrenceWeekday,
  ScheduleTemplate,
  ScheduleTemplateDraft,
  TimetablePeriod,
  TimetablePeriodDraft,
} from '../types/domain';

interface TimetableOcrImportDialogProps {
  userId: string;
  termId: string;
  fileName: string;
  result: TimetableOcrResult;
  existingPeriods: TimetablePeriod[];
  existingTemplates: ScheduleTemplate[];
  onClose: () => void;
  onSaveTimetablePeriod: (
    draft: TimetablePeriodDraft,
    targetPeriodId?: string,
  ) => Promise<TimetablePeriod>;
  onSaveScheduleTemplate: (
    draft: ScheduleTemplateDraft,
    targetTemplateId?: string,
  ) => Promise<void>;
}

type EditablePeriod = TimetableOcrPeriodCandidate & {
  id: string;
};

type EditableItem = TimetableOcrItemCandidate & {
  id: string;
};

const WEEKDAY_OPTIONS: Array<{ value: RecurrenceWeekday; label: string }> = [
  { value: 'mon', label: '月' },
  { value: 'tue', label: '火' },
  { value: 'wed', label: '水' },
  { value: 'thu', label: '木' },
  { value: 'fri', label: '金' },
  { value: 'sat', label: '土' },
];

function toMinutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : 0;
}

function isValidTimeRange(startTime: string | null, endTime: string | null): boolean {
  if (!startTime || !endTime) {
    return false;
  }

  return toMinutes(endTime) > toMinutes(startTime);
}

function isImportableItem(item: EditableItem): boolean {
  return (
    item.title.trim().length > 0 &&
    !isClassroomOnlyTitle(item.title) &&
    Boolean(item.weekday) &&
    item.periodNumber !== null &&
    isValidTimeRange(item.startTime, item.endTime)
  );
}

function hasBlockingItemError(item: EditableItem): boolean {
  if (!item.title.trim() || isClassroomOnlyTitle(item.title)) {
    return false;
  }

  return (
    !item.weekday ||
    item.periodNumber === null ||
    !isValidTimeRange(item.startTime, item.endTime)
  );
}

function createEditablePeriod(
  period: TimetableOcrPeriodCandidate,
  index: number,
): EditablePeriod {
  return {
    ...period,
    id: `period-${period.periodNumber}-${index}`,
  };
}

function createEditableItem(
  item: TimetableOcrItemCandidate,
  index: number,
): EditableItem {
  return {
    ...item,
    id: `item-${item.weekday || 'unknown'}-${item.periodNumber ?? 'unknown'}-${index}`,
  };
}

function createEmptyItem(index: number): EditableItem {
  return {
    id: `item-new-${Date.now()}-${index}`,
    weekday: '',
    periodNumber: null,
    startTime: null,
    endTime: null,
    title: '',
    subject: '',
    classroom: '',
    memo: '',
  };
}

function getTemplateTermId(template: ScheduleTemplate): string {
  return template.termId || 'default';
}

export function TimetableOcrImportDialog({
  userId,
  termId,
  fileName,
  result,
  existingPeriods,
  existingTemplates,
  onClose,
  onSaveTimetablePeriod,
  onSaveScheduleTemplate,
}: TimetableOcrImportDialogProps) {
  const [periods, setPeriods] = useState<EditablePeriod[]>(() =>
    result.periods.map(createEditablePeriod),
  );
  const [items, setItems] = useState<EditableItem[]>(() =>
    result.items.map(createEditableItem),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const sortedPeriods = useMemo(
    () =>
      periods
        .slice()
        .sort((left, right) => left.periodNumber - right.periodNumber),
    [periods],
  );
  const periodNumbers = useMemo(() => {
    const numbers = new Set<number>();
    sortedPeriods.forEach((period) => numbers.add(period.periodNumber));
    for (let periodNumber = 1; periodNumber <= 6; periodNumber += 1) {
      numbers.add(periodNumber);
    }
    return Array.from(numbers).sort((left, right) => left - right);
  }, [sortedPeriods]);
  const importableItems = items.filter(isImportableItem);
  const hasInvalidPeriod = periods.some(
    (period) =>
      period.startTime !== null &&
      period.endTime !== null &&
      !isValidTimeRange(period.startTime, period.endTime),
  );
  const hasBlockingErrors = hasInvalidPeriod || items.some(hasBlockingItemError);
  const canSave = importableItems.length > 0 && !hasBlockingErrors && !isSaving;

  function updatePeriod(
    periodId: string,
    key: 'startTime' | 'endTime',
    value: string,
  ) {
    const nextValue = value || null;
    const currentPeriod = periods.find((period) => period.id === periodId);

    setPeriods((current) =>
      current.map((period) =>
        period.id === periodId ? { ...period, [key]: nextValue } : period,
      ),
    );

    if (!currentPeriod) {
      return;
    }

    setItems((current) =>
      current.map((item) =>
        item.periodNumber === currentPeriod.periodNumber
          ? { ...item, [key]: nextValue }
          : item,
      ),
    );
  }

  function updateItem<K extends keyof EditableItem>(
    itemId: string,
    key: K,
    value: EditableItem[K],
  ) {
    setItems((current) =>
      current.map((item) => {
        if (item.id !== itemId) {
          return item;
        }

        const nextItem = { ...item, [key]: value };

        if (key === 'title' && !nextItem.subject.trim()) {
          nextItem.subject = inferSubjectFromTitle(String(value));
        }

        if (key === 'periodNumber') {
          const period = periods.find((candidate) => candidate.periodNumber === value);
          nextItem.startTime = period?.startTime ?? nextItem.startTime;
          nextItem.endTime = period?.endTime ?? nextItem.endTime;
        }

        return nextItem;
      }),
    );
  }

  function getExistingTemplate(item: EditableItem): ScheduleTemplate | undefined {
    return existingTemplates.find(
      (template) =>
        getTemplateTermId(template) === termId &&
        template.weekday === item.weekday &&
        template.periodNumber === item.periodNumber,
    );
  }

  async function handleSave() {
    if (!canSave) {
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      for (const period of periods) {
        const existingPeriod = existingPeriods.find(
          (candidate) =>
            candidate.termId === termId &&
            candidate.periodNumber === period.periodNumber,
        );

        await onSaveTimetablePeriod(
          {
            userId,
            termId,
            periodNumber: period.periodNumber,
            label: String(period.periodNumber),
            startTime: period.startTime,
            endTime: period.endTime,
          },
          existingPeriod?.id,
        );
      }

      for (const item of importableItems) {
        const existingTemplate = getExistingTemplate(item);

        await onSaveScheduleTemplate(
          {
            userId,
            termId,
            title: item.title.trim(),
            subject: item.subject.trim(),
            type: 'school-event',
            weekday: item.weekday as RecurrenceWeekday,
            periodNumber: item.periodNumber ?? undefined,
            startTime: item.startTime ?? '',
            endTime: item.endTime ?? '',
            classroom: item.classroom.trim(),
            memo: item.memo.trim(),
            active: true,
          },
          existingTemplate?.id,
        );
      }

      onClose();
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : '時間割候補の保存に失敗しました。',
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="overlay modal-overlay timetable-ocr-overlay" onClick={onClose}>
      <div
        className="modal-card timetable-ocr-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="timetable-ocr-header">
          <button
            className="ghost-button"
            disabled={isSaving}
            onClick={onClose}
            type="button"
          >
            閉じる
          </button>
          <div className="timetable-ocr-heading">
            <h2>読み取り結果の確認</h2>
            <p>{fileName}</p>
          </div>
          <button
            className="primary-button timetable-ocr-save"
            disabled={!canSave}
            onClick={() => {
              void handleSave();
            }}
            type="button"
          >
            {isSaving ? '保存中...' : '時間割に反映'}
          </button>
        </div>

        <div className="timetable-ocr-body">
          <section className="timetable-ocr-card">
            <div className="timetable-card-title">
              <strong>時限時刻</strong>
            </div>
            <div className="timetable-ocr-period-list">
              {sortedPeriods.map((period) => (
                <div className="timetable-ocr-period-row" key={period.id}>
                  <strong>{period.periodNumber}限</strong>
                  <label className="field">
                    <span>開始</span>
                    <input
                      type="time"
                      value={period.startTime ?? ''}
                      onChange={(event) =>
                        updatePeriod(period.id, 'startTime', event.target.value)
                      }
                    />
                  </label>
                  <label className="field">
                    <span>終了</span>
                    <input
                      type="time"
                      value={period.endTime ?? ''}
                      onChange={(event) =>
                        updatePeriod(period.id, 'endTime', event.target.value)
                      }
                    />
                  </label>
                  {period.startTime && period.endTime && !isValidTimeRange(period.startTime, period.endTime) ? (
                    <span className="timetable-ocr-warning">要修正</span>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          <section className="timetable-ocr-card">
            <div className="timetable-ocr-card-head">
              <div className="timetable-card-title">
                <strong>授業候補</strong>
              </div>
              <button
                className="ghost-button"
                onClick={() => setItems((current) => [...current, createEmptyItem(current.length)])}
                type="button"
              >
                候補を追加
              </button>
            </div>
            <div className="timetable-ocr-summary">
              保存対象 {importableItems.length} 件
              {hasBlockingErrors ? ' / 要修正の候補があります' : ''}
            </div>
            <div className="timetable-ocr-item-list">
              {items.map((item, index) => {
                const existingTemplate = getExistingTemplate(item);
                const isIgnored =
                  !item.title.trim() || isClassroomOnlyTitle(item.title);
                const hasError = hasBlockingItemError(item);

                return (
                  <article
                    className={
                      hasError
                        ? 'timetable-ocr-item has-error'
                        : 'timetable-ocr-item'
                    }
                    key={item.id}
                  >
                    <div className="timetable-ocr-item-title">
                      <strong>候補 {index + 1}</strong>
                      <span>
                        {isIgnored
                          ? '保存対象外'
                          : existingTemplate
                            ? '既存授業を上書き'
                            : '新規保存'}
                      </span>
                    </div>
                    <div className="timetable-ocr-item-grid">
                      <label className="field">
                        <span>曜日</span>
                        <select
                          value={item.weekday}
                          onChange={(event) =>
                            updateItem(
                              item.id,
                              'weekday',
                              event.target.value as RecurrenceWeekday | '',
                            )
                          }
                        >
                          <option value="">要修正</option>
                          {WEEKDAY_OPTIONS.map((weekday) => (
                            <option key={weekday.value} value={weekday.value}>
                              {weekday.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="field">
                        <span>時限</span>
                        <select
                          value={item.periodNumber ?? ''}
                          onChange={(event) =>
                            updateItem(
                              item.id,
                              'periodNumber',
                              event.target.value ? Number(event.target.value) : null,
                            )
                          }
                        >
                          <option value="">要修正</option>
                          {periodNumbers.map((periodNumber) => (
                            <option key={periodNumber} value={periodNumber}>
                              {periodNumber}限
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="field">
                        <span>開始</span>
                        <input
                          type="time"
                          value={item.startTime ?? ''}
                          onChange={(event) =>
                            updateItem(item.id, 'startTime', event.target.value || null)
                          }
                        />
                      </label>

                      <label className="field">
                        <span>終了</span>
                        <input
                          type="time"
                          value={item.endTime ?? ''}
                          onChange={(event) =>
                            updateItem(item.id, 'endTime', event.target.value || null)
                          }
                        />
                      </label>

                      <label className="field timetable-ocr-title-field">
                        <span>授業名</span>
                        <input
                          value={item.title}
                          onChange={(event) =>
                            updateItem(item.id, 'title', event.target.value)
                          }
                          placeholder="授業名"
                        />
                      </label>

                      <label className="field">
                        <span>教科</span>
                        <input
                          value={item.subject}
                          onChange={(event) =>
                            updateItem(item.id, 'subject', event.target.value)
                          }
                          placeholder="英語"
                        />
                      </label>

                      <label className="field">
                        <span>教室</span>
                        <input
                          value={item.classroom}
                          onChange={(event) =>
                            updateItem(item.id, 'classroom', event.target.value)
                          }
                          placeholder="402"
                        />
                      </label>

                      <label className="field timetable-ocr-memo-field">
                        <span>メモ</span>
                        <input
                          value={item.memo}
                          onChange={(event) =>
                            updateItem(item.id, 'memo', event.target.value)
                          }
                          placeholder="＊ / V"
                        />
                      </label>
                    </div>
                    <div className="row-actions timetable-ocr-item-actions">
                      {hasError ? (
                        <span className="timetable-ocr-warning">
                          曜日・時限・時刻を確認してください
                        </span>
                      ) : null}
                      <button
                        className="ghost-button timetable-delete-button"
                        onClick={() =>
                          setItems((current) =>
                            current.filter((candidate) => candidate.id !== item.id),
                          )
                        }
                        type="button"
                      >
                        削除
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          {saveError ? <p className="inline-error">{saveError}</p> : null}
        </div>
      </div>
    </div>
  );
}
