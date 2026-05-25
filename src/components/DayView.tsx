import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { BookOpen } from 'lucide-react';
import {
  addDays,
  formatDateLabel,
  minutesFromTime,
  sortByDateTime,
  timeFromMinutes,
} from '../lib/date';
import {
  buildPlanOccurrenceKey,
  expandPlansForDate,
  getActualOccurrenceKey,
  getRecurrenceWeekday,
} from '../lib/planRecurrence';
import { doesMonthEventOccurOnDate, sortMonthEvents } from '../lib/monthEvents';
import {
  buildActualMaterialProgressUpdatesFromInput,
  getMaterialUnitLabel,
} from '../lib/materialPace';
import { resolveMaterialSubjectName } from '../lib/materialSubject';
import {
  buildTimetableImportCandidates,
  createPlanDraftFromTimetableImportCandidate,
} from '../lib/timetableImport';
import { useSwipeNavigation } from '../hooks/useSwipeNavigation';
import { ActualEditorCard } from './ActualEditorCard';
import { DayCalendarDialog } from './DatePickerDialogs';
import { DayTimeline } from './DayTimeline';
import { StandaloneActualEditorCard } from './StandaloneActualEditorCard';
import type {
  Actual,
  ActualDraft,
  MonthEvent,
  Plan,
  PlanDraft,
  ScheduleTemplate,
  StudyMaterial,
  StudySubject,
} from '../types/domain';

interface DayViewProps {
  selectedDate: string;
  userId: string;
  plans: Plan[];
  actuals: Actual[];
  monthEvents: MonthEvent[];
  studySubjects: StudySubject[];
  studyMaterials: StudyMaterial[];
  scheduleTemplates: ScheduleTemplate[];
  timetableTermId: string;
  onChangeDay: (date: string) => void;
  onEditPlan: (plan: Plan) => void;
  onDeletePlan: (plan: Plan) => Promise<void>;
  onSavePlan: (draft: PlanDraft, targetPlanId?: string) => Promise<void>;
  onSaveActual: (plan: Plan, draft: ActualDraft, targetActualId?: string) => Promise<void>;
  onSaveStandaloneActual: (draft: ActualDraft, targetActualId?: string) => Promise<void>;
  onLinkStandaloneActualToPlan: (actual: Actual, plan: Plan) => Promise<void>;
  onDeleteActual: (actual: Actual) => Promise<void>;
  onOpenBookshelf: () => void;
  onOpenAddMaterial: () => void;
}

type DayViewModalState =
  | { type: 'closed' }
  | { type: 'plan-detail'; planId: string }
  | { type: 'month-event-detail'; monthEventId: string }
  | { type: 'standalone-actual-detail'; actualId: string };

type MaterialQuickCreateKind = 'plan' | 'actual';
type DurationOptionValue = number | 'custom';

const MATERIAL_DURATION_OPTIONS: Array<{ value: DurationOptionValue; label: string }> = [
  { value: 15, label: '15分' },
  { value: 30, label: '30分' },
  { value: 45, label: '45分' },
  { value: 60, label: '60分' },
  { value: 90, label: '90分' },
  { value: 120, label: '120分' },
  { value: 'custom', label: '自由' },
];

const FALLBACK_SUBJECT_COLOR = '#6b7280';

function getSubjectStyle(color: string): CSSProperties {
  return {
    '--subject-color': color,
  } as CSSProperties;
}

function calculateEndTime(startTime: string, durationMinutes: number | null): string | null {
  if (durationMinutes === null || durationMinutes <= 0 || durationMinutes >= 24 * 60) {
    return null;
  }

  return timeFromMinutes((minutesFromTime(startTime) + durationMinutes) % (24 * 60));
}

function MaterialShelfCover({
  material,
  color,
}: {
  material: StudyMaterial;
  color: string;
}) {
  if (material.coverImageDataUrl || material.coverImageUrl) {
    return (
      <img
        className="bookshelf-material-image"
        src={material.coverImageDataUrl || material.coverImageUrl}
        alt={material.name}
      />
    );
  }

  return (
    <div className="bookshelf-material-placeholder" style={getSubjectStyle(color)}>
      <BookOpen aria-hidden="true" size={22} strokeWidth={1.8} />
    </div>
  );
}

