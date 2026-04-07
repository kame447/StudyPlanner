import { useEffect, useMemo, useState } from 'react';
import {
  addDays,
  formatDateLabel,
  formatMinutes,
  minutesBetween,
  sortByDateTime,
} from '../lib/date';
import { buildEvaluationSummary } from '../services/evaluationService';
import { ActualEditorCard } from './ActualEditorCard';
import { DayNotebookPanel } from './DayNotebookPanel';
import { DayPlanInputPanel } from './DayPlanInputPanel';
import { DayTimeline } from './DayTimeline';
import { ScorePanel } from './ScorePanel';
import type {
  Actual,
  ActualDraft,
  DayNote,
  DayNoteDraft,
  Plan,
  PlanDraft,
} from '../types/domain';

interface DayViewProps {
  selectedDate: string;
  userId: string;
  plans: Plan[];
  actuals: Actual[];
  dayNote: DayNote | DayNoteDraft;
  onChangeDay: (date: string) => void;
  onEditPlan: (plan: Plan) => void;
  onDeletePlan: (plan: Plan) => Promise<void>;
  onSaveActual: (plan: Plan, draft: ActualDraft) => Promise<void>;
  onDeleteActual: (actual: Actual) => Promise<void>;
  onSaveDayNote: (draft: DayNoteDraft) => Promise<void>;
  onApplyDraft: (draft: PlanDraft, targetPlanId?: string) => Promise<void>;
}

type PlanInputMode = 'manual' | 'ai';

type DayViewModalState =
  | { type: 'closed' }
  | { type: 'plan-input'; mode: PlanInputMode }
  | { type: 'plan-detail'; planId: string };

export function DayView({
  selectedDate,
  userId,
  plans,
  actuals,
  dayNote,
  onChangeDay,
  onEditPlan,
  onDeletePlan,
  onSaveActual,
  onDeleteActual,
  onSaveDayNote,
  onApplyDraft,
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
  const dayPlanMap = useMemo(
    () => new Map(dayPlans.map((plan) => [plan.id, plan])),
    [dayPlans],
  );
  const dayActuals = useMemo(
    () => actuals.filter((actual) => dayPlanIds.has(actual.planId)),
    [actuals, dayPlanIds],
  );
  const actualByPlanId = useMemo(
    () => new Map(dayActuals.map((actual) => [actual.planId, actual])),
    [dayActuals],
  );
  const selectedPlan =
    modalState.type === 'plan-detail'
      ? dayPlanMap.get(modalState.planId) ?? null
      : null;
  const dayPlannedMinutes = useMemo(
    () =>
      dayPlans.reduce(
        (sum, plan) => sum + minutesBetween(plan.startTime, plan.endTime),
        0,
      ),
    [dayPlans],
  );
  const dayActualMinutes = useMemo(
    () =>
      dayPlans.reduce((sum, plan) => {
        const actual = actualByPlanId.get(plan.id);
        return (
          sum +
          (actual ? minutesBetween(actual.actualStartTime, actual.actualEndTime) : 0)
        );
      }, 0),
    [actualByPlanId, dayPlans],
  );
  const evaluation = useMemo(
    () => buildEvaluationSummary(selectedDate, plans, actuals),
    [selectedDate, plans, actuals],
  );
  const planDeltaMinutes = dayActualMinutes - dayPlannedMinutes;

  useEffect(() => {
    if (
      modalState.type !== 'plan-detail' ||
      dayPlanMap.has(modalState.planId)
    ) {
      return;
    }

    setModalState({ type: 'closed' });
  }, [dayPlanMap, modalState]);

  useEffect(() => {
    setModalState({ type: 'closed' });
  }, [selectedDate]);

  function openPlanInput(mode: PlanInputMode = 'manual') {
    setModalState({ type: 'plan-input', mode });
  }

  function closeModal() {
    setModalState({ type: 'closed' });
  }

  return (
    <section className="section-stack">
      <div className="panel day-hero-panel">
        <div className="section-header">
          <div>
            <h2>日ビュー</h2>
            <p>{formatDateLabel(selectedDate)} の予定、実績、振り返りをまとめて見ます。</p>
          </div>

          <div className="nav-actions">
            <button
              className="ghost-button"
              onClick={() => onChangeDay(addDays(selectedDate, -1))}
              type="button"
            >
              前日
            </button>
            <button
              className="primary-button"
              onClick={() => openPlanInput('manual')}
              type="button"
            >
              予定を追加
            </button>
            <button
              className="ghost-button"
              onClick={() => onChangeDay(addDays(selectedDate, 1))}
              type="button"
            >
              翌日
            </button>
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
            <strong>{dayPlans.length}件</strong>
          </div>
        </div>
      </div>

      {modalState.type === 'plan-input' ? (
        <div className="overlay modal-overlay" onClick={closeModal}>
          <div
            className="modal-card"
            onClick={(event) => event.stopPropagation()}
          >
            <DayPlanInputPanel
              selectedDate={selectedDate}
              userId={userId}
              plans={plans}
              mode={modalState.mode}
              onModeChange={(mode) => setModalState({ type: 'plan-input', mode })}
              onApplyDraft={onApplyDraft}
              onClose={closeModal}
              embedded
            />
          </div>
        </div>
      ) : null}

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

      <DayTimeline
        plans={dayPlans}
        actuals={dayActuals}
        selectedPlanId={selectedPlan?.id}
        onSelectPlan={(planId) => setModalState({ type: 'plan-detail', planId })}
      />

      <div className="day-review-layout">
        <DayNotebookPanel
          dayNote={dayNote}
          plannedMinutes={dayPlannedMinutes}
          actualMinutes={dayActualMinutes}
          actualCount={dayActuals.length}
          planCount={dayPlans.length}
          evaluation={evaluation}
          onSave={onSaveDayNote}
        />
        <ScorePanel summary={evaluation} />
      </div>
    </section>
  );
}
