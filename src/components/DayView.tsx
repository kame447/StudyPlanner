import { useEffect, useMemo, useState } from 'react';
import {
  addDays,
  formatDateLabel,
  formatMinutes,
  minutesBetween,
  sortByDateTime,
} from '../lib/date';
import { doesMonthEventOccurOnDate, sortMonthEvents } from '../lib/monthEvents';
import { isStudyTimePlan } from '../lib/studyAnalytics';
import { buildEvaluationSummary } from '../services/evaluationService';
import { ActualEditorCard } from './ActualEditorCard';
import { DayNotebookPanel } from './DayNotebookPanel';
import { DayTimeline } from './DayTimeline';
import { MonthEventDialog } from './MonthEventDialog';
import { ScorePanel } from './ScorePanel';
import type {
  Actual,
  ActualDraft,
  DayNote,
  DayNoteDraft,
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
  dayNote: DayNote | DayNoteDraft;
  onChangeDay: (date: string) => void;
  onEditPlan: (plan: Plan) => void;
  onDeletePlan: (plan: Plan) => Promise<void>;
  onSaveActual: (plan: Plan, draft: ActualDraft) => Promise<void>;
  onDeleteActual: (actual: Actual) => Promise<void>;
  onSaveDayNote: (draft: DayNoteDraft) => Promise<void>;
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
  dayNote,
  onChangeDay,
  onEditPlan,
  onDeletePlan,
  onSaveActual,
  onDeleteActual,
  onSaveDayNote,
  onSaveMonthEvent,
  onDeleteMonthEvent,
}: DayViewProps) {
  const [modalState, setModalState] = useState<DayViewModalState>({ type: 'closed' });
  const dayPlans = useMemo(
    () => sortByDateTime(plans.filter((plan) => plan.date === selectedDate)),
    [plans, selectedDate],
  );
  const dayPlanIds = useMemo(
    () => new Set(dayPlans.map((plan) => plan.id)),
    [dayPlans],
  );
  const studyDayPlans = useMemo(
    () => dayPlans.filter(isStudyTimePlan),
    [dayPlans],
  );
  const studyDayPlanIds = useMemo(
    () => new Set(studyDayPlans.map((plan) => plan.id)),
    [studyDayPlans],
  );
  const dayPlanMap = useMemo(
    () => new Map(dayPlans.map((plan) => [plan.id, plan])),
    [dayPlans],
  );
  const dayActuals = useMemo(
    () => actuals.filter((actual) => dayPlanIds.has(actual.planId)),
    [actuals, dayPlanIds],
  );
  const studyDayActuals = useMemo(
    () => dayActuals.filter((actual) => studyDayPlanIds.has(actual.planId)),
    [dayActuals, studyDayPlanIds],
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
  const actualByPlanId = useMemo(
    () => new Map(dayActuals.map((actual) => [actual.planId, actual])),
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
  const dayPlannedMinutes = useMemo(
    () =>
      studyDayPlans.reduce(
        (sum, plan) => sum + minutesBetween(plan.startTime, plan.endTime),
        0,
      ),
    [studyDayPlans],
  );
  const dayActualMinutes = useMemo(
    () =>
      studyDayPlans.reduce((sum, plan) => {
        const actual = actualByPlanId.get(plan.id);
        return (
          sum +
          (actual ? minutesBetween(actual.actualStartTime, actual.actualEndTime) : 0)
        );
      }, 0),
    [actualByPlanId, studyDayPlans],
  );
  const evaluation = useMemo(
    () => buildEvaluationSummary(selectedDate, plans.filter(isStudyTimePlan), actuals),
    [selectedDate, plans, actuals],
  );
  const planDeltaMinutes = dayActualMinutes - dayPlannedMinutes;
  const displayedScheduleCount = dayPlans.length + dayMonthEvents.length;

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
    <section className="section-stack">
      <div className="panel day-hero-panel">
        <div className="view-header-stack">
          <div>
          <div className="view-titlebar">
            <h2>日ビュー</h2>
            <div className="view-title-actions print-hide">
              <div className="nav-actions view-title-nav">
                <button
                  className="ghost-button"
                  onClick={() => onChangeDay(addDays(selectedDate, -1))}
                  type="button"
                >
                  前日
                </button>
                <button
                  className="ghost-button"
                  onClick={() => onChangeDay(addDays(selectedDate, 1))}
                  type="button"
                >
                  翌日
                </button>
              </div>
              <button
                className="ghost-button view-print-button"
                onClick={() => window.print()}
                type="button"
              >
                印刷
              </button>
            </div>
          </div>
          <p className="print-hide">
            {formatDateLabel(selectedDate)} の予定、実績、振り返りをまとめて見ます。
          </p>
        </div>
      </div>

        <div className="day-summary">
          <div className="summary-chip">
            <span>予定</span>
            <strong>{formatMinutes(dayPlannedMinutes)}</strong>
          </div>
          <div className="summary-chip">
            <span>実績</span>
            <strong>{formatMinutes(dayActualMinutes)}</strong>
          </div>
          <div className="summary-chip">
            <span>達成度</span>
            <strong>{evaluation.achievement}%</strong>
          </div>
          <div className="summary-chip">
            <span>差分</span>
            <strong>
              {planDeltaMinutes === 0
                ? '±0'
                : `${planDeltaMinutes > 0 ? '+' : '-'}${formatMinutes(
                    Math.abs(planDeltaMinutes),
                  )}`}
            </strong>
          </div>
          <div className="summary-chip">
            <span>予定件数</span>
            <strong>{displayedScheduleCount}件</strong>
          </div>
        </div>
      </div>

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
                key={selectedPlan.id}
                plan={selectedPlan}
                actual={actualByPlanId.get(selectedPlan.id)}
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
      />

      <div className="day-review-layout day-review-layout-print-hide">
        <DayNotebookPanel
          dayNote={dayNote}
          plannedMinutes={dayPlannedMinutes}
          actualMinutes={dayActualMinutes}
          actualCount={studyDayActuals.length}
          planCount={studyDayPlans.length}
          evaluation={evaluation}
          onSave={onSaveDayNote}
        />
        <ScorePanel summary={evaluation} />
      </div>
    </section>
  );
}
