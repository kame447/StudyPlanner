import { useMemo, useState, type FormEvent } from 'react';
import type {
  RecurrenceWeekday,
  ScheduleTemplate,
  ScheduleTemplateDraft,
} from '../types/domain';

interface TimetableViewProps {
  userId: string;
  scheduleTemplates: ScheduleTemplate[];
  onSaveScheduleTemplate: (
    draft: ScheduleTemplateDraft,
    targetTemplateId?: string,
  ) => Promise<void>;
  onDeleteScheduleTemplate: (template: ScheduleTemplate) => Promise<void>;
}

const WEEKDAY_OPTIONS: Array<{ value: RecurrenceWeekday; label: string }> = [
  { value: 'mon', label: '月' },
  { value: 'tue', label: '火' },
  { value: 'wed', label: '水' },
  { value: 'thu', label: '木' },
  { value: 'fri', label: '金' },
  { value: 'sat', label: '土' },
  { value: 'sun', label: '日' },
];

function createEmptyTemplateDraft(userId: string): ScheduleTemplateDraft {
  return {
    userId,
    title: '',
    subject: '',
    type: 'school-event',
    weekday: 'mon',
    startTime: '09:00',
    endTime: '10:00',
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
    classroom: template.classroom ?? '',
    memo: template.memo,
    active: template.active,
  };
}

function compareScheduleTemplates(
  left: ScheduleTemplate,
  right: ScheduleTemplate,
): number {
  const startDelta = left.startTime.localeCompare(right.startTime);

  if (startDelta !== 0) {
    return startDelta;
  }

  return left.endTime.localeCompare(right.endTime);
}

export function TimetableView({
  userId,
  scheduleTemplates,
  onSaveScheduleTemplate,
  onDeleteScheduleTemplate,
}: TimetableViewProps) {
  const [draft, setDraft] = useState<ScheduleTemplateDraft>(() =>
    createEmptyTemplateDraft(userId),
  );
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [savingTemplateId, setSavingTemplateId] = useState<string | null>(null);
  const templatesByWeekday = useMemo(() => {
    const map = new Map<RecurrenceWeekday, ScheduleTemplate[]>();

    WEEKDAY_OPTIONS.forEach((weekday) => {
      map.set(weekday.value, []);
    });

    scheduleTemplates.forEach((template) => {
      const templates = map.get(template.weekday) ?? [];
      templates.push(template);
      map.set(template.weekday, templates);
    });

    WEEKDAY_OPTIONS.forEach((weekday) => {
      map.set(
        weekday.value,
        [...(map.get(weekday.value) ?? [])].sort(compareScheduleTemplates),
      );
    });

    return map;
  }, [scheduleTemplates]);

  function updateDraft<K extends keyof ScheduleTemplateDraft>(
    key: K,
    value: ScheduleTemplateDraft[K],
  ) {
    setDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function resetForm() {
    setDraft(createEmptyTemplateDraft(userId));
    setEditingTemplateId(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!draft.title.trim()) {
      return;
    }

    setSavingTemplateId(editingTemplateId ?? 'new');
    try {
      await onSaveScheduleTemplate(
        {
          ...draft,
          userId,
          title: draft.title.trim(),
          subject: draft.subject.trim(),
          classroom: draft.classroom?.trim() ?? '',
          memo: draft.memo.trim(),
          active: true,
        },
        editingTemplateId ?? undefined,
      );
      resetForm();
    } finally {
      setSavingTemplateId(null);
    }
  }

  function startEdit(template: ScheduleTemplate) {
    setEditingTemplateId(template.id);
    setDraft(createTemplateDraftFromTemplate(template));
  }

  async function deleteTemplate(template: ScheduleTemplate) {
    setSavingTemplateId(template.id);
    try {
      await onDeleteScheduleTemplate(template);

      if (editingTemplateId === template.id) {
        resetForm();
      }
    } finally {
      setSavingTemplateId(null);
    }
  }

  return (
    <section className="panel timetable-view">
      <div className="section-header timetable-header">
        <div>
          <h2>時間割</h2>
          <p>週間の授業テンプレートを管理します。Dailyには手動で反映します。</p>
        </div>
      </div>

      <form className="timetable-form" onSubmit={handleSubmit}>
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
            rows={2}
          />
        </label>

        <div className="row-actions timetable-form-actions">
          {editingTemplateId ? (
            <button className="ghost-button" onClick={resetForm} type="button">
              キャンセル
            </button>
          ) : null}
          <button
            className="primary-button"
            disabled={savingTemplateId !== null || !draft.title.trim()}
            type="submit"
          >
            {editingTemplateId ? '更新' : '追加'}
          </button>
        </div>
      </form>

      <div className="timetable-week-grid">
        {WEEKDAY_OPTIONS.map((weekday) => {
          const templates = templatesByWeekday.get(weekday.value) ?? [];

          return (
            <section className="timetable-day-column" key={weekday.value}>
              <div className="timetable-day-head">
                <h3>{weekday.label}</h3>
                <span>{templates.length}</span>
              </div>
              {templates.length > 0 ? (
                <div className="timetable-template-list">
                  {templates.map((template) => (
                    <article
                      className="timetable-template-card"
                      key={template.id}
                    >
                      <div className="timetable-template-main">
                        <strong>{template.title}</strong>
                        <span>
                          {template.startTime}-{template.endTime}
                        </span>
                      </div>
                      <div className="timetable-template-meta">
                        {template.subject ? <span>{template.subject}</span> : null}
                        {template.classroom ? (
                          <span>{template.classroom}</span>
                        ) : null}
                      </div>
                      {template.memo ? <p>{template.memo}</p> : null}
                      <div className="timetable-template-actions">
                        <button
                          className="ghost-button"
                          disabled={savingTemplateId === template.id}
                          onClick={() => startEdit(template)}
                          type="button"
                        >
                          編集
                        </button>
                        <button
                          className="ghost-button timetable-delete-button"
                          disabled={savingTemplateId === template.id}
                          onClick={() => {
                            void deleteTemplate(template);
                          }}
                          type="button"
                        >
                          削除
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="empty-copy timetable-empty">登録なし</p>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
