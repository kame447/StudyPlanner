import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Pin } from 'lucide-react';
import { minutesFromTime, timeFromMinutes } from '../lib/date';
import { expandPlansForDate, getRecurrenceWeekday } from '../lib/planRecurrence';
import { buildActualPlanLinkCandidates } from '../lib/actualPlanMatching';
import {
  inferSubjectFromTitle,
  inferSubjectFromTitleWithUserCatalog,
} from '../lib/subjectInference';
import {
  buildActualMaterialProgressUpdatesFromInput,
  getMaterialUnitLabel,
} from '../lib/materialPace';
import { resolveMaterialSubjectName } from '../lib/materialSubject';
import {
  buildQuickEntryPlanDraft,
  isSupportedQuickEntryRepeatKind,
  SUPPORTED_QUICK_ENTRY_REPEAT_KINDS,
  type QuickEntryRepeatKind,
} from '../lib/quickEntryDrafts';
import { PLAN_TYPE_OPTIONS } from '../lib/plans';
import { NaturalLanguageAssistant } from './NaturalLanguageAssistant';
import type {
  Actual,
  ActualDraft,
  Plan,
  PlanDraft,
  PlanType,
  RecurrenceWeekday,
  StudyMaterial,
  StudySubject,
  TodoTaskDraft,
} from '../types/domain';

type QuickEntryMode = 'later' | 'scheduled' | 'repeat';
type QuickEntryInputMethod = 'ai' | 'manual';
type QuickEntryKind = 'plan' | 'actual';
type DurationOptionValue = number | null | 'custom';
type SubjectSource = 'none' | 'title' | 'material' | 'user';
type MaterialSource = 'none' | 'title' | 'user';

interface QuickEntryModalProps {
  userId: string;
  selectedDate: string;
  plans: Plan[];
  actuals: Actual[];
  materials: StudyMaterial[];
  subjects: StudySubject[];
  onClose: () => void;
  onSaveTodo: (draft: TodoTaskDraft) => Promise<void>;
  onSavePlan: (draft: PlanDraft, targetPlanId?: string) => Promise<void>;
  onSaveStandaloneActual: (draft: ActualDraft, targetActualId?: string) => Promise<void>;
  onSaveLinkedActual: (plan: Plan, draft: ActualDraft) => Promise<void>;
}

const MODE_OPTIONS: Array<{ value: QuickEntryMode; label: string }> = [
  { value: 'later', label: 'Todo' },
  { value: 'scheduled', label: '時間指定' },
  { value: 'repeat', label: '繰り返し' },
];

const DURATION_OPTIONS: Array<{ value: DurationOptionValue; label: string }> = [
  { value: null, label: 'なし' },
  { value: 15, label: '15分' },
  { value: 30, label: '30分' },
  { value: 45, label: '45分' },
  { value: 60, label: '60分' },
  { value: 90, label: '90分' },
  { value: 120, label: '120分' },
  { value: 150, label: '150分' },
  { value: 180, label: '180分' },
  { value: 'custom', label: '自由' },
];

const WEEKDAY_OPTIONS: Array<{ value: RecurrenceWeekday; label: string }> = [
  { value: 'mon', label: '月' },
  { value: 'tue', label: '火' },
  { value: 'wed', label: '水' },
  { value: 'thu', label: '木' },
  { value: 'fri', label: '金' },
  { value: 'sat', label: '土' },
  { value: 'sun', label: '日' },
];

function calculateEndTime(startTime: string, durationMinutes: number | null): string | null {
  if (durationMinutes === null || durationMinutes <= 0 || durationMinutes >= 24 * 60) {
    return null;
  }

  const endMinutes = (minutesFromTime(startTime) + durationMinutes) % (24 * 60);

  return timeFromMinutes(endMinutes);
}

