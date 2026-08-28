import {
  Suspense,
  lazy,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import {
  createTimetableOcrFilePayload,
  requestTimetableOcr,
  type TimetableOcrResult,
} from '../lib/timetableOcrImport';
import { resolveTimetableAlternatingWeek } from '../lib/timetableCalendar';
import type {
  RecurrenceWeekday,
  ScheduleTemplate,
  ScheduleTemplateAlternatingWeek,
  ScheduleTemplateDraft,
  ScheduleTemplateWeekInterval,
  TimetableAlternatingWeek,
  TimetablePeriod,
  TimetablePeriodDraft,
  TimetableTerm,
  TimetableTermDraft,
} from '../types/domain';
import '../styles/timetable-period-config.css';

const TimetableOcrImportDialog = lazy(() =>
  import('./TimetableOcrImportDialog').then((module) => ({
    default: module.TimetableOcrImportDialog,
  })),
);

interface TimetableViewProps {
  userId: string;
  activeTerm: TimetableTerm | null;
  timetableTerms?: TimetableTerm[];
  timetablePeriods: TimetablePeriod[];
  scheduleTemplates: ScheduleTemplate[];
  onActivateTerm: (draft: TimetableTermDraft) => Promise<TimetableTerm>;
  onClearTermData: (term: TimetableTerm) => Promise<void>;
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

interface PeriodFormState {
  id?: string;
  label: string;
  startDate: string;
  endDate: string;
  usesAlternatingWeeks: boolean;
  alternatingWeekAnchorDate: string;
}

const WEEKDAY_OPTIONS: Array<{ value: RecurrenceWeekday; label: string }> = [
  { value: 'mon', label: '月' },
  { value: 'tue', label: '火' },
  { value: 'wed', label: '水' },
  { value: 'thu', label: '木' },
  { value: 'fri', label: '金' },
  { value: 'sat', label: '土' },
];

const DEFAULT_PERIODS: DisplayPeriod[] = [
  { userId: '', termId: 'default', periodNumber: 1, label: '1', startTime: '08:40', endTime: '10:10' },
  { userId: '', termId: 'default', periodNumber: 2, label: '2', startTime: '10:20', endTime: '11:50' },
  { userId: '', termId: 'default', periodNumber: 3, label: '3', startTime: '12:45', endTime: '14:15' },
  { userId: '', termId: 'default', periodNumber: 4, label: '4', startTime: '14:25', endTime: '15:55' },
  { userId: '', termId: 'default', periodNumber: 5, label: '5', startTime: '16:05', endTime: '17:35' },
  { userId: '', termId: 'default', periodNumber: 6, label: '6', startTime: '18:00', endTime: '19:30' },
];

const TIMETABLE_IMPORT_FILE_ACCEPT = 'image/png,image/jpeg,.png,.jpg,.jpeg,.pdf,application/pdf';

function getTemplateTermId(template: ScheduleTemplate): string {
  return template.termId || 'default';
}

function getTimeKey(startTime: string | null, endTime: string | null): string | null {
  return startTime && endTime ? `${startTime}-${endTime}` : null;
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
  if (!hasCompletePeriodTime(period)) {
    return 'partial';
  }

  return hasValidPeriodTime(period) ? 'valid' : 'invalid';
}

function getTodayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createPeriodForm(term: TimetableTerm | null): PeriodFormState {
  if (!term) {
    return {
      label: '',
      startDate: '',
      endDate: '',
      usesAlternatingWeeks: false,
      alternatingWeekAnchorDate: '',
    };
  }

  return {
    id: term.id,
    label: term.label,
    startDate: term.startDate ?? '',
    endDate: term.endDate ?? '',
    usesAlternatingWeeks: term.usesAlternatingWeeks === true,
    alternatingWeekAnchorDate: term.alternatingWeekAnchorDate ?? term.startDate ?? '',
  };
}

function formatPeriodRange(term: TimetableTerm | null): string {
  if (!term?.startDate && !term?.endDate) {
    return '期間未設定';
  }

  return `${term.startDate ?? '開始日未設定'} 〜 ${term.endDate ?? '終了日未設定'}`;
}

function createTemplateDraft(
  userId: string,
  termId: string,
  weekday: RecurrenceWeekday,
  period: DisplayPeriod & { startTime: string; endTime: string },
  activeTerm: TimetableTerm | null,
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
    alternatingWeek: activeTerm?.usesAlternatingWeeks ? 'both' : undefined,
    weekInterval: 1,
    weekIntervalAnchorDate: null,
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
    alternatingWeek: template.alternatingWeek ?? 'both',
    weekInterval: template.weekInterval ?? 1,
    weekIntervalAnchorDate: template.weekIntervalAnchorDate ?? null,
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

function templateVisibleInAlternatingWeek(
  template: ScheduleTemplate,
  usesAlternatingWeeks: boolean,
  week: TimetableAlternatingWeek,
): boolean {
  if (!usesAlternatingWeeks) {
    return true;
  }

  const scope = template.alternatingWeek ?? 'both';
  return scope === 'both' || scope === week;
}

function getTemplatePatternLabel(template: ScheduleTemplate): string {
  const labels: string[] = [];

  if (template.alternatingWeek === 'a') {
    labels.push('A週');
  } else if (template.alternatingWeek === 'b') {
    labels.push('B週');
  }

  if (template.weekInterval === 2) {
    labels.push('隔週');
  }

  return labels.join(' · ');
}

export function TimetableView({
  userId,
  activeTerm,
  timetableTerms = [],
  timetablePeriods,
  scheduleTemplates,
  onActivateTerm,
  onClearTermData,
  onSaveTimetablePeriod,
  onDeleteTimetablePeriod,
  onSaveScheduleTemplate,
  onDeleteScheduleTemplate,
}: TimetableViewProps) {
  const activeTermId = activeTerm?.id ?? 'default';
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState<ScheduleTemplateDraft | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<ScheduleTemplate | null>(null);
  const [savingTemplateId, setSavingTemplateId] = useState<string | null>(null);
  const [savingPeriods, setSavingPeriods] = useState(false);
  const [periodActionError, setPeriodActionError] = useState<string | null>(null);
  const [isReadingTimetableFile, setIsReadingTimetableFile] = useState(false);
  const [timetableOcrResult, setTimetableOcrResult] = useState<TimetableOcrResult | null>(null);
  const [timetableOcrFileName, setTimetableOcrFileName] = useState('');
  const [timetableOcrNotice, setTimetableOcrNotice] = useState<string | null>(null);
  const [isTermSheetOpen, setIsTermSheetOpen] = useState(false);
  const [isSavingTerm, setIsSavingTerm] = useState(false);
  const [isClearingTermData, setIsClearingTermData] = useState(false);
  const [periodForm, setPeriodForm] = useState<PeriodFormState>(() => createPeriodForm(activeTerm));
  const todayAlternatingWeek = resolveTimetableAlternatingWeek(getTodayIsoDate(), activeTerm);
  const [alternatingWeekView, setAlternatingWeekView] = useState<TimetableAlternatingWeek>(
    todayAlternatingWeek ?? 'a',
  );
  const usesAlternatingWeeks = activeTerm?.usesAlternatingWeeks === true;
  const selectedTermLabel = activeTerm?.label ?? '時間割の期間を設定';
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
  const visibleTermTemplates = useMemo(
    () =>
      termTemplates.filter((template) =>
        templateVisibleInAlternatingWeek(template, usesAlternatingWeeks, alternatingWeekView),
      ),
    [alternatingWeekView, termTemplates, usesAlternatingWeeks],
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

    visibleTermTemplates.forEach((template) => {
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
  }, [displayPeriods, visibleTermTemplates]);
  const availableTerms = useMemo(
    () =>
      timetableTerms
        .slice()
        .sort(
          (left, right) =>
            Number(right.isActive) - Number(left.isActive) ||
            (right.startDate ?? '').localeCompare(left.startDate ?? '') ||
            right.updatedAt.localeCompare(left.updatedAt),
        ),
    [timetableTerms],
  );

  function updateDraft<K extends keyof ScheduleTemplateDraft>(
    key: K,
    value: ScheduleTemplateDraft[K],
  ) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
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
    setDraft(createTemplateDraft(userId, activeTermId, weekday, period, activeTerm));
  }

  function openEditEditor(template: ScheduleTemplate) {
    setEditingTemplate(template);
    setDraft(createTemplateDraftFromTemplate(template));
  }

  function openPeriodSheet(term: TimetableTerm | null = activeTerm) {
    setPeriodForm(createPeriodForm(term));
    setPeriodActionError(null);
    setIsTermSheetOpen(true);
  }

  function startNewPeriod() {
    setPeriodForm(createPeriodForm(null));
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
      (template) => findPeriodNumberForTemplate(template, displayPeriods) === lastPeriod.periodNumber,
    );

    if (lastPeriodHasClass) {
      setPeriodActionError('授業が入っている時限は削除できません。');
      return;
    }

    if (!lastPeriod.id) {
      setSavingPeriods(true);
      try {
        await persistPeriods(displayPeriods.slice(0, -1));
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

  async function applyPeriodForm() {
    const label = periodForm.label.trim();
    const startDate = periodForm.startDate;
    const endDate = periodForm.endDate;

    if (!label || !startDate || !endDate) {
      setPeriodActionError('時間割名・開始日・終了日を入力してください。');
      return;
    }

    if (endDate < startDate) {
      setPeriodActionError('終了日は開始日以降にしてください。');
      return;
    }

    if (periodForm.usesAlternatingWeeks && !periodForm.alternatingWeekAnchorDate) {
      setPeriodActionError('交互週を使う場合はA週の基準日を設定してください。');
      return;
    }

    setIsSavingTerm(true);
    try {
      setPeriodActionError(null);
      await onActivateTerm({
        id: periodForm.id,
        userId,
        year: Number(startDate.slice(0, 4)),
        kind: 'custom',
        label,
        startDate,
        endDate,
        usesAlternatingWeeks: periodForm.usesAlternatingWeeks,
        alternatingWeekAnchorDate: periodForm.usesAlternatingWeeks
          ? periodForm.alternatingWeekAnchorDate
          : null,
        isActive: true,
      });
      setAlternatingWeekView('a');
      setIsTermSheetOpen(false);
    } finally {
      setIsSavingTerm(false);
    }
  }

  async function selectExistingPeriod(term: TimetableTerm) {
    if (term.id === activeTerm?.id) {
      setPeriodForm(createPeriodForm(term));
      return;
    }

    setIsSavingTerm(true);
    try {
      await onActivateTerm({
        id: term.id,
        userId,
        year: term.year,
        kind: term.kind,
        label: term.label,
        startDate: term.startDate,
        endDate: term.endDate,
        usesAlternatingWeeks: term.usesAlternatingWeeks,
        alternatingWeekAnchorDate: term.alternatingWeekAnchorDate,
        isActive: true,
      });
      setAlternatingWeekView(
        resolveTimetableAlternatingWeek(getTodayIsoDate(), term) ?? 'a',
      );
      setIsTermSheetOpen(false);
    } finally {
      setIsSavingTerm(false);
    }
  }

  async function clearCurrentTermData() {
    if (!activeTerm || isClearingTermData || isSavingTerm) {
      return;
    }

    const confirmed = window.confirm(
      `${selectedTermLabel}の授業をすべて削除します。この操作は元に戻せません。よろしいですか？`,
    );

    if (!confirmed) {
      return;
    }

    setIsClearingTermData(true);
    try {
      await onClearTermData(activeTerm);
    } finally {
      setIsClearingTermData(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!draft || !draft.title.trim()) {
      return;
    }

    if (draft.weekInterval === 2 && !draft.weekIntervalAnchorDate) {
      setPeriodActionError('隔週の授業は基準日を設定してください。');
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

  async function handleTimetableImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    setIsReadingTimetableFile(true);
    setTimetableOcrNotice(null);

    try {
      const payload = await createTimetableOcrFilePayload(file);
      const result = await requestTimetableOcr(payload);
      setTimetableOcrFileName(file.name);
      setTimetableOcrResult(result);
    } catch (error) {
      setTimetableOcrNotice(
        error instanceof Error
          ? error.message
          : '読み取りに失敗しました。画像を明るく撮り直してください。',
      );
    } finally {
      setIsReadingTimetableFile(false);
    }
  }

  return (
    <section className="panel timetable-view timetable-period-based-view">
      <div className="section-header timetable-header">
        <div className="timetable-title-block">
          <button
            className="timetable-period-trigger"
            onClick={() => openPeriodSheet()}
            type="button"
          >
            <span>{selectedTermLabel}</span>
            <small>{formatPeriodRange(activeTerm)}</small>
          </button>
        </div>
        <div className="timetable-term-control">
          <input
            ref={importFileInputRef}
            accept={TIMETABLE_IMPORT_FILE_ACCEPT}
            className="timetable-import-file-input"
            onChange={(event) => {
              void handleTimetableImportFileChange(event);
            }}
            type="file"
          />
          <button
            className="ghost-button timetable-ocr-button"
            disabled={isReadingTimetableFile}
            onClick={() => importFileInputRef.current?.click()}
            type="button"
          >
            {isReadingTimetableFile ? '読み取り中...' : '画像/PDF'}
          </button>
          <button
            className="ghost-button timetable-term-switch"
            onClick={() => openPeriodSheet()}
            type="button"
          >
            期間
          </button>
        </div>
      </div>

      {timetableOcrNotice ? (
        <p className="timetable-ocr-notice">{timetableOcrNotice}</p>
      ) : null}

      {usesAlternatingWeeks ? (
        <div className="timetable-alternating-control" aria-label="交互週の表示">
          <span>交互週</span>
          <div className="segmented-control">
            {(['a', 'b'] as TimetableAlternatingWeek[]).map((week) => (
              <button
                className={week === alternatingWeekView ? 'segment active' : 'segment'}
                key={week}
                onClick={() => setAlternatingWeekView(week)}
                type="button"
              >
                {week.toUpperCase()}週
              </button>
            ))}
          </div>
          <small>時間割全体のA週/B週を切り替えます。</small>
        </div>
      ) : null}

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
                <strong aria-label={`${period.label}限`}>{period.label}</strong>
                <label className="timetable-period-time-field">
                  <span className="timetable-period-time-text">
                    {period.startTime ?? '--:--'}
                  </span>
                  <input
                    aria-label={`${period.label}限 開始時刻`}
                    type="time"
                    value={period.startTime ?? ''}
                    disabled={savingPeriods}
                    onChange={(event) => {
                      void updatePeriod(period.periodNumber, 'startTime', event.target.value);
                    }}
                  />
                </label>
                <span className="timetable-period-separator" aria-hidden="true" />
                <label className="timetable-period-time-field">
                  <span className="timetable-period-time-text">
                    {period.endTime ?? '--:--'}
                  </span>
                  <input
                    aria-label={`${period.label}限 終了時刻`}
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
                const primaryTemplate = templates[0];

                return (
                  <button
                    aria-label={
                      primaryTemplate
                        ? `${weekday.label}曜 ${period.label}限 ${primaryTemplate.title}を編集`
                        : `${weekday.label}曜 ${period.label}限 授業を追加`
                    }
                    className={[
                      'timetable-grid-cell',
                      templates.length > 0 ? 'has-class' : '',
                      hasValidPeriodTime(period) ? '' : 'needs-time',
                    ].filter(Boolean).join(' ')}
                    key={cellKey}
                    onClick={() => {
                      if (primaryTemplate) {
                        openEditEditor(primaryTemplate);
                      } else {
                        openCreateEditor(weekday.value, period);
                      }
                    }}
                    type="button"
                  >
                    {templates.length > 0 ? (
                      <span className="timetable-cell-stack">
                        {templates.map((template) => {
                          const patternLabel = getTemplatePatternLabel(template);
                          return (
                            <span className="timetable-class-card" key={template.id}>
                              <strong>{template.title}</strong>
                              <span className="timetable-class-meta">
                                {template.classroom?.trim() || '教室未設定'}
                              </span>
                              {patternLabel ? (
                                <span className="timetable-pattern-badge">{patternLabel}</span>
                              ) : null}
                            </span>
                          );
                        })}
                      </span>
                    ) : (
                      <span className="timetable-empty-cell-label">＋</span>
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
          className="overlay timetable-term-sheet-overlay timetable-period-sheet-overlay"
          onClick={() => {
            if (!isSavingTerm && !isClearingTermData) {
              setIsTermSheetOpen(false);
            }
          }}
        >
          <div
            className="timetable-term-sheet timetable-period-sheet"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="timetable-term-sheet-handle" aria-hidden="true" />
            <div className="section-header timetable-period-sheet-header">
              <div>
                <h2>時間割の期間</h2>
                <p>「前期」などの制度ではなく、実際に使う日付で管理します。</p>
              </div>
              <button
                className="ghost-button"
                disabled={isSavingTerm || isClearingTermData}
                onClick={() => setIsTermSheetOpen(false)}
                type="button"
              >
                閉じる
              </button>
            </div>

            <div className="timetable-term-sheet-body">
              {availableTerms.length > 0 ? (
                <section className="timetable-period-list-section">
                  <div className="timetable-period-list-heading">
                    <span>登録済みの期間</span>
                    <button
                      className="ghost-button"
                      disabled={isSavingTerm || isClearingTermData}
                      onClick={startNewPeriod}
                      type="button"
                    >
                      ＋ 新しい期間
                    </button>
                  </div>
                  <div className="timetable-period-list">
                    {availableTerms.map((term) => (
                      <button
                        className={
                          term.id === activeTerm?.id
                            ? 'timetable-period-list-item active'
                            : 'timetable-period-list-item'
                        }
                        disabled={isSavingTerm || isClearingTermData}
                        key={term.id}
                        onClick={() => {
                          void selectExistingPeriod(term);
                        }}
                        type="button"
                      >
                        <strong>{term.label}</strong>
                        <span>{formatPeriodRange(term)}</span>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="timetable-period-form-card">
                <label className="field">
                  <span>時間割名</span>
                  <input
                    autoComplete="off"
                    placeholder="例：2026年前期"
                    value={periodForm.label}
                    onChange={(event) =>
                      setPeriodForm((current) => ({ ...current, label: event.target.value }))
                    }
                  />
                </label>

                <div className="timetable-period-date-grid">
                  <label className="field">
                    <span>開始日</span>
                    <input
                      type="date"
                      value={periodForm.startDate}
                      onChange={(event) =>
                        setPeriodForm((current) => ({
                          ...current,
                          startDate: event.target.value,
                          alternatingWeekAnchorDate:
                            current.usesAlternatingWeeks && !current.alternatingWeekAnchorDate
                              ? event.target.value
                              : current.alternatingWeekAnchorDate,
                        }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>終了日</span>
                    <input
                      type="date"
                      value={periodForm.endDate}
                      onChange={(event) =>
                        setPeriodForm((current) => ({ ...current, endDate: event.target.value }))
                      }
                    />
                  </label>
                </div>

                <label className="timetable-setting-row">
                  <span>
                    <strong>交互週を使う</strong>
                    <small>A週/B週で時間割全体の内容が変わる場合だけ有効にします。</small>
                  </span>
                  <input
                    checked={periodForm.usesAlternatingWeeks}
                    onChange={(event) =>
                      setPeriodForm((current) => ({
                        ...current,
                        usesAlternatingWeeks: event.target.checked,
                        alternatingWeekAnchorDate: event.target.checked
                          ? current.alternatingWeekAnchorDate || current.startDate
                          : '',
                      }))
                    }
                    type="checkbox"
                  />
                </label>

                {periodForm.usesAlternatingWeeks ? (
                  <label className="field timetable-anchor-field">
                    <span>A週の基準日</span>
                    <input
                      type="date"
                      value={periodForm.alternatingWeekAnchorDate}
                      onChange={(event) =>
                        setPeriodForm((current) => ({
                          ...current,
                          alternatingWeekAnchorDate: event.target.value,
                        }))
                      }
                    />
                    <small>この日を含む週をA週として、その次をB週にします。</small>
                  </label>
                ) : null}
              </section>

              {activeTerm ? (
                <div className="timetable-term-danger-zone">
                  <button
                    className="ghost-button timetable-clear-term-button"
                    disabled={
                      isSavingTerm ||
                      isClearingTermData ||
                      (termTemplates.length === 0 && savedPeriodsForTerm.length === 0)
                    }
                    onClick={() => {
                      void clearCurrentTermData();
                    }}
                    type="button"
                  >
                    {isClearingTermData ? '削除中...' : 'この期間の授業をすべて削除'}
                  </button>
                </div>
              ) : null}
            </div>

            <div className="row-actions timetable-period-sheet-actions">
              <button
                className="ghost-button"
                disabled={isSavingTerm || isClearingTermData}
                onClick={() => setIsTermSheetOpen(false)}
                type="button"
              >
                キャンセル
              </button>
              <button
                className="primary-button"
                disabled={isSavingTerm || isClearingTermData}
                onClick={() => {
                  void applyPeriodForm();
                }}
                type="button"
              >
                {isSavingTerm ? '保存中...' : '保存して使用'}
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
                disabled={
                  savingTemplateId !== null ||
                  !draft.title.trim() ||
                  (draft.weekInterval === 2 && !draft.weekIntervalAnchorDate)
                }
                type="submit"
              >
                {savingTemplateId ? '保存中...' : '保存'}
              </button>
            </div>

            <div className="timetable-editor-body">
              <section className="timetable-editor-card timetable-title-card">
                <label className="field">
                  <span>授業名</span>
                  <input
                    autoComplete="off"
                    value={draft.title}
                    onChange={(event) => updateDraft('title', event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>教科</span>
                  <input
                    autoComplete="off"
                    value={draft.subject}
                    onChange={(event) => updateDraft('subject', event.target.value)}
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
                          {weekday.label}曜
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>時限</span>
                    <select
                      value={draft.periodNumber ?? ''}
                      onChange={(event) => {
                        const periodNumber = Number(event.target.value);
                        const period = displayPeriods.find(
                          (candidate) => candidate.periodNumber === periodNumber,
                        );
                        updateDraft('periodNumber', periodNumber);
                        if (period?.startTime) updateDraft('startTime', period.startTime);
                        if (period?.endTime) updateDraft('endTime', period.endTime);
                      }}
                    >
                      {displayPeriods.map((period) => (
                        <option key={period.periodNumber} value={period.periodNumber}>
                          {period.label}限
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>

              {usesAlternatingWeeks ? (
                <section className="timetable-editor-card">
                  <div className="timetable-card-title timetable-pattern-title">
                    <strong>交互週</strong>
                    <span>時間割全体のA/Bどちらに出る授業か</span>
                  </div>
                  <div className="timetable-pattern-options">
                    {([
                      ['both', 'A/B共通'],
                      ['a', 'A週'],
                      ['b', 'B週'],
                    ] as Array<[ScheduleTemplateAlternatingWeek, string]>).map(([value, label]) => (
                      <button
                        className={
                          (draft.alternatingWeek ?? 'both') === value
                            ? 'segment active'
                            : 'segment'
                        }
                        key={value}
                        onClick={() => updateDraft('alternatingWeek', value)}
                        type="button"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="timetable-editor-card">
                <div className="timetable-card-title timetable-pattern-title">
                  <strong>授業の頻度</strong>
                  <span>隔週はこの授業だけの設定です</span>
                </div>
                <div className="timetable-pattern-options two-options">
                  {([
                    [1, '毎週'],
                    [2, '隔週'],
                  ] as Array<[ScheduleTemplateWeekInterval, string]>).map(([value, label]) => (
                    <button
                      className={(draft.weekInterval ?? 1) === value ? 'segment active' : 'segment'}
                      key={value}
                      onClick={() => {
                        updateDraft('weekInterval', value);
                        if (value === 1) {
                          updateDraft('weekIntervalAnchorDate', null);
                        } else if (!draft.weekIntervalAnchorDate) {
                          updateDraft(
                            'weekIntervalAnchorDate',
                            activeTerm?.startDate ?? getTodayIsoDate(),
                          );
                        }
                      }}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {draft.weekInterval === 2 ? (
                  <label className="field timetable-anchor-field">
                    <span>この授業がある週の基準日</span>
                    <input
                      type="date"
                      value={draft.weekIntervalAnchorDate ?? ''}
                      onChange={(event) =>
                        updateDraft('weekIntervalAnchorDate', event.target.value || null)
                      }
                    />
                    <small>この日を含む週から1週おきに授業があるものとして扱います。</small>
                  </label>
                ) : null}
              </section>

              <section className="timetable-editor-card">
                <div className="timetable-detail-grid">
                  <label className="field">
                    <span>教室</span>
                    <input
                      autoComplete="off"
                      value={draft.classroom ?? ''}
                      onChange={(event) => updateDraft('classroom', event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>メモ</span>
                    <textarea
                      rows={3}
                      value={draft.memo}
                      onChange={(event) => updateDraft('memo', event.target.value)}
                    />
                  </label>
                </div>
              </section>

              {editingTemplate ? (
                <div className="row-actions timetable-editor-actions">
                  <button
                    className="ghost-button danger-button"
                    disabled={savingTemplateId !== null}
                    onClick={() => {
                      void deleteTemplate();
                    }}
                    type="button"
                  >
                    授業を削除
                  </button>
                </div>
              ) : null}
            </div>
          </form>
        </div>
      ) : null}

      {timetableOcrResult ? (
        <Suspense fallback={null}>
          <TimetableOcrImportDialog
            userId={userId}
            termId={activeTermId}
            fileName={timetableOcrFileName}
            result={timetableOcrResult}
            existingPeriods={timetablePeriods}
            existingTemplates={scheduleTemplates}
            onClose={() => {
              setTimetableOcrResult(null);
              setTimetableOcrFileName('');
            }}
            onSaveTimetablePeriod={onSaveTimetablePeriod}
            onSaveScheduleTemplate={onSaveScheduleTemplate}
          />
        </Suspense>
      ) : null}
    </section>
  );
}