function createMonthEventActualPlan(
  monthEvent: MonthEvent,
  userId: string,
  occurrenceDate: string,
): Plan {
  const memoParts = [
    monthEvent.memo.trim(),
    monthEvent.locationTags.length > 0
      ? `場所タグ: ${monthEvent.locationTags.join(', ')}`
      : '',
    monthEvent.url.trim() ? `URL: ${monthEvent.url.trim()}` : '',
  ].filter(Boolean);

  return {
    id: monthEvent.id,
    seriesId: monthEvent.id,
    userId,
    title: monthEvent.title,
    subject: '主要予定',
    date: occurrenceDate,
    startTime: monthEvent.startTime,
    endTime: monthEvent.endTime,
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'other',
    memo: memoParts.join('\n'),
    createdAt: monthEvent.createdAt,
    updatedAt: monthEvent.updatedAt,
    sourceType: 'manual',
    sourceId: monthEvent.id,
    occurrenceDate,
  };
}

function MaterialQuickCreateModal({
  userId,
  selectedDate,
  material,
  subjects,
  onClose,
  onSavePlan,
  onSaveStandaloneActual,
}: {
  userId: string;
  selectedDate: string;
  material: StudyMaterial;
  subjects: StudySubject[];
  onClose: () => void;
  onSavePlan: (draft: PlanDraft, targetPlanId?: string) => Promise<void>;
  onSaveStandaloneActual: (draft: ActualDraft, targetActualId?: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<MaterialQuickCreateKind>('actual');
  const [date, setDate] = useState(selectedDate);
  const [startTime, setStartTime] = useState('19:00');
  const [durationMinutes, setDurationMinutes] = useState<number | null>(30);
  const [customDurationInput, setCustomDurationInput] = useState('');
  const [isCustomDuration, setIsCustomDuration] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [deltaUnitsInput, setDeltaUnitsInput] = useState('');
  const [toUnitInput, setToUnitInput] = useState('');
  const endTime = calculateEndTime(startTime, durationMinutes);
  const canSave = Boolean(endTime) && !isSubmitting;
  const materialUnitLabel = getMaterialUnitLabel(material);
  const materialSubjectName = resolveMaterialSubjectName(material, subjects);

  function applyDurationOption(value: DurationOptionValue) {
    if (value === 'custom') {
      setIsCustomDuration(true);

      const nextMinutes = Number(customDurationInput);
      setDurationMinutes(
        Number.isInteger(nextMinutes) && nextMinutes > 0 ? nextMinutes : null,
      );
      return;
    }

    setIsCustomDuration(false);
    setCustomDurationInput('');
    setDurationMinutes(value);
  }

  function updateCustomDuration(value: string) {
    setCustomDurationInput(value);

    const nextMinutes = Number(value);
    setDurationMinutes(
      Number.isInteger(nextMinutes) && nextMinutes > 0 ? nextMinutes : null,
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!endTime) {
      setError(
        durationMinutes === null
          ? '所要時間を選択してください。'
          : '所要時間は24時間未満にしてください。',
      );
      return;
    }

    setError('');
    setIsSubmitting(true);
    try {
      const baseFields = {
        userId,
        title: material.name,
        subject: materialSubjectName,
        materialId: material.id,
        materialName: material.name,
      };

      if (kind === 'plan') {
        await onSavePlan({
          ...baseFields,
          date,
          startTime,
          endTime,
          repeat: 'none',
          repeatUntil: null,
          excludedDates: [],
          recurrenceRules: [],
          type: 'study',
          memo: '',
          sourceType: 'manual',
          sourceId: null,
        });
      } else {
        const materialProgressUpdates = buildActualMaterialProgressUpdatesFromInput({
          materials: [material],
          materialId: material.id,
          deltaUnitsInput,
          toUnitInput,
        });

        await onSaveStandaloneActual({
          ...baseFields,
          planId: null,
          occurrenceDate: date,
          actualStartTime: startTime,
          actualEndTime: endTime,
          isAlignedToPlan: false,
          note: '',
          materialProgressUpdates,
        });
      }

      onClose();
    } catch {
      setError(kind === 'plan' ? '予定を保存できませんでした。' : '記録を保存できませんでした。');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="overlay modal-overlay" onClick={onClose}>
      <form
        className="modal-card material-quick-modal"
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="section-stack">
          <div className="section-header">
            <div>
              <h2>教材から追加</h2>
            </div>
            <button className="ghost-button" onClick={onClose} type="button">
              閉じる
            </button>
          </div>

          <div
            className={
              kind === 'actual'
                ? 'quick-entry-kind-switch material-quick-kind-switch is-actual'
                : 'quick-entry-kind-switch material-quick-kind-switch'
            }
            role="tablist"
            aria-label="登録種別"
          >
            <span className="quick-entry-kind-slider" aria-hidden="true" />
            <button
              className={
                kind === 'plan'
                  ? 'quick-entry-kind-option active'
                  : 'quick-entry-kind-option'
              }
              type="button"
              role="tab"
              aria-selected={kind === 'plan'}
              aria-pressed={kind === 'plan'}
              onClick={() => setKind('plan')}
            >
              予定
            </button>
            <button
              className={
                kind === 'actual'
                  ? 'quick-entry-kind-option active'
                  : 'quick-entry-kind-option'
              }
              type="button"
              role="tab"
              aria-selected={kind === 'actual'}
              aria-pressed={kind === 'actual'}
              onClick={() => setKind('actual')}
            >
              記録
            </button>
          </div>

          <div className="material-quick-form">
            <div className="quick-entry-two-column-grid">
              <label className="field">
                <span>日付</span>
                <input
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </label>
              <label className="field">
                <span>開始時間</span>
                <input
                  type="time"
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                />
              </label>
            </div>

            <div className="material-quick-duration-grid">
              {MATERIAL_DURATION_OPTIONS.map((option) => {
                const isActive =
                  option.value === 'custom'
                    ? isCustomDuration
                    : !isCustomDuration && durationMinutes === option.value;

                return (
                  <button
                    className={isActive ? 'quick-entry-chip active' : 'quick-entry-chip'}
                    key={option.label}
                    onClick={() => applyDurationOption(option.value)}
                    type="button"
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            {isCustomDuration ? (
              <label className="field quick-entry-custom-duration">
                <span>自由入力（分）</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={customDurationInput}
                  onChange={(event) => updateCustomDuration(event.target.value)}
                  placeholder="75"
                />
              </label>
            ) : null}

            {kind === 'actual' && material.paceEnabled === true ? (
              <div className="material-quick-progress-grid">
                <label className="field">
                  <span>進めた量</span>
                  <input
                    min="0"
                    step="1"
                    type="number"
                    value={deltaUnitsInput}
                    onChange={(event) => setDeltaUnitsInput(event.target.value)}
                    placeholder={`${materialUnitLabel}`}
                  />
                </label>
                <label className="field">
                  <span>到達位置</span>
                  <input
                    min="0"
                    step="1"
                    type="number"
                    value={toUnitInput}
                    onChange={(event) => setToUnitInput(event.target.value)}
                    placeholder={`${material.currentUnit ?? 0}${materialUnitLabel}`}
                  />
                </label>
              </div>
            ) : null}

          </div>

          {error ? <p className="inline-error">{error}</p> : null}

          <div className="row-actions">
            <button className="primary-button" disabled={!canSave} type="submit">
              登録する
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function DailyMaterialShelf({
  userId,
  subjects,
  materials,
  onOpenBookshelf,
  onOpenAddMaterial,
  onSelectMaterial,
}: {
  userId: string;
  subjects: StudySubject[];
  materials: StudyMaterial[];
  onOpenBookshelf: () => void;
  onOpenAddMaterial: () => void;
  onSelectMaterial: (material: StudyMaterial) => void;
}) {
  const activeMaterials = useMemo(
    () =>
      materials.filter(
        (material) => material.userId === userId && material.status !== 'archived',
      ),
    [materials, userId],
  );
  const sections = useMemo(() => {
    const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
    const grouped = new Map<
      string,
      {
        id: string;
        name: string;
        color: string;
        materials: StudyMaterial[];
      }
    >();

    activeMaterials.forEach((material) => {
      const subject = subjectById.get(material.subjectId);
      const section = grouped.get(material.subjectId) ?? {
        id: material.subjectId,
        name: subject?.name || material.subjectName || '未分類',
        color: subject?.color || material.color || FALLBACK_SUBJECT_COLOR,
        materials: [],
      };

      section.materials.push(material);
      grouped.set(material.subjectId, section);
    });

    return Array.from(grouped.values())
      .map((section) => ({
        ...section,
        materials: section.materials.sort(
          (left, right) =>
            left.name.localeCompare(right.name, 'ja') ||
            left.createdAt.localeCompare(right.createdAt),
        ),
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'ja'));
  }, [activeMaterials, subjects]);

  return (
    <section className="panel daily-bookshelf-link-card print-hide">
      <div className="daily-material-head">
        <div>
          <strong>教材から追加</strong>
          <p className="empty-copy">教材を選んで、タイトル入力なしで予定・記録にできます。</p>
        </div>
        <div className="row-actions">
          <button className="ghost-button" onClick={onOpenBookshelf} type="button">
            本棚を開く
          </button>
          {activeMaterials.length === 0 ? (
            <button className="primary-button" onClick={onOpenAddMaterial} type="button">
              教材を追加
            </button>
          ) : null}
        </div>
      </div>

      {sections.length > 0 ? (
        <div className="daily-material-section">
          {sections.map((section) => (
            <div className="daily-material-subject" key={section.id}>
              <h3
                className="daily-material-subject-title"
                style={getSubjectStyle(section.color)}
              >
                {section.name}
              </h3>
              <div className="daily-material-row">
                {section.materials.map((material) => (
                  <button
                    className="bookshelf-material-card daily-material-card"
                    key={material.id}
                    onClick={() => onSelectMaterial(material)}
                    style={getSubjectStyle(material.color || section.color)}
                    type="button"
                  >
                    <MaterialShelfCover
                      material={material}
                      color={material.color || section.color}
                    />
                    <span className="bookshelf-material-title">{material.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-copy">本棚で教材を追加してください。</p>
      )}
    </section>
  );
}

export function DayView({
  selectedDate,
  userId,
  plans,
  actuals,
  monthEvents,
  studySubjects,
  studyMaterials,
  scheduleTemplates,
  timetableTermId,
  onChangeDay,
  onEditPlan,
  onDeletePlan,
  onSavePlan,
  onSaveActual,
  onSaveStandaloneActual,
  onLinkStandaloneActualToPlan,
  onDeleteActual,
  onOpenBookshelf,
  onOpenAddMaterial,
}: DayViewProps) {
  const [modalState, setModalState] = useState<DayViewModalState>({ type: 'closed' });
  const [quickMaterial, setQuickMaterial] = useState<StudyMaterial | null>(null);
  const [isDayCalendarOpen, setIsDayCalendarOpen] = useState(false);
  const [isTimetableImportOpen, setIsTimetableImportOpen] = useState(false);
  const [selectedTimetableSourceIds, setSelectedTimetableSourceIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [isImportingTimetable, setIsImportingTimetable] = useState(false);
  const dayRangeLabel = formatDateLabel(selectedDate);
  const swipeNavigation = useSwipeNavigation({
    onPrevious: () => onChangeDay(addDays(selectedDate, -1)),
    onNext: () => onChangeDay(addDays(selectedDate, 1)),
    disabled: modalState.type !== 'closed',
  });
  const dayPlans = useMemo(
    () => sortByDateTime(expandPlansForDate(plans, selectedDate)),
    [plans, selectedDate],
  );
  const dayMonthEvents = useMemo(
    () =>
      sortMonthEvents(
        monthEvents.filter((monthEvent) =>
          doesMonthEventOccurOnDate(monthEvent, selectedDate),
        ),
      ),
    [monthEvents, selectedDate],
  );
  const dayMonthEventPlans = useMemo(
    () =>
      dayMonthEvents.map((monthEvent) =>
        createMonthEventActualPlan(monthEvent, userId, selectedDate),
      ),
    [dayMonthEvents, selectedDate, userId],
  );
  const dayOccurrenceKeys = useMemo(
    () =>
      new Set(
        [...dayPlans, ...dayMonthEventPlans].map((plan) =>
          buildPlanOccurrenceKey(plan.id, plan.date),
        ),
      ),
    [dayMonthEventPlans, dayPlans],
  );
  const dayPlanMap = useMemo(
    () => new Map(dayPlans.map((plan) => [plan.id, plan])),
    [dayPlans],
  );
  const dayMonthEventPlanMap = useMemo(
    () => new Map(dayMonthEventPlans.map((plan) => [plan.id, plan])),
    [dayMonthEventPlans],
  );
  const dayActuals = useMemo(
    () =>
      actuals.filter(
        (actual) =>
          dayOccurrenceKeys.has(getActualOccurrenceKey(actual)) ||
          (!actual.planId && actual.occurrenceDate === selectedDate),
      ),
    [actuals, dayOccurrenceKeys, selectedDate],
  );
  const dayMonthEventMap = useMemo(
    () => new Map(dayMonthEvents.map((monthEvent) => [monthEvent.id, monthEvent])),
    [dayMonthEvents],
  );
  const selectedWeekday = getRecurrenceWeekday(selectedDate);
  const timetableImportCandidates = useMemo(
    () =>
      buildTimetableImportCandidates({
        templates: scheduleTemplates,
        date: selectedDate,
        weekday: selectedWeekday,
        termId: timetableTermId,
      }),
    [scheduleTemplates, selectedDate, selectedWeekday, timetableTermId],
  );
  const importedTimetableSourceIds = useMemo(
    () =>
      new Set(
        plans
          .filter(
            (plan) =>
              plan.date === selectedDate &&
              plan.sourceType === 'timetable' &&
              typeof plan.sourceId === 'string',
          )
          .map((plan) => plan.sourceId as string),
      ),
    [plans, selectedDate],
  );
  const actualByOccurrenceKey = useMemo(
    () => new Map(dayActuals.map((actual) => [getActualOccurrenceKey(actual), actual])),
    [dayActuals],
  );
  const selectedPlan =
    modalState.type === 'plan-detail'
      ? dayPlanMap.get(modalState.planId) ?? null
      : null;
  const selectedMonthEvent =
    modalState.type === 'month-event-detail'
      ? dayMonthEventMap.get(modalState.monthEventId) ?? null
      : null;
  const selectedMonthEventPlan =
    selectedMonthEvent ? dayMonthEventPlanMap.get(selectedMonthEvent.id) ?? null : null;
  const selectedDetailPlan = selectedPlan ?? selectedMonthEventPlan;
  const selectedDetailActual = selectedDetailPlan
    ? actualByOccurrenceKey.get(buildPlanOccurrenceKey(selectedDetailPlan.id, selectedDetailPlan.date))
    : undefined;
  const selectedStandaloneActual =
    modalState.type === 'standalone-actual-detail'
      ? dayActuals.find(
          (actual) => actual.id === modalState.actualId && !actual.planId,
        ) ?? null
      : null;
  useEffect(() => {
    if (modalState.type === 'plan-detail' && !dayPlanMap.has(modalState.planId)) {
      setModalState({ type: 'closed' });
    }

    if (
      modalState.type === 'month-event-detail' &&
      !dayMonthEventMap.has(modalState.monthEventId)
    ) {
      setModalState({ type: 'closed' });
    }

    if (
      modalState.type === 'standalone-actual-detail' &&
      !dayActuals.some(
        (actual) => actual.id === modalState.actualId && !actual.planId,
      )
    ) {
      setModalState({ type: 'closed' });
    }
  }, [dayActuals, dayMonthEventMap, dayPlanMap, modalState]);

  useEffect(() => {
    setModalState({ type: 'closed' });
    setQuickMaterial(null);
  }, [selectedDate]);

  function closeModal() {
    setModalState({ type: 'closed' });
  }

  function openTimetableImport() {
    setSelectedTimetableSourceIds(
      new Set(
        timetableImportCandidates
          .filter((candidate) => !importedTimetableSourceIds.has(candidate.sourceId))
          .map((candidate) => candidate.sourceId),
      ),
    );
    setIsTimetableImportOpen(true);
  }

  function closeTimetableImport() {
    setIsTimetableImportOpen(false);
    setSelectedTimetableSourceIds(new Set());
  }

  function toggleSelectedTimetableCandidate(sourceId: string) {
    setSelectedTimetableSourceIds((current) => {
      const next = new Set(current);

      if (next.has(sourceId)) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }

      return next;
    });
  }

  async function importSelectedTimetable() {
    const candidatesToImport = timetableImportCandidates.filter(
      (candidate) =>
        selectedTimetableSourceIds.has(candidate.sourceId) &&
        !importedTimetableSourceIds.has(candidate.sourceId),
    );

    if (candidatesToImport.length === 0) {
      closeTimetableImport();
      return;
    }

    setIsImportingTimetable(true);
    try {
      for (const candidate of candidatesToImport) {
        await onSavePlan(
          createPlanDraftFromTimetableImportCandidate(candidate, userId, selectedDate),
        );
      }
      closeTimetableImport();
    } finally {
      setIsImportingTimetable(false);
    }
  }

  return (
    <section className="section-stack swipe-view" {...swipeNavigation}>
      {selectedDetailPlan ? (
        <div className="overlay modal-overlay daily-detail-modal-overlay" onClick={closeModal}>
          <div
            className="modal-card daily-detail-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="daily-detail-modal-header">
              <button
                className="ghost-button"
                onClick={closeModal}
                type="button"
              >
                閉じる
              </button>
              <div className="daily-detail-modal-heading">
                <h2>{selectedMonthEvent ? '主要予定を記録登録' : '詳細入力'}</h2>
                <p>
                  {selectedDetailPlan.startTime} - {selectedDetailPlan.endTime} / {selectedDetailPlan.title}
                </p>
              </div>
            </div>

            <div className="daily-detail-modal-body">
              <ActualEditorCard
                key={buildPlanOccurrenceKey(selectedDetailPlan.id, selectedDetailPlan.date)}
                plan={selectedDetailPlan}
                plans={plans}
                actuals={actuals}
                materials={studyMaterials}
                actual={selectedDetailActual}
                onEditPlan={onEditPlan}
                onDeletePlan={onDeletePlan}
                onSaveActual={onSaveActual}
                onDeleteActual={onDeleteActual}
                onClose={closeModal}
                forceOpen
                hideToggleButton
                hidePlanActions={Boolean(selectedMonthEvent)}
              />
            </div>
          </div>
        </div>
      ) : null}

      {selectedStandaloneActual ? (
        <div className="overlay modal-overlay daily-detail-modal-overlay" onClick={closeModal}>
          <div
            className="modal-card daily-detail-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="daily-detail-modal-header">
              <button
                className="ghost-button"
                onClick={closeModal}
                type="button"
              >
                閉じる
              </button>
              <div className="daily-detail-modal-heading">
                <h2>記録を編集</h2>
                <p>
                  {selectedStandaloneActual.actualStartTime} - {selectedStandaloneActual.actualEndTime} / {selectedStandaloneActual.title || '記録'}
                </p>
              </div>
            </div>

            <div className="daily-detail-modal-body">
              <StandaloneActualEditorCard
                key={selectedStandaloneActual.id}
                actual={selectedStandaloneActual}
                plans={plans}
                actuals={actuals}
                onSaveStandaloneActual={onSaveStandaloneActual}
                onLinkStandaloneActualToPlan={onLinkStandaloneActualToPlan}
                onDeleteActual={onDeleteActual}
                onClose={closeModal}
              />
            </div>
          </div>
        </div>
      ) : null}

      {quickMaterial ? (
        <MaterialQuickCreateModal
          userId={userId}
          selectedDate={selectedDate}
          material={quickMaterial}
          subjects={studySubjects}
          onClose={() => setQuickMaterial(null)}
          onSavePlan={onSavePlan}
          onSaveStandaloneActual={onSaveStandaloneActual}
        />
      ) : null}

      {isTimetableImportOpen ? (
        <div className="overlay modal-overlay" onClick={closeTimetableImport}>
          <div
            className="modal-card timetable-import-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="section-stack">
              <div className="section-header">
                <div>
                  <h2>今日の時間割を反映</h2>
                  <p>{dayRangeLabel}</p>
                </div>
                <button
                  className="ghost-button"
                  onClick={closeTimetableImport}
                  type="button"
                >
                  閉じる
                </button>
              </div>

              <section className="timetable-import-card">
                <h3>反映する授業</h3>
                {timetableImportCandidates.length > 0 ? (
                  <div className="timetable-import-list">
                    {timetableImportCandidates.map((candidate) => {
                      const isImported = importedTimetableSourceIds.has(candidate.sourceId);

                      return (
                        <label
                          className="timetable-import-item"
                          key={candidate.id}
                        >
                          <input
                            type="checkbox"
                            checked={selectedTimetableSourceIds.has(candidate.sourceId)}
                            disabled={isImported || isImportingTimetable}
                            onChange={() => toggleSelectedTimetableCandidate(candidate.sourceId)}
                          />
                          <span>
                            <strong>{candidate.title}</strong>
                            <span>
                              {candidate.startTime}-{candidate.endTime}
                              {candidate.periodLabel ? ` / ${candidate.periodLabel}` : ''}
                              {candidate.subject ? ` / ${candidate.subject}` : ''}
                              {candidate.classroom ? ` / ${candidate.classroom}` : ''}
                              {isImported ? ' / 反映済み' : ''}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <p className="empty-copy">この曜日の時間割はありません。</p>
                )}
              </section>

              <div className="row-actions timetable-import-actions">
                <button
                  className="ghost-button"
                  onClick={closeTimetableImport}
                  type="button"
                >
                  キャンセル
                </button>
                <button
                  className="primary-button"
                  disabled={
                    isImportingTimetable || selectedTimetableSourceIds.size === 0
                  }
                  onClick={() => {
                    void importSelectedTimetable();
                  }}
                  type="button"
                >
                  反映
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <DayCalendarDialog
        open={isDayCalendarOpen}
        selectedDate={selectedDate}
        onSelectDate={onChangeDay}
        onClose={() => setIsDayCalendarOpen(false)}
      />

      <DayTimeline
        dateLabel={dayRangeLabel}
        plans={dayPlans}
        monthEvents={dayMonthEvents}
        actuals={dayActuals}
        studyMaterials={studyMaterials}
        studySubjects={studySubjects}
        selectedEntryId={
          selectedPlan
            ? `plan:${selectedPlan.id}`
            : selectedMonthEvent
              ? `month-event:${selectedMonthEvent.id}`
              : selectedStandaloneActual
                ? `standalone-actual:${selectedStandaloneActual.id}`
                : undefined
        }
        onSelectEntry={(entry) =>
          entry.kind === 'standalone-actual'
            ? setModalState({ type: 'standalone-actual-detail', actualId: entry.id })
            : setModalState(
                entry.kind === 'plan'
                  ? { type: 'plan-detail', planId: entry.id }
                  : { type: 'month-event-detail', monthEventId: entry.id },
              )
        }
        onPreviousDay={() => onChangeDay(addDays(selectedDate, -1))}
        onNextDay={() => onChangeDay(addDays(selectedDate, 1))}
        onOpenDatePicker={() => setIsDayCalendarOpen(true)}
        onPrint={() => window.print()}
        onImportTimetable={openTimetableImport}
        timetableImportCount={timetableImportCandidates.length}
      />

      <DailyMaterialShelf
        userId={userId}
        subjects={studySubjects}
        materials={studyMaterials}
        onOpenBookshelf={onOpenBookshelf}
        onOpenAddMaterial={onOpenAddMaterial}
        onSelectMaterial={setQuickMaterial}
      />
    </section>
  );
}
