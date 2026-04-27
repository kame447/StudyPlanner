import { useMemo, useState, type FormEvent } from 'react';
import type {
  RecurrenceWeekday,
  ScheduleTemplate,
  ScheduleTemplateDraft,
  TimetablePeriod,
  TimetablePeriodDraft,
  TimetableTerm,
  TimetableTermDraft,
  TimetableTermKind,
} from '../types/domain';

interface TimetableViewProps {
  userId: string;
  activeTerm: TimetableTerm | null;
  timetableTerms: TimetableTerm[];
  timetablePeriods: TimetablePeriod[];
  scheduleTemplates: ScheduleTemplate[];
  onActivateTerm: (draft: TimetableTermDraft) => Promise<TimetableTerm>;
  onDeleteTerm: (term: TimetableTerm) => Promise<void>;
  onSaveTimetablePeriod: (
    draft: TimetablePeriodDraft,
    targetPeriodId?: string,
  ) => Promise<TimetablePeriod>;
  onDeleteTimetablePeriod: (period: TimetablePeriod) => Promise<void>;
  onSaveScheduleTemplate: (
    draft: ScheduleTemplateDraft,
    targetTemplateId?: string,
  ) => Promise<void>;
  onDeleteScheduleTemplate: (template: ScheduleTemplate) => Promise<void>;
}

type DisplayPeriod = TimetablePeriodDraft & {
  id?: string;
};

const WEEKDAY_OPTIONS: Array<{ value: RecurrenceWeekday; label: string }> = [
  { value: 'mon', label: '月' },
  { value: 'tue', label: '火' },
  { value: 'wed', label: '水' },
  { value: 'thu', label: '木' },
  { value: 'fri', label: '金' },
  { value: 'sat', label: '土' },
];

const TERM_KIND_OPTIONS: Array<{ value: TimetableTermKind; label: string }> = [
  { value: 'firstHalf', label: '前期' },
  { value: 'secondHalf', label: '後期' },
  { value: 'term1', label: '1学期' },
  { value: 'term2', label: '2学期' },
  { value: 'term3', label: '3学期' },
  { value: 'term4', label: '4学期' },
  { value: 'fullYear', label: '通年' },
];

const TERM_YEARS = [2024, 2025, 2026, 2027];

const DEFAULT_PERIODS: DisplayPeriod[] = [
  { userId: '', termId: 'default', periodNumber: 1, label: '1', startTime: '08:40', endTime: '10:10' },
  { userId: '', termId: 'default', periodNumber: 2, label: '2', startTime: '10:20', endTime: '11:50' },
  { userId: '', termId: 'default', periodNumber: 3, label: '3', startTime: '12:45', endTime: '14:15' },
  { userId: '', termId: 'default', periodNumber: 4, label: '4', startTime: '14:25', endTime: '15:55' },
  { userId: '', termId: 'default', periodNumber: 5, label: '5', startTime: '16:05', endTime: '17:35' },
  { userId: '', termId: 'default', periodNumber: 6, label: '6', startTime: '18:00', endTime: '19:30' },
];

function getTemplateTermId(template: ScheduleTemplate): string {
  return template.termId || 'default';
}

function getTimeKey(startTime: string | null, endTime: string | null): string | null {
  if (!startTime || !endTime) {
    return null;
  }

  return `${startTime}-${endTime}`;
}

function getTermKindLabel(kind: TimetableTermKind): string {
  return TERM_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? '通年';
}

function createTermLabel(year: number, kind: TimetableTermKind): string {
  return `${year}年 ${getTermKindLabel(kind)}`;
}

function toMinutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : 0;
}

function hasCompletePeriodTime(period: DisplayPeriod): period is DisplayPeriod & {
  startTime: string;
  endTime: string;
} {
  return Boolean(period.startTime && period.endTime);
}

function hasValidPeriodTime(period: DisplayPeriod): period is DisplayPeriod & {
  startTime: string;
  endTime: string;
} {
  return hasCompletePeriodTime(period) && toMinutes(period.endTime) > toMinutes(period.startTime);
}

function getPeriodTimeStatus(period: DisplayPeriod): 'valid' | 'partial' | 'invalid' {
  if (!period.startTime && !period.endTime) {
    return 'partial';
  }

  if (!hasCompletePeriodTime(period)) {
    return 'partial';
  }

  return hasValidPeriodTime(period) ? 'valid' : 'invalid';
}

