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
} from '../types/domain';

interface DayViewProps {
  selectedDate: string;
  userId: string;
  plans: Plan[];
  actuals: Actual[];
  monthEvents: MonthEvent[];
  onChangeDay: (date: string) => void;
  onEditPlan: (plan: Plan) => void;
  onDeletePlan: (plan: Plan) => Promise<void>;
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
  onChangeDay,
  onEditPlan,
  onDeletePlan,
  onSaveActual,
  onDeleteActual,
  onSaveMonthEvent,
  onDeleteMonthEvent,
}: DayViewProps) {
  const [modalState, setModalState] = useState<DayViewModalState>({ type: 'closed' });
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
      />
    </section>
  );
}
