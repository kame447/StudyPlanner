import { useMemo, useState, type FormEvent } from 'react';
import type {
  RecurrenceWeekday,
  ScheduleTemplate,
  ScheduleTemplateDraft,
} from '../types/domain';

interface TimetableViewProps {
  userId: string;
  selectedTermId: string;
  onChangeTerm: (termId: string) => void;
  scheduleTemplates: ScheduleTemplate[];
  onSaveScheduleTemplate: (
    draft: ScheduleTemplateDraft,
    targetTemplateId?: string,
  ) => Promise<void>;
  onDeleteScheduleTemplate: (template: ScheduleTemplate) => Promise<void>;
}

interface TimetablePeriod {
  periodNumber: number;
  label: string;
  startTime: string;
  endTime: string;
}

const TIMETABLE_TERMS = [
  { id: 'default', label: '現在の学期' },
  { id: '2026-spring', label: '2026年 春学期' },
  { id: '2026-fall', label: '2026年 秋学期' },
];

const WEEKDAY_OPTIONS: Array<{ value: RecurrenceWeekday; label: string }> = [
  { value: 'mon', label: '月' },
  { value: 'tue', label: '火' },
  { value: 'wed', label: '水' },
  { value: 'thu', label: '木' },
  { value: 'fri', label: '金' },
  { value: 'sat', label: '土' },
];

const DEFAULT_PERIODS: TimetablePeriod[] = [
  { periodNumber: 1, label: '1', startTime: '09:00', endTime: '10:30' },
  { periodNumber: 2, label: '2', startTime: '10:40', endTime: '12:10' },
  { periodNumber: 3, label: '3', startTime: '13:00', endTime: '14:30' },
  { periodNumber: 4, label: '4', startTime: '14:40', endTime: '16:10' },
  { periodNumber: 5, label: '5', startTime: '16:20', endTime: '17:50' },
  { periodNumber: 6, label: '6', startTime: '18:00', endTime: '19:30' },
];

function getTemplateTermId(template: ScheduleTemplate): string {
  return template.termId || 'default';
}

function getTimeKey(startTime: string, endTime: string): string {
  return `${startTime}-${endTime}`;
}

function createTemplateDraft(
  userId: string,
  termId: string,
  weekday: RecurrenceWeekday,
  period: TimetablePeriod,
): ScheduleTemplateDraft {
  return {
    userId,
    title: '',
    subject: '',
    type: 'school-event',
    weekday,
    startTime: period.startTime,
    endTime: period.endTime,
    termId,
    periodNumber: period.periodNumber,
    classroom: '',
    memo: '',
    active: true,
  };
}

function createTemplateDraftFromTemplate(
  template: ScheduleTemplate,
): ScheduleTemplateDraft {
  return {
    userId: template.userId,
    title: template.title,
    subject: template.subject,
    type: template.type,
    weekday: template.weekday,
    startTime: template.startTime,
    endTime: template.endTime,
    termId: getTemplateTermId(template),
    periodNumber: template.periodNumber,
    classroom: template.classroom ?? '',
    memo: template.memo,
    active: template.active,
  };
}

function comparePeriods(left: TimetablePeriod, right: TimetablePeriod): number {
  return left.periodNumber - right.periodNumber;
}

