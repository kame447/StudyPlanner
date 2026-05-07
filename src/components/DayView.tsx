import { useEffect, useMemo, useState } from 'react';
import {
  addDays,
  formatDateLabel,
  sortByDateTime,
} from '../lib/date';
import {
  buildPlanOccurrenceKey,
  expandPlansForDate,
  getActualOccurrenceKey,
  getRecurrenceWeekday,
} from '../lib/planRecurrence';
import { doesMonthEventOccurOnDate, sortMonthEvents } from '../lib/monthEvents';
import {
  buildTimetableImportCandidates,
  createPlanDraftFromTimetableImportCandidate,
} from '../lib/timetableImport';
import { useSwipeNavigation } from '../hooks/useSwipeNavigation';
import { ActualEditorCard } from './ActualEditorCard';
import { DayTimeline } from './DayTimeline';
import { StandaloneActualEditorCard } from './StandaloneActualEditorCard';
import type {
  Actual,
  ActualDraft,
  MonthEvent,
  Plan,
  PlanDraft,
  ScheduleTemplate,
} from '../types/domain';

interface DayViewProps {
  selectedDate: string;
  userId: string;
  plans: Plan[];
  actuals: Actual[];
  monthEvents: MonthEvent[];
  scheduleTemplates: ScheduleTemplate[];
  timetableTermId: string;
  onChangeDay: (date: string) => void;
  onEditPlan: (plan: Plan) => void;
  onDeletePlan: (plan: Plan) => Promise<void>;
  onSavePlan: (draft: PlanDraft, targetPlanId?: string) => Promise<void>;
  onSaveActual: (plan: Plan, draft: ActualDraft) => Promise<void>;
  onSaveStandaloneActual: (draft: ActualDraft, targetActualId?: string) => Promise<void>;
  onLinkStandaloneActualToPlan: (actual: Actual, plan: Plan) => Promise<void>;
  onDeleteActual: (actual: Actual) => Promise<void>;
}

type DayViewModalState =
  | { type: 'closed' }
  | { type: 'plan-detail'; planId: string }
  | { type: 'month-event-detail'; monthEventId: string }
  | { type: 'standalone-actual-detail'; actualId: string };

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

export function DayView({
  selectedDate,
  userId,
  plans,
  actuals,
  monthEvents,
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
}: DayViewProps) {
  const [modalState, setModalState] = useState<DayViewModalState>({ type: 'closed' });
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
                actual={selectedDetailActual}
                onEditPlan={onEditPlan}
                onDeletePlan={onDeletePlan}
                onSaveActual={onSaveActual}
                onDeleteActual={onDeleteActual}
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
                plans={dayPlans}
                actuals={dayActuals}
                onSaveStandaloneActual={onSaveStandaloneActual}
                onLinkStandaloneActualToPlan={onLinkStandaloneActualToPlan}
                onDeleteActual={onDeleteActual}
                onClose={closeModal}
              />
            </div>
          </div>
        </div>
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

      <DayTimeline
        dateLabel={dayRangeLabel}
        plans={dayPlans}
        monthEvents={dayMonthEvents}
        actuals={dayActuals}
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
        onPrint={() => window.print()}
        onImportTimetable={openTimetableImport}
        timetableImportCount={timetableImportCandidates.length}
      />
    </section>
  );
}