export function QuickEntryModal({
  userId,
  selectedDate,
  plans,
  actuals,
  materials,
  subjects,
  onClose,
  onSaveTodo,
  onSavePlan,
  onSaveStandaloneActual,
  onSaveLinkedActual,
}: QuickEntryModalProps) {
  const [entryKind, setEntryKind] = useState<QuickEntryKind>('plan');
  const [inputMethod, setInputMethod] = useState<QuickEntryInputMethod>('manual');
  const [mode, setMode] = useState<QuickEntryMode>('later');
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [subjectSource, setSubjectSource] = useState<SubjectSource>('none');
  const [selectedMaterialId, setSelectedMaterialId] = useState('');
  const [progressMaterialId, setProgressMaterialId] = useState('');
  const [deltaUnitsInput, setDeltaUnitsInput] = useState('');
  const [toUnitInput, setToUnitInput] = useState('');
  const [materialSource, setMaterialSource] = useState<MaterialSource>('none');
  const [type, setType] = useState<PlanType>('study');
  const [estimatedMinutes, setEstimatedMinutes] = useState<number | null>(null);
  const [dueDate, setDueDate] = useState<string>('');
  const [dueTime, setDueTime] = useState<string>('');
  const [todoPinned, setTodoPinned] = useState(false);
  const [isCustomDuration, setIsCustomDuration] = useState(false);
  const [customDurationInput, setCustomDurationInput] = useState('');
  const [memo, setMemo] = useState('');
  const [date, setDate] = useState(selectedDate);
  const [startTime, setStartTime] = useState('19:00');
  const [actualStartTime, setActualStartTime] = useState('19:00');
  const [repeatKind, setRepeatKind] = useState<QuickEntryRepeatKind>('daily');
  const [weekdays, setWeekdays] = useState<RecurrenceWeekday[]>(() => [
    getRecurrenceWeekday(selectedDate),
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSupportedRepeatKind = isSupportedQuickEntryRepeatKind(repeatKind);
  const actualEndTime = calculateEndTime(actualStartTime, estimatedMinutes);
  const dayPlans = useMemo(
    () => expandPlansForDate(plans, selectedDate),
    [plans, selectedDate],
  );
  const availableMaterials = useMemo(
    () =>
      materials.filter(
        (material) =>
          material.userId === userId && material.status !== 'archived',
      ),
    [materials, userId],
  );
  const paceMaterials = useMemo(
    () => availableMaterials.filter((material) => material.paceEnabled === true),
    [availableMaterials],
  );
  const availableSubjects = useMemo(
    () => subjects.filter((subjectItem) => subjectItem.userId === userId),
    [subjects, userId],
  );
  const selectedMaterial =
    availableMaterials.find((material) => material.id === selectedMaterialId) ?? null;
  const selectedProgressMaterial =
    paceMaterials.find((material) => material.id === progressMaterialId) ?? null;
  const selectedMaterialSubject = resolveMaterialSubjectName(
    selectedMaterial,
    availableSubjects,
  );
  const candidateActual =
    actualEndTime && title.trim()
      ? {
          occurrenceDate: selectedDate,
          actualStartTime,
          actualEndTime,
          title: title.trim(),
          subject: resolveSubject(),
        }
      : null;
  const linkCandidates = candidateActual
    ? buildActualPlanLinkCandidates(candidateActual, dayPlans, actuals)
    : [];
  const canSave =
    title.trim().length > 0 &&
    !isSubmitting &&
    (entryKind === 'actual'
      ? estimatedMinutes !== null && actualEndTime !== null
      : inputMethod === 'manual' &&
        (mode === 'later' ||
          (mode === 'scheduled' && estimatedMinutes !== null) ||
          (mode === 'repeat' &&
            estimatedMinutes !== null &&
            isSupportedRepeatKind &&
            (repeatKind !== 'weekly' || weekdays.length > 0))));

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyOverscrollBehavior = document.body.style.overscrollBehavior;

    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'contain';

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.overscrollBehavior = previousBodyOverscrollBehavior;
    };
  }, []);

  function applyDurationOption(value: DurationOptionValue) {
    if (value === 'custom') {
      setIsCustomDuration(true);

      const nextMinutes = Number(customDurationInput);
      setEstimatedMinutes(
        Number.isInteger(nextMinutes) && nextMinutes > 0
          ? nextMinutes
          : null,
      );
      return;
    }

    setIsCustomDuration(false);
    setCustomDurationInput('');
    setEstimatedMinutes(value);
  }

  function updateCustomDuration(value: string) {
    setCustomDurationInput(value);

    const nextMinutes = Number(value);
    setEstimatedMinutes(
      Number.isInteger(nextMinutes) && nextMinutes > 0
        ? nextMinutes
        : null,
    );
  }

  function toggleWeekday(value: RecurrenceWeekday) {
    setWeekdays((current) =>
      current.includes(value)
        ? current.filter((weekday) => weekday !== value)
        : [...current, value],
    );
  }

  function renderDurationCard() {
    return (
      <section className="quick-entry-card quick-entry-duration-card">
        <div className="quick-entry-card-head">
          <h3>所要時間</h3>
        </div>
        <div className="quick-entry-chip-row quick-entry-duration-grid">
          {DURATION_OPTIONS.filter((option) =>
            entryKind === 'actual' ? option.value !== null : true,
          ).map((option) => {
            const isActive =
              option.value === 'custom'
                ? isCustomDuration
                : !isCustomDuration && estimatedMinutes === option.value;

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
      </section>
    );
  }

  function updateTitle(nextTitle: string) {
    setTitle(nextTitle);

    if (materialSource !== 'user') {
      const inference = inferSubjectFromTitleWithUserCatalog(nextTitle, {
        userMaterials: availableMaterials,
        userSubjects: availableSubjects,
      });

      if (inference.source === 'material' && inference.materialId) {
        setSelectedMaterialId(inference.materialId);
        setMaterialSource('title');
        const inferredMaterial =
          availableMaterials.find((item) => item.id === inference.materialId) ?? null;
        setProgressMaterialId(
          inferredMaterial?.paceEnabled === true ? inferredMaterial.id : '',
        );

        const inferredMaterialSubject = resolveMaterialSubjectName(
          inferredMaterial,
          availableSubjects,
        );

        if (subjectSource !== 'user' && inferredMaterialSubject) {
          setSubject(inferredMaterialSubject);
          setSubjectSource('material');
        }
        return;
      }

      const didClearTitleMaterial = materialSource === 'title';

      if (didClearTitleMaterial) {
        setSelectedMaterialId('');
        setProgressMaterialId('');
        setMaterialSource('none');

        if (subjectSource === 'material') {
          setSubject('');
          setSubjectSource('none');
        }
      }

      if (
        subjectSource !== 'user' &&
        (subjectSource !== 'material' || didClearTitleMaterial) &&
        inference.subject
      ) {
        setSubject(inference.subject);
        setSubjectSource('title');
      }
    }
  }

  function updateSubject(nextSubject: string) {
    setSubjectSource('user');
    setSubject(nextSubject);
  }

  function selectMaterial(materialId: string) {
    setSelectedMaterialId(materialId);
    setMaterialSource(materialId ? 'user' : 'none');

    const material =
      availableMaterials.find((item) => item.id === materialId) ?? null;

    if (!material) {
      setProgressMaterialId('');

      if (subjectSource === 'material') {
        const inferredSubject = inferSubjectFromTitle(title);

        setSubject(inferredSubject ?? '');
        setSubjectSource(inferredSubject ? 'title' : 'none');
      }
      return;
    }

    setProgressMaterialId(material.paceEnabled === true ? material.id : '');

    if (subjectSource !== 'user') {
      setSubject(resolveMaterialSubjectName(material, availableSubjects));
      setSubjectSource('material');
    }
  }

  function getSelectedMaterialFields(): {
    materialId: string | null;
    materialName: string;
  } {
    return {
      materialId: selectedMaterial?.id ?? null,
      materialName: selectedMaterial?.name ?? '',
    };
  }

  function resolveSubject(fallbackSubject = ''): string {
    if (subjectSource === 'material' && selectedMaterialSubject) {
      return selectedMaterialSubject;
    }

    return (
      subject.trim() ||
      selectedMaterialSubject ||
      fallbackSubject.trim()
    );
  }

  function buildMaterialProgressUpdates() {
    return buildActualMaterialProgressUpdatesFromInput({
      materials: paceMaterials,
      materialId: progressMaterialId,
      deltaUnitsInput,
      toUnitInput,
    });
  }

  function renderMaterialSelect() {
    if (availableMaterials.length === 0) {
      return null;
    }

    return (
      <label className="field">
        <span>教材</span>
        <select
          value={selectedMaterialId}
          onChange={(event) => selectMaterial(event.target.value)}
        >
          <option value="">教材なし</option>
          {availableMaterials.map((material) => (
            <option key={material.id} value={material.id}>
              {material.name}（{material.subjectName || '科目未設定'}）
            </option>
          ))}
        </select>
      </label>
    );
  }

  function renderMaterialProgressInputs() {
    if (entryKind !== 'actual' || paceMaterials.length === 0) {
      return null;
    }

    return (
      <section className="quick-entry-card">
        <div className="quick-entry-card-head">
          <h3>教材進捗</h3>
        </div>
        <div className="material-quick-progress-grid">
          <label className="field">
            <span>教材</span>
            <select
              value={progressMaterialId}
              onChange={(event) => setProgressMaterialId(event.target.value)}
            >
              <option value="">記録しない</option>
              {paceMaterials.map((material) => (
                <option key={material.id} value={material.id}>
                  {material.name}（{material.subjectName || '科目未設定'}）
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>進めた量</span>
            <input
              min="0"
              step="1"
              type="number"
              value={deltaUnitsInput}
              onChange={(event) => setDeltaUnitsInput(event.target.value)}
              placeholder={
                selectedProgressMaterial
                  ? getMaterialUnitLabel(selectedProgressMaterial)
                  : '例: 5'
              }
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
              placeholder={
                selectedProgressMaterial
                  ? `${selectedProgressMaterial.currentUnit ?? 0}${getMaterialUnitLabel(
                      selectedProgressMaterial,
                    )}`
                  : '例: 30'
              }
            />
          </label>
        </div>
      </section>
    );
  }

  async function handleSaveLinkedActual(plan: Plan) {
    if (!actualEndTime || !title.trim()) {
      return;
    }

    setIsSubmitting(true);
    void onSaveLinkedActual(plan, {
      userId,
      planId: plan.id,
      occurrenceDate: selectedDate,
      actualStartTime,
      actualEndTime,
      title: title.trim(),
      subject: resolveSubject(plan.subject),
      isAlignedToPlan: false,
      note: memo.trim(),
      ...getSelectedMaterialFields(),
      materialProgressUpdates: buildMaterialProgressUpdates(),
    }).catch(() => undefined);
    onClose();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSave) {
      return;
    }

    setIsSubmitting(true);
    if (entryKind === 'actual') {
      if (!actualEndTime) {
        setIsSubmitting(false);
        return;
      }

      void onSaveStandaloneActual({
        userId,
        planId: null,
        occurrenceDate: selectedDate,
        actualStartTime,
        actualEndTime,
        title: title.trim(),
        subject: resolveSubject(),
        isAlignedToPlan: false,
        note: memo.trim(),
        ...getSelectedMaterialFields(),
        materialProgressUpdates: buildMaterialProgressUpdates(),
      }).catch(() => undefined);
    } else if (mode === 'scheduled' || mode === 'repeat') {
      const planDraft = buildQuickEntryPlanDraft({
        mode,
        userId,
        title,
        subject: resolveSubject(),
        type,
        memo,
        date,
        startTime,
        estimatedMinutes,
        repeatKind,
        weekdays,
        ...getSelectedMaterialFields(),
      });

      if (!planDraft) {
        setIsSubmitting(false);
        return;
      }

      void onSavePlan(planDraft).catch(() => undefined);
    } else {
      void onSaveTodo({
        userId,
        title: title.trim(),
        subject: subject.trim(),
        type,
        estimatedMinutes,
        dueDate: dueDate || null,
        dueTime: dueDate ? dueTime || null : null,
        memo: memo.trim(),
        pinned: todoPinned,
      }).catch(() => undefined);
    }

    onClose();
  }

  return (
    <div className="overlay modal-overlay quick-entry-overlay" onClick={onClose}>
      <form
        className="modal-card quick-entry-modal"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="quick-entry-header">
          <button
            className="ghost-button quick-entry-close-button"
            onClick={onClose}
            type="button"
          >
            閉じる
          </button>
          <div className="quick-entry-heading">
            <div
              className={
                entryKind === 'actual'
                  ? 'quick-entry-kind-switch is-actual'
                  : 'quick-entry-kind-switch'
              }
              role="tablist"
              aria-label="入力種別"
            >
              <span className="quick-entry-kind-slider" aria-hidden="true" />
              <button
                className={
                  entryKind === 'plan'
                    ? 'quick-entry-kind-option active'
                    : 'quick-entry-kind-option'
                }
                type="button"
                role="tab"
                aria-selected={entryKind === 'plan'}
                aria-pressed={entryKind === 'plan'}
                onClick={() => setEntryKind('plan')}
              >
                予定
              </button>
              <button
                className={
                  entryKind === 'actual'
                    ? 'quick-entry-kind-option active'
                    : 'quick-entry-kind-option'
                }
                type="button"
                role="tab"
                aria-selected={entryKind === 'actual'}
                aria-pressed={entryKind === 'actual'}
                onClick={() => {
                  setEntryKind('actual');
                  setInputMethod('manual');
                }}
              >
                記録
              </button>
            </div>
            <p>
              {entryKind === 'actual'
                ? 'あとから記録'
                : inputMethod === 'ai'
                ? 'AI入力'
                : MODE_OPTIONS.find((option) => option.value === mode)?.label}
            </p>
          </div>
          <button
            className="primary-button quick-entry-save-button"
            disabled={!canSave}
            type="submit"
          >
            保存
          </button>
        </div>

        <div className="quick-entry-modal-body">
          {entryKind === 'plan' ? (
            <>
          <section className="quick-entry-card quick-entry-switch-card">
            <div className="segmented-control quick-entry-input-method-tabs">
              {(
                [
                  ['manual', '手動入力'],
                  ['ai', 'AI入力'],
                ] as const
              ).map(([value, label]) => (
                <button
                  className={inputMethod === value ? 'segment active' : 'segment'}
                  key={value}
                  onClick={() => setInputMethod(value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          {inputMethod === 'ai' ? (
            <section className="quick-entry-ai-panel">
              <NaturalLanguageAssistant
                selectedDate={selectedDate}
                userId={userId}
                plans={plans}
                materials={availableMaterials}
                subjects={availableSubjects}
                onApplyDraft={onSavePlan}
                embedded
              />
            </section>
          ) : (
            <div className="quick-entry-manual-panel">
              <section className="quick-entry-card quick-entry-title-card">
                <label className="quick-entry-title-field">
                  <span>
                    {MODE_OPTIONS.find((option) => option.value === mode)?.label}
                  </span>
                    <input
                      value={title}
                      onChange={(event) => updateTitle(event.target.value)}
                      placeholder="例: 英語課題 / 面接準備"
                    />
                </label>
              </section>

              <div className="segmented-control quick-entry-mode-tabs">
                {MODE_OPTIONS.map((option) => (
                  <button
                    className={mode === option.value ? 'segment active' : 'segment'}
                    key={option.value}
                    onClick={() => setMode(option.value)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <div className="quick-entry-body">
                <section className="quick-entry-card">
                  <div className="quick-entry-card-head">
                    <h3>分類</h3>
                  </div>
                  <div className="quick-entry-two-column-grid">
                    {mode !== 'later' ? renderMaterialSelect() : null}

                    <label className="field">
                      <span>教科</span>
                      <input
                        value={subject}
                        onChange={(event) => updateSubject(event.target.value)}
                        placeholder="数学"
                      />
                    </label>

                    <label className="field">
                      <span>種別</span>
                      <select
                        value={type}
                        onChange={(event) => setType(event.target.value as PlanType)}
                      >
                        {PLAN_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </section>

                {mode === 'later' ? (
                  <>
                    <section className="quick-entry-card">
                      <div className="quick-entry-card-head">
                        <h3>締切</h3>
                      </div>
                      <div className="quick-entry-two-column-grid quick-entry-deadline-grid">
                        <label className="field">
                          <span>締切日</span>
                          <input
                            type="date"
                            value={dueDate}
                            onChange={(event) => {
                              setDueDate(event.target.value);

                              if (!event.target.value) {
                                setDueTime('');
                              }
                            }}
                          />
                        </label>
                        <label className="field">
                          <span>締切時刻</span>
                          <input
                            type="time"
                            value={dueTime}
                            disabled={!dueDate}
                            onChange={(event) => setDueTime(event.target.value)}
                          />
                        </label>
                        <button
                          className={
                            todoPinned
                              ? 'quick-entry-pin-toggle active'
                              : 'quick-entry-pin-toggle'
                          }
                          type="button"
                          aria-pressed={todoPinned}
                          onClick={() => setTodoPinned((current) => !current)}
                        >
                          <Pin aria-hidden="true" size={18} strokeWidth={1.9} />
                          <span>ピン留め</span>
                        </button>
                      </div>
                    </section>
                    {renderDurationCard()}
                  </>
                ) : null}

                {mode === 'scheduled' ? (
                  <>
                    <section className="quick-entry-card">
                      <div className="quick-entry-card-head">
                        <h3>日付と開始時刻</h3>
                      </div>
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
                          <span>開始時刻</span>
                          <input
                            type="time"
                            value={startTime}
                            onChange={(event) => setStartTime(event.target.value)}
                          />
                        </label>
                      </div>
                    </section>
                    {renderDurationCard()}
                  </>
                ) : null}

                {mode === 'repeat' ? (
                  <>
                    <section className="quick-entry-card">
                      <div className="quick-entry-card-head">
                        <h3>繰り返し</h3>
                      </div>
                      <div className="quick-entry-chip-row">
                        {(
                          [
                            ['daily', '毎日'],
                            ['weekly', '毎週'],
                            ['monthly', '毎月'],
                          ] as const
                        ).map(([value, label]) => (
                          <button
                            className={
                              repeatKind === value
                                ? 'quick-entry-chip active'
                                : 'quick-entry-chip'
                            }
                            key={value}
                            onClick={() => setRepeatKind(value)}
                            type="button"
                            disabled={!SUPPORTED_QUICK_ENTRY_REPEAT_KINDS.has(value)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {repeatKind === 'weekly' ? (
                        <div className="quick-entry-weekdays">
                          <span>曜日</span>
                          <div className="quick-entry-chip-row">
                            {WEEKDAY_OPTIONS.map((option) => (
                              <button
                                className={
                                  weekdays.includes(option.value)
                                    ? 'quick-entry-weekday-chip active'
                                    : 'quick-entry-weekday-chip'
                                }
                                aria-pressed={weekdays.includes(option.value)}
                                key={option.value}
                                onClick={() => toggleWeekday(option.value)}
                                type="button"
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                          {weekdays.length === 0 ? (
                            <p className="inline-note quick-entry-repeat-note">
                              1つ以上選択してください
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </section>

                    <section className="quick-entry-card">
                      <div className="quick-entry-card-head">
                        <h3>開始</h3>
                      </div>
                      <div className="quick-entry-two-column-grid">
                        <label className="field">
                          <span>開始日</span>
                          <input
                            type="date"
                            value={date}
                            onChange={(event) => setDate(event.target.value)}
                          />
                        </label>
                        <label className="field">
                          <span>開始時刻</span>
                          <input
                            type="time"
                            value={startTime}
                            onChange={(event) => setStartTime(event.target.value)}
                          />
                        </label>
                      </div>
                    </section>
                    {renderDurationCard()}
                  </>
                ) : null}

                <section className="quick-entry-card quick-entry-memo-card">
                  <label className="field">
                    <span>メモ</span>
                    <textarea
                      rows={2}
                      value={memo}
                      onChange={(event) => setMemo(event.target.value)}
                      placeholder="メモを追加"
                    />
                  </label>
                </section>
              </div>
            </div>
              )}
            </>
          ) : (
            <div className="quick-entry-manual-panel">
              <section className="quick-entry-card quick-entry-title-card">
                <label className="quick-entry-title-field">
                  <span>タイトル</span>
                    <input
                      value={title}
                      onChange={(event) => updateTitle(event.target.value)}
                      placeholder="例: 英語の復習"
                    />
                </label>
              </section>

              <div className="quick-entry-body">
                <section className="quick-entry-card">
                  <div className="quick-entry-card-head">
                    <h3>時間</h3>
                  </div>
                  <div className="quick-entry-two-column-grid">
                    <label className="field">
                      <span>開始時刻</span>
                      <input
                        type="time"
                        value={actualStartTime}
                        onChange={(event) => setActualStartTime(event.target.value)}
                      />
                    </label>
                  </div>
                  <p className={actualEndTime ? 'inline-note' : 'inline-error'}>
                    {actualEndTime
                      ? `終了時刻: ${actualEndTime}`
                      : estimatedMinutes === null
                        ? '所要時間を選択してください。'
                        : '所要時間は24時間未満にしてください。'}
                  </p>
                </section>
                {renderDurationCard()}

                <section className="quick-entry-card">
                  <div className="quick-entry-card-head">
                    <h3>内容</h3>
                  </div>
                  <div className="quick-entry-two-column-grid">
                    {renderMaterialSelect()}

                    <label className="field">
                      <span>科目</span>
                      <input
                        value={subject}
                        onChange={(event) => updateSubject(event.target.value)}
                        placeholder="英語"
                      />
                    </label>
                    <label className="field">
                      <span>日付</span>
                      <input type="date" value={selectedDate} disabled />
                    </label>
                  </div>
                </section>

                {renderMaterialProgressInputs()}

                {linkCandidates.length > 0 ? (
                  <section className="quick-entry-card standalone-link-section">
                    <div className="quick-entry-card-head">
                      <h3>近い予定候補</h3>
                    </div>
                    <div className="standalone-link-candidates">
                      {linkCandidates.map((candidate, index) => (
                        <article
                          className="standalone-link-candidate"
                          key={candidate.occurrenceKey}
                        >
                          <div>
                            <div className="label-row">
                              <strong>
                                {candidate.plan.startTime}-{candidate.plan.endTime} {candidate.plan.title}
                              </strong>
                              {index === 0 && candidate.score >= 70 ? (
                                <span className="type-badge">おすすめ</span>
                              ) : null}
                              {candidate.isRecorded ? (
                                <span className="type-badge">記録済み</span>
                              ) : null}
                            </div>
                            <p className="comparison-subtitle">
                              {candidate.plan.subject || '科目未設定'}
                              {candidate.reasons.length > 0
                                ? ` / ${candidate.reasons.join('・')}`
                                : ''}
                            </p>
                          </div>
                          <button
                            className="mini-button"
                            disabled={candidate.isRecorded || isSubmitting}
                            onClick={() => void handleSaveLinkedActual(candidate.plan)}
                            type="button"
                          >
                            この予定に紐づけて保存
                          </button>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : candidateActual ? (
                  <p className="inline-note">近い予定はありません。</p>
                ) : null}

                <section className="quick-entry-card quick-entry-memo-card">
                  <label className="field">
                    <span>メモ</span>
                    <textarea
                      rows={2}
                      value={memo}
                      onChange={(event) => setMemo(event.target.value)}
                      placeholder="メモを追加"
                    />
                  </label>
                </section>
              </div>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