export function TimetableView({
  userId,
  selectedTermId,
  onChangeTerm,
  scheduleTemplates,
  onSaveScheduleTemplate,
  onDeleteScheduleTemplate,
}: TimetableViewProps) {
  const [periodRows, setPeriodRows] = useState<TimetablePeriod[]>(DEFAULT_PERIODS);
  const [draft, setDraft] = useState<ScheduleTemplateDraft | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<ScheduleTemplate | null>(null);
  const [savingTemplateId, setSavingTemplateId] = useState<string | null>(null);
  const selectedTerm =
    TIMETABLE_TERMS.find((term) => term.id === selectedTermId) ?? TIMETABLE_TERMS[0];
  const termTemplates = useMemo(
    () =>
      scheduleTemplates.filter(
        (template) => getTemplateTermId(template) === selectedTermId,
      ),
    [scheduleTemplates, selectedTermId],
  );
  const displayPeriods = useMemo(() => {
    const periods = new Map<number, TimetablePeriod>();
    const timeKeys = new Set(periodRows.map((period) => getTimeKey(period.startTime, period.endTime)));

    periodRows.forEach((period) => {
      periods.set(period.periodNumber, period);
    });

    const templatesWithoutKnownPeriod = termTemplates
      .filter((template) => {
        if (template.periodNumber && periods.has(template.periodNumber)) {
          return false;
        }

        return !timeKeys.has(getTimeKey(template.startTime, template.endTime));
      })
      .sort((left, right) => left.startTime.localeCompare(right.startTime));

    let nextPeriodNumber =
      Math.max(...Array.from(periods.keys()), DEFAULT_PERIODS.length) + 1;

    templatesWithoutKnownPeriod.forEach((template) => {
      const periodNumber = template.periodNumber ?? nextPeriodNumber;
      periods.set(periodNumber, {
        periodNumber,
        label: String(periodNumber),
        startTime: template.startTime,
        endTime: template.endTime,
      });
      nextPeriodNumber = Math.max(nextPeriodNumber, periodNumber + 1);
    });

    return Array.from(periods.values()).sort(comparePeriods);
  }, [periodRows, termTemplates]);
  const templateByCell = useMemo(() => {
    const map = new Map<string, ScheduleTemplate[]>();
    const periodByTime = new Map(
      displayPeriods.map((period) => [
        getTimeKey(period.startTime, period.endTime),
        period.periodNumber,
      ]),
    );

    termTemplates.forEach((template) => {
      const periodNumber =
        template.periodNumber ??
        periodByTime.get(getTimeKey(template.startTime, template.endTime));

      if (!periodNumber) {
        return;
      }

      const key = `${template.weekday}:${periodNumber}`;
      const templates = map.get(key) ?? [];
      templates.push(template);
      map.set(
        key,
        templates.sort((left, right) => left.startTime.localeCompare(right.startTime)),
      );
    });

    return map;
  }, [displayPeriods, termTemplates]);

  function updateDraft<K extends keyof ScheduleTemplateDraft>(
    key: K,
    value: ScheduleTemplateDraft[K],
  ) {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        [key]: value,
      };
    });
  }

  function closeEditor() {
    setDraft(null);
    setEditingTemplate(null);
  }

  function openCreateEditor(weekday: RecurrenceWeekday, period: TimetablePeriod) {
    setEditingTemplate(null);
    setDraft(createTemplateDraft(userId, selectedTermId, weekday, period));
  }

  function openEditEditor(template: ScheduleTemplate) {
    setEditingTemplate(template);
    setDraft(createTemplateDraftFromTemplate(template));
  }

  function updatePeriod(
    periodNumber: number,
    key: 'startTime' | 'endTime',
    value: string,
  ) {
    setPeriodRows((current) =>
      current.map((period) =>
        period.periodNumber === periodNumber
          ? { ...period, [key]: value }
          : period,
      ),
    );
  }

  function addPeriod() {
    setPeriodRows((current) => {
      const lastPeriod = current[current.length - 1] ?? DEFAULT_PERIODS[0];
      const periodNumber = lastPeriod.periodNumber + 1;

      return [
        ...current,
        {
          periodNumber,
          label: String(periodNumber),
          startTime: lastPeriod.endTime,
          endTime: lastPeriod.endTime,
        },
      ];
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!draft || !draft.title.trim()) {
      return;
    }

    setSavingTemplateId(editingTemplate?.id ?? 'new');
    try {
      await onSaveScheduleTemplate(
        {
          ...draft,
          userId,
          title: draft.title.trim(),
          subject: draft.subject.trim(),
          termId: draft.termId || selectedTermId,
          classroom: draft.classroom?.trim() ?? '',
          memo: draft.memo.trim(),
          active: true,
        },
        editingTemplate?.id,
      );
      closeEditor();
    } finally {
      setSavingTemplateId(null);
    }
  }

  async function deleteTemplate() {
    if (!editingTemplate) {
      return;
    }

    setSavingTemplateId(editingTemplate.id);
    try {
      await onDeleteScheduleTemplate(editingTemplate);
      closeEditor();
    } finally {
      setSavingTemplateId(null);
    }
  }

  return (
    <section className="panel timetable-view">
      <div className="section-header timetable-header">
        <div>
          <h2>時間割</h2>
          <p>空きコマも含めた週間テンプレートです。Dailyには手動で反映します。</p>
        </div>
        <div className="timetable-term-control">
          <span>{selectedTerm.label}</span>
          <label>
            <span>学期切替</span>
            <select
              value={selectedTermId}
              onChange={(event) => onChangeTerm(event.target.value)}
            >
              {TIMETABLE_TERMS.map((term) => (
                <option key={term.id} value={term.id}>
                  {term.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="timetable-grid-shell">
        <div
          className="timetable-grid"
          style={{
            gridTemplateColumns: `var(--timetable-period-column-width) repeat(${WEEKDAY_OPTIONS.length}, minmax(0, 1fr))`,
          }}
        >
          <div className="timetable-corner-cell" />
          {WEEKDAY_OPTIONS.map((weekday) => (
            <div className="timetable-weekday-cell" key={weekday.value}>
              {weekday.label}
            </div>
          ))}

          {displayPeriods.map((period) => (
            <div className="timetable-row-contents" key={period.periodNumber}>
              <div className="timetable-period-cell">
                <strong>{period.label}限</strong>
                <label>
                  <input
                    type="time"
                    value={period.startTime}
                    onChange={(event) =>
                      updatePeriod(period.periodNumber, 'startTime', event.target.value)
                    }
                  />
                </label>
                <span aria-hidden="true">|</span>
                <label>
                  <input
                    type="time"
                    value={period.endTime}
                    onChange={(event) =>
                      updatePeriod(period.periodNumber, 'endTime', event.target.value)
                    }
                  />
                </label>
              </div>
              {WEEKDAY_OPTIONS.map((weekday) => {
                const cellKey = `${weekday.value}:${period.periodNumber}`;
                const templates = templateByCell.get(cellKey) ?? [];

                return (
                  <button
                    className={
                      templates.length > 0
                        ? 'timetable-grid-cell has-class'
                        : 'timetable-grid-cell'
                    }
                    key={cellKey}
                    onClick={() =>
                      templates[0]
                        ? openEditEditor(templates[0])
                        : openCreateEditor(weekday.value, period)
                    }
                    type="button"
                  >
                    {templates.length > 0 ? (
                      <span className="timetable-cell-stack">
                        {templates.map((template) => (
                          <span className="timetable-class-card" key={template.id}>
                            <strong>{template.title}</strong>
                            {template.subject ? <span>{template.subject}</span> : null}
                            {template.classroom ? (
                              <span>{template.classroom}</span>
                            ) : null}
                            <span>
                              {template.startTime}-{template.endTime}
                            </span>
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="timetable-empty-cell-label">追加</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="row-actions timetable-grid-actions">
        <button className="ghost-button" onClick={addPeriod} type="button">
          ＋ 時限追加
        </button>
      </div>

      {draft ? (
        <div className="overlay modal-overlay" onClick={closeEditor}>
          <form
            className="modal-card timetable-editor-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={handleSubmit}
          >
            <div className="section-header">
              <div>
                <h2>{editingTemplate ? '授業を編集' : '授業を追加'}</h2>
                <p>
                  {WEEKDAY_OPTIONS.find((weekday) => weekday.value === draft.weekday)?.label}
                  曜 / {draft.periodNumber ?? '-'}限
                </p>
              </div>
              <button className="ghost-button" onClick={closeEditor} type="button">
                閉じる
              </button>
            </div>

            <div className="form-grid compact timetable-form-grid">
              <label className="field">
                <span>曜日</span>
                <select
                  value={draft.weekday}
                  onChange={(event) =>
                    updateDraft('weekday', event.target.value as RecurrenceWeekday)
                  }
                >
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
                  value={draft.periodNumber ?? ''}
                  onChange={(event) => {
                    const nextPeriod = displayPeriods.find(
                      (period) => period.periodNumber === Number(event.target.value),
                    );

                    if (!nextPeriod) {
                      return;
                    }

                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            periodNumber: nextPeriod.periodNumber,
                            startTime: nextPeriod.startTime,
                            endTime: nextPeriod.endTime,
                          }
                        : current,
                    );
                  }}
                >
                  {displayPeriods.map((period) => (
                    <option key={period.periodNumber} value={period.periodNumber}>
                      {period.label}限
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>開始時刻</span>
                <input
                  type="time"
                  value={draft.startTime}
                  onChange={(event) => updateDraft('startTime', event.target.value)}
                />
              </label>

              <label className="field">
                <span>終了時刻</span>
                <input
                  type="time"
                  value={draft.endTime}
                  onChange={(event) => updateDraft('endTime', event.target.value)}
                />
              </label>

              <label className="field">
                <span>授業名</span>
                <input
                  value={draft.title}
                  onChange={(event) => updateDraft('title', event.target.value)}
                  placeholder="英語演習"
                />
              </label>

              <label className="field">
                <span>教科</span>
                <input
                  value={draft.subject}
                  onChange={(event) => updateDraft('subject', event.target.value)}
                  placeholder="英語"
                />
              </label>

              <label className="field">
                <span>教室</span>
                <input
                  value={draft.classroom ?? ''}
                  onChange={(event) => updateDraft('classroom', event.target.value)}
                  placeholder="A101"
                />
              </label>
            </div>

            <label className="field">
              <span>メモ</span>
              <textarea
                value={draft.memo}
                onChange={(event) => updateDraft('memo', event.target.value)}
                rows={3}
              />
            </label>

            <div className="row-actions timetable-editor-actions">
              {editingTemplate ? (
                <button
                  className="ghost-button timetable-delete-button"
                  disabled={savingTemplateId === editingTemplate.id}
                  onClick={() => {
                    void deleteTemplate();
                  }}
                  type="button"
                >
                  削除
                </button>
              ) : null}
              <button className="ghost-button" onClick={closeEditor} type="button">
                キャンセル
              </button>
              <button
                className="primary-button"
                disabled={savingTemplateId !== null || !draft.title.trim()}
                type="submit"
              >
                保存
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
