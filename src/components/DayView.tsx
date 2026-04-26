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
import { useSwipeNavigation } from '../hooks/useSwipeNavigation';
import { ActualEditorCard } from './ActualEditorCard';
import { DayTimeline } from './DayTimeline';
import { MonthEventDialog } from './MonthEventDialog';
import type {
  Actual,
  ActualDraft,
  MonthEvent,
  MonthEventDraft,
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
  onDeleteActual: (actual: Actual) => Promise<void>;
  onSaveMonthEvent: (
    draft: MonthEventDraft,
    targetMonthEventId?: string,
  ) => Promise<void>;
  onDeleteMonthEvent: (monthEvent: MonthEvent) => Promise<void>;
}

type DayViewModalState =
  | { type: 'closed' }
  | { type: 'plan-detail'; planId: string }
  | { type: 'month-event-detail'; monthEventId: string };

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
  onDeleteActual,
  onSaveMonthEvent,
  onDeleteMonthEvent,
}: DayViewProps) {
  const [modalState, setModalState] = useState<DayViewModalState>({ type: 'closed' });
  const [isTimetableImportOpen, setIsTimetableImportOpen] = useState(false);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<Set<string>>(
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
  const dayOccurrenceKeys = useMemo(
    () => new Set(dayPlans.map((plan) => buildPlanOccurrenceKey(plan.id, plan.date))),
    [dayPlans],
  );
  const dayPlanMap = useMemo(
    () => new Map(dayPlans.map((plan) => [plan.id, plan])),
    [dayPlans],
  );
  const dayActuals = useMemo(
    () => actuals.filter((actual) => dayOccurrenceKeys.has(getActualOccurrenceKey(actual))),
    [actuals, dayOccurrenceKeys],
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
  const dayMonthEventMap = useMemo(
    () => new Map(dayMonthEvents.map((monthEvent) => [monthEvent.id, monthEvent])),
    [dayMonthEvents],
  );
  const selectedWeekday = getRecurrenceWeekday(selectedDate);
  const dayScheduleTemplates = useMemo(
    () =>
      scheduleTemplates
        .filter(
          (template) =>
            template.weekday === selectedWeekday && template.active !== false,
        )
        .filter(
          (template) => (template.termId || 'default') === timetableTermId,
        )
        .sort((left, right) => {
          const startDelta = left.startTime.localeCompare(right.startTime);

          if (startDelta !== 0) {
            return startDelta;
          }

          return left.endTime.localeCompare(right.endTime);
        }),
    [scheduleTemplates, selectedWeekday, timetableTermId],
  );
  const importedTemplateIds = useMemo(
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
  }, [dayMonthEventMap, dayPlanMap, modalState]);

  useEffect(() => {
    setModalState({ type: 'closed' });
  }, [selectedDate]);

  function closeModal() {
    setModalState({ type: 'closed' });
  }

  function openTimetableImport() {
    setSelectedTemplateIds(
      new Set(
        dayScheduleTemplates
          .filter((template) => !importedTemplateIds.has(template.id))
          .map((template) => template.id),
      ),
    );
    setIsTimetableImportOpen(true);
  }

  function closeTimetableImport() {
    setIsTimetableImportOpen(false);
    setSelectedTemplateIds(new Set());
  }

  function toggleSelectedTemplate(templateId: string) {
    setSelectedTemplateIds((current) => {
      const next = new Set(current);

      if (next.has(templateId)) {
        next.delete(templateId);
      } else {
        next.add(templateId);
      }

      return next;
    });
  }

  function createPlanDraftFromScheduleTemplate(
    template: ScheduleTemplate,
  ): PlanDraft {
    const memoParts = [
      template.classroom ? `教室: ${template.classroom}` : '',
      template.memo.trim(),
    ].filter(Boolean);

    return {
      userId,
      title: template.title,
      subject: template.subject,
      date: selectedDate,
      startTime: template.startTime,
      endTime: template.endTime,
      repeat: 'none',
      repeatUntil: null,
      excludedDates: [],
      recurrenceRules: [],
      type: template.type,
      memo: memoParts.join('\n'),
      sourceType: 'timetable',
      sourceId: template.id,
    };
  }

  async function importSelectedTimetable() {
    const templatesToImport = dayScheduleTemplates.filter(
      (template) =>
        selectedTemplateIds.has(template.id) && !importedTemplateIds.has(template.id),
    );

    if (templatesToImport.length === 0) {
      closeTimetableImport();
      return;
    }

    setIsImportingTimetable(true);
    try {
      for (const template of templatesToImport) {
        await onSavePlan(createPlanDraftFromScheduleTemplate(template));
      }
      closeTimetableImport();
    } finally {
      setIsImportingTimetable(false);
    }
  }

  return (
    <section className="section-stack swipe-view" {...swipeNavigation}>
      {selectedPlan ? (
        <div className="overlay modal-overlay" onClick={closeModal}>
          <div
            className="modal-card"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="section-stack">
              <div className="section-header">
                <div>
                  <h2>詳細入力</h2>
                  <p>
                    {selectedPlan.startTime} - {selectedPlan.endTime} / {selectedPlan.title}
                  </p>
                </div>
                <button
                  className="ghost-button"
                  onClick={closeModal}
                  type="button"
                >
                  閉じる
                </button>
              </div>

              <ActualEditorCard
                key={buildPlanOccurrenceKey(selectedPlan.id, selectedPlan.date)}
                plan={selectedPlan}
                actual={actualByOccurrenceKey.get(
                  buildPlanOccurrenceKey(selectedPlan.id, selectedPlan.date),
                )}
                onEditPlan={onEditPlan}
                onDeletePlan={onDeletePlan}
                onSaveActual={onSaveActual}
                onDeleteActual={onDeleteActual}
                forceOpen
                hideToggleButton
              />
            </div>
          </div>
        </div>
      ) : null}

      {selectedMonthEvent ? (
        <MonthEventDialog
          openDate={selectedDate}
          userId={userId}
          monthEvents={monthEvents}
          initialEventId={selectedMonthEvent.id}
          onSave={onSaveMonthEvent}
          onDelete={onDeleteMonthEvent}
          onClose={closeModal}
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
                {dayScheduleTemplates.length > 0 ? (
                  <div className="timetable-import-list">
                    {dayScheduleTemplates.map((template) => {
                      const isImported = importedTemplateIds.has(template.id);

                      return (
                        <label
                          className="timetable-import-item"
                          key={template.id}
                        >
                          <input
                            type="checkbox"
                            checked={selectedTemplateIds.has(template.id)}
                            disabled={isImported || isImportingTimetable}
                            onChange={() => toggleSelectedTemplate(template.id)}
                          />
                          <span>
                            <strong>{template.title}</strong>
                            <span>
                              {template.startTime}-{template.endTime}
                              {template.subject ? ` / ${template.subject}` : ''}
                              {template.classroom ? ` / ${template.classroom}` : ''}
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
                    isImportingTimetable || selectedTemplateIds.size === 0
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
              : undefined
        }
        onSelectEntry={(entry) =>
          setModalState(
            entry.kind === 'plan'
              ? { type: 'plan-detail', planId: entry.id }
              : { type: 'month-event-detail', monthEventId: entry.id },
          )
        }
        onPreviousDay={() => onChangeDay(addDays(selectedDate, -1))}
        onNextDay={() => onChangeDay(addDays(selectedDate, 1))}
        onPrint={() => window.print()}
        onImportTimetable={openTimetableImport}
        timetableImportCount={dayScheduleTemplates.length}
      />
    </section>
  );
}