function createTemplateDraft(
  userId: string,
  termId: string,
  weekday: RecurrenceWeekday,
  period: DisplayPeriod & { startTime: string; endTime: string },
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

function comparePeriods(left: DisplayPeriod, right: DisplayPeriod): number {
  return left.periodNumber - right.periodNumber;
}

function findPeriodNumberForTemplate(
  template: ScheduleTemplate,
  periods: DisplayPeriod[],
): number | null {
  if (template.periodNumber && periods.some((period) => period.periodNumber === template.periodNumber)) {
    return template.periodNumber;
  }

  const timeMatch = periods.find(
    (period) => getTimeKey(period.startTime, period.endTime) === getTimeKey(template.startTime, template.endTime),
  );

  if (timeMatch) {
    return timeMatch.periodNumber;
  }

  if (periods.length === 0) {
    return null;
  }

  const validPeriods = periods.filter(hasValidPeriodTime);

  if (validPeriods.length === 0) {
    return null;
  }

  const templateStartMinutes = toMinutes(template.startTime);
  return validPeriods
    .slice()
    .sort(
      (left, right) =>
        Math.abs(toMinutes(left.startTime) - templateStartMinutes) -
        Math.abs(toMinutes(right.startTime) - templateStartMinutes),
    )[0].periodNumber;
}

function makePeriodDraft(
  userId: string,
  termId: string,
  period: DisplayPeriod,
): TimetablePeriodDraft {
  return {
    userId,
    termId,
    periodNumber: period.periodNumber,
    label: period.label,
    startTime: period.startTime,
    endTime: period.endTime,
  };
}

export function TimetableView({
  userId,
  activeTerm,
  timetableTerms,
  timetablePeriods,
  scheduleTemplates,
  onActivateTerm,
  onDeleteTerm,
  onSaveTimetablePeriod,
  onDeleteTimetablePeriod,
  onSaveScheduleTemplate,
  onDeleteScheduleTemplate,
}: TimetableViewProps) {
  const activeTermId = activeTerm?.id ?? 'default';
  const [draft, setDraft] = useState<ScheduleTemplateDraft | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<ScheduleTemplate | null>(null);
  const [savingTemplateId, setSavingTemplateId] = useState<string | null>(null);
  const [savingPeriods, setSavingPeriods] = useState(false);
  const [periodActionError, setPeriodActionError] = useState<string | null>(null);
  const [isTermSheetOpen, setIsTermSheetOpen] = useState(false);
  const [isSavingTerm, setIsSavingTerm] = useState(false);
  const [deletingTermId, setDeletingTermId] = useState<string | null>(null);
  const [termYear, setTermYear] = useState(activeTerm?.year ?? new Date().getFullYear());
  const [termKind, setTermKind] = useState<TimetableTermKind>(activeTerm?.kind ?? 'fullYear');
  const selectedTermLabel = activeTerm?.label ?? createTermLabel(termYear, termKind);
  const visibleTimetableTerms = useMemo(
    () =>
      timetableTerms
        .slice()
        .sort((left, right) => {
          if (left.id === activeTermId) {
            return -1;
          }

          if (right.id === activeTermId) {
            return 1;
          }

          return right.updatedAt.localeCompare(left.updatedAt);
        })
        .slice(0, 4),
    [activeTermId, timetableTerms],
  );
  const savedPeriodsForTerm = useMemo(
    () =>
      timetablePeriods
        .filter((period) => period.termId === activeTermId)
        .map((period) => ({ ...period }))
        .sort(comparePeriods),
    [activeTermId, timetablePeriods],
  );
  const termTemplates = useMemo(
    () =>
      scheduleTemplates.filter(
        (template) => getTemplateTermId(template) === activeTermId,
      ),
    [activeTermId, scheduleTemplates],
  );
  const displayPeriods = useMemo(() => {
    const basePeriods =
      savedPeriodsForTerm.length > 0
        ? savedPeriodsForTerm
        : DEFAULT_PERIODS.map((period) => ({
            ...period,
            userId,
            termId: activeTermId,
          }));
    const periods = new Map<number, DisplayPeriod>();

    basePeriods.forEach((period) => {
      periods.set(period.periodNumber, period);
    });

    termTemplates.forEach((template) => {
      if (template.periodNumber && !periods.has(template.periodNumber)) {
        periods.set(template.periodNumber, {
          userId,
          termId: activeTermId,
          periodNumber: template.periodNumber,
          label: String(template.periodNumber),
          startTime: template.startTime,
          endTime: template.endTime,
        });
      }
    });

    return Array.from(periods.values()).sort(comparePeriods);
  }, [activeTermId, savedPeriodsForTerm, termTemplates, userId]);
  const templateByCell = useMemo(() => {
    const map = new Map<string, ScheduleTemplate[]>();

    termTemplates.forEach((template) => {
      const periodNumber = findPeriodNumberForTemplate(template, displayPeriods);

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

  function openCreateEditor(weekday: RecurrenceWeekday, period: DisplayPeriod) {
    if (!hasValidPeriodTime(period)) {
      setPeriodActionError('先にこの時限の開始時刻と終了時刻を設定してください。');
      return;
    }

    setEditingTemplate(null);
    setDraft(createTemplateDraft(userId, activeTermId, weekday, period));
  }

  function openEditEditor(template: ScheduleTemplate) {
    setEditingTemplate(template);
    setDraft(createTemplateDraftFromTemplate(template));
  }

  async function persistPeriods(periods: DisplayPeriod[]) {
    for (const period of periods) {
      await onSaveTimetablePeriod(makePeriodDraft(userId, activeTermId, period), period.id);
    }
  }

  async function updatePeriod(
    periodNumber: number,
    key: 'startTime' | 'endTime',
    value: string,
  ) {
    const nextValue = value || null;
    const nextPeriods = displayPeriods.map((period) =>
      period.periodNumber === periodNumber ? { ...period, [key]: nextValue } : period,
    );
    const nextPeriod = nextPeriods.find((period) => period.periodNumber === periodNumber);

    if (nextPeriod && getPeriodTimeStatus(nextPeriod) === 'invalid') {
      setPeriodActionError('時限の終了時刻は開始時刻より後にしてください。');
      return;
    }

    setSavingPeriods(true);
    try {
      setPeriodActionError(null);
      await persistPeriods(nextPeriods);
    } finally {
      setSavingPeriods(false);
    }
  }

  async function addPeriod() {
    const lastPeriod = displayPeriods[displayPeriods.length - 1] ?? DEFAULT_PERIODS[0];
    const periodNumber = lastPeriod.periodNumber + 1;
    const nextPeriod: DisplayPeriod = {
      userId,
      termId: activeTermId,
      periodNumber,
      label: String(periodNumber),
      startTime: null,
      endTime: null,
    };

    setSavingPeriods(true);
    try {
      setPeriodActionError(null);
      await persistPeriods([...displayPeriods, nextPeriod]);
    } finally {
      setSavingPeriods(false);
    }
  }

  async function deleteLastPeriod() {
    if (displayPeriods.length <= 1) {
      return;
    }

    const lastPeriod = displayPeriods[displayPeriods.length - 1];
    const lastPeriodHasClass = termTemplates.some(
      (template) =>
        findPeriodNumberForTemplate(template, displayPeriods) === lastPeriod.periodNumber,
    );

    if (lastPeriodHasClass || !lastPeriod.id) {
      const remainingPeriods = displayPeriods.slice(0, -1);

      if (lastPeriodHasClass) {
        setPeriodActionError('授業が入っている時限は削除できません。');
        return;
      }

      setSavingPeriods(true);
      try {
        setPeriodActionError(null);
        await persistPeriods(remainingPeriods);
      } finally {
        setSavingPeriods(false);
      }
      return;
    }

    setSavingPeriods(true);
    try {
      setPeriodActionError(null);
      await onDeleteTimetablePeriod(lastPeriod as TimetablePeriod);
    } finally {
      setSavingPeriods(false);
    }
  }

  async function applyTermSelection() {
    if (isSavingTerm) {
      return;
    }

    const nextLabel = createTermLabel(termYear, termKind);

    setIsSavingTerm(true);
    try {
      await onActivateTerm({
        userId,
        year: termYear,
        kind: termKind,
        label: nextLabel,
        isActive: true,
      });
      setIsTermSheetOpen(false);
    } finally {
      setIsSavingTerm(false);
    }
  }

  async function deleteTerm(term: TimetableTerm) {
    if (deletingTermId || isSavingTerm) {
      return;
    }

    setDeletingTermId(term.id);
    try {
      await onDeleteTerm(term);
    } finally {
      setDeletingTermId(null);
    }
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
          termId: draft.termId || activeTermId,
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
        <div className="timetable-title-block">
          <h2>{selectedTermLabel}</h2>
        </div>
        <div className="timetable-term-control">
          <button
            className="ghost-button timetable-term-switch"
            onClick={() => {
              setTermYear(activeTerm?.year ?? termYear);
              setTermKind(activeTerm?.kind ?? termKind);
              setIsTermSheetOpen(true);
            }}
            type="button"
          >
            学期切替
          </button>
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
              <div
                className={
                  getPeriodTimeStatus(period) === 'valid'
                    ? 'timetable-period-cell'
                    : 'timetable-period-cell needs-time'
                }
              >
                <strong>{period.label}限</strong>
                <label>
                  <input
                    type="time"
                    value={period.startTime ?? ''}
                    disabled={savingPeriods}
                    onChange={(event) => {
                      void updatePeriod(period.periodNumber, 'startTime', event.target.value);
                    }}
                  />
                </label>
                <span className="timetable-period-separator" aria-hidden="true" />
                <label>
                  <input
                    type="time"
                    value={period.endTime ?? ''}
                    disabled={savingPeriods}
                    onChange={(event) => {
                      void updatePeriod(period.periodNumber, 'endTime', event.target.value);
                    }}
                  />
                </label>
                {getPeriodTimeStatus(period) === 'valid' ? null : (
                  <span className="timetable-period-status">
                    {getPeriodTimeStatus(period) === 'invalid' ? '要修正' : '時刻未設定'}
                  </span>
                )}
              </div>
              {WEEKDAY_OPTIONS.map((weekday) => {
                const cellKey = `${weekday.value}:${period.periodNumber}`;
                const templates = templateByCell.get(cellKey) ?? [];

                return (
                  <button
                    className={
                      [
                        'timetable-grid-cell',
                        templates.length > 0 ? 'has-class' : '',
                        hasValidPeriodTime(period) ? '' : 'needs-time',
                      ]
                        .filter(Boolean)
                        .join(' ')
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
                            {template.subject ? (
                              <span className="timetable-class-subject">
                                {template.subject}
                              </span>
                            ) : null}
                            <span className="timetable-class-meta">
                              {template.classroom || `${template.startTime}-${template.endTime}`}
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
        <button
          className="ghost-button"
          disabled={savingPeriods || displayPeriods.length <= 1}
          onClick={() => {
            void deleteLastPeriod();
          }}
          type="button"
        >
          － 時限削除
        </button>
        <button
          className="ghost-button"
          disabled={savingPeriods}
          onClick={() => {
            void addPeriod();
          }}
          type="button"
        >
          ＋ 時限追加
        </button>
      </div>
      {periodActionError ? (
        <p className="timetable-period-error">{periodActionError}</p>
      ) : null}

      {isTermSheetOpen ? (
        <div
          className="overlay timetable-term-sheet-overlay"
          onClick={() => {
            if (!isSavingTerm) {
              setIsTermSheetOpen(false);
            }
          }}
        >
          <div
            className="timetable-term-sheet"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="timetable-term-sheet-handle" aria-hidden="true" />
            <div className="section-header">
              <div>
                <h2>学期切替</h2>
                <p>年度と学期を選択します。</p>
              </div>
              <button
                className="ghost-button"
                disabled={isSavingTerm}
                onClick={() => setIsTermSheetOpen(false)}
                type="button"
              >
                閉じる
              </button>
            </div>
            <div className="timetable-term-sheet-body">
              <label className="field">
                <span>年度</span>
                <select
                  value={termYear}
                  disabled={isSavingTerm}
                  onChange={(event) => setTermYear(Number(event.target.value))}
                >
                  {TERM_YEARS.map((year) => (
                    <option key={year} value={year}>
                      {year}年
                    </option>
                  ))}
                </select>
              </label>
              <div className="field">
                <span>学期</span>
                <div className="timetable-term-kind-grid">
                  {TERM_KIND_OPTIONS.map((option) => (
                    <button
                      className={
                        option.value === termKind
                          ? 'segment active timetable-term-kind'
                          : 'segment timetable-term-kind'
                      }
                      disabled={isSavingTerm}
                      key={option.value}
                      onClick={() => setTermKind(option.value)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              {visibleTimetableTerms.length > 0 ? (
                <div className="timetable-existing-terms">
                  <span>保存済み</span>
                  <div>
                    {visibleTimetableTerms.map((term) => (
                      <span
                        className={
                          term.id === activeTermId
                            ? 'timetable-existing-term active'
                            : 'timetable-existing-term'
                        }
                        key={term.id}
                      >
                        <button
                          className="timetable-existing-term-select"
                          disabled={isSavingTerm || deletingTermId !== null}
                          onClick={() => {
                            setTermYear(term.year);
                            setTermKind(term.kind);
                          }}
                          type="button"
                        >
                          {term.label}
                        </button>
                        {term.id === activeTermId ? null : (
                          <button
                            className="timetable-existing-term-delete"
                            disabled={isSavingTerm || deletingTermId === term.id}
                            onClick={() => {
                              void deleteTerm(term);
                            }}
                            type="button"
                            aria-label="学期を削除"
                            title="学期を削除"
                          >
                            ×
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="row-actions timetable-import-actions">
              <button
                className="ghost-button"
                disabled={isSavingTerm}
                onClick={() => setIsTermSheetOpen(false)}
                type="button"
              >
                キャンセル
              </button>
              <button
                className="primary-button"
                disabled={isSavingTerm || deletingTermId !== null}
                onClick={() => {
                  void applyTermSelection();
                }}
                type="button"
              >
                {isSavingTerm ? '切替中...' : '切り替える'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {draft ? (
        <div className="overlay modal-overlay timetable-modal-overlay" onClick={closeEditor}>
          <form
            className="modal-card timetable-editor-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={handleSubmit}
          >
            <div className="timetable-editor-header">
              <button className="ghost-button" onClick={closeEditor} type="button">
                閉じる
              </button>
              <div className="timetable-editor-heading">
                <h2>{editingTemplate ? '授業を編集' : '授業を追加'}</h2>
                <p>
                  {WEEKDAY_OPTIONS.find((weekday) => weekday.value === draft.weekday)?.label}
                  曜 / {draft.periodNumber ?? '-'}限
                </p>
              </div>
              <button
                className="primary-button timetable-editor-save"
                disabled={savingTemplateId !== null || !draft.title.trim()}
                type="submit"
              >
                保存
              </button>
            </div>

            <div className="timetable-editor-body">
              <section className="timetable-editor-card timetable-title-card">
                <label className="field timetable-title-field">
                  <span>授業名</span>
                  <input
                    value={draft.title}
                    onChange={(event) => updateDraft('title', event.target.value)}
                    placeholder="例: 英語演習 / 情報科学概論"
                  />
                </label>
              </section>

              <section className="timetable-editor-card">
                <div className="timetable-card-title">
                  <strong>曜日・時限</strong>
                </div>
                <div className="timetable-schedule-grid">
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

                        if (!hasValidPeriodTime(nextPeriod)) {
                          setPeriodActionError('先にこの時限の開始時刻と終了時刻を設定してください。');
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
                          {hasValidPeriodTime(period)
                            ? ''
                            : '（時刻未設定）'}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>開始</span>
                    <input
                      type="time"
                      value={draft.startTime}
                      onChange={(event) => updateDraft('startTime', event.target.value)}
                    />
                  </label>

                  <label className="field">
                    <span>終了</span>
                    <input
                      type="time"
                      value={draft.endTime}
                      onChange={(event) => updateDraft('endTime', event.target.value)}
                    />
                  </label>
                </div>
              </section>

              <section className="timetable-editor-card">
                <div className="timetable-card-title">
                  <strong>詳細</strong>
                </div>
                <div className="timetable-detail-grid">
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

                  <label className="field timetable-memo-field">
                    <span>メモ</span>
                    <textarea
                      value={draft.memo}
                      onChange={(event) => updateDraft('memo', event.target.value)}
                      rows={2}
                    />
                  </label>
                </div>
              </section>
            </div>

            {editingTemplate ? (
              <div className="row-actions timetable-editor-actions">
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
              </div>
            ) : null}
          </form>
        </div>
      ) : null}
    </section>
  );
}
