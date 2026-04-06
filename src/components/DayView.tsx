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
import { DayTimeline } from './DayTimeline';
import { NaturalLanguageAssistant } from './NaturalLanguageAssistant';
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
  onAddPlan: () => void;
  onEditPlan: (plan: Plan) => void;
  onDeletePlan: (plan: Plan) => Promise<void>;
  onSaveActual: (plan: Plan, draft: ActualDraft) => Promise<void>;
  onDeleteActual: (actual: Actual) => Promise<void>;
  onSaveDayNote: (draft: DayNoteDraft) => Promise<void>;
  onApplyDraft: (draft: PlanDraft, targetPlanId?: string) => Promise<void>;
}

export function DayView({
  selectedDate,
  userId,
  plans,
  actuals,
  dayNote,
  onChangeDay,
  onAddPlan,
  onEditPlan,
  onDeletePlan,
  onSaveActual,
  onDeleteActual,
  onSaveDayNote,
  onApplyDraft,
}: DayViewProps) {
  const dayPlans = sortByDateTime(plans.filter((plan) => plan.date === selectedDate));
  const dayActuals = actuals.filter((actual) =>
    dayPlans.some((plan) => plan.id === actual.planId),
  );
  const actualByPlanId = new Map(dayActuals.map((actual) => [actual.planId, actual]));
  const dayPlannedMinutes = dayPlans.reduce(
    (sum, plan) => sum + minutesBetween(plan.startTime, plan.endTime),
    0,
  );
  const dayActualMinutes = dayPlans.reduce((sum, plan) => {
    const actual = actualByPlanId.get(plan.id);
    return (
      sum +
      (actual ? minutesBetween(actual.actualStartTime, actual.actualEndTime) : 0)
    );
  }, 0);
  const evaluation = buildEvaluationSummary(selectedDate, plans, actuals);
  const planDeltaMinutes = dayActualMinutes - dayPlannedMinutes;

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
              onClick={onAddPlan}
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

      <DayTimeline plans={dayPlans} actuals={dayActuals} />

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

      <div className="day-layout">
        <section className="panel section-stack">
          <div className="section-header">
            <div>
              <h2>詳細入力</h2>
              <p>実績入力と予定の手直しはここで行います。</p>
            </div>
          </div>

          {dayPlans.length > 0 ? (
            dayPlans.map((plan) => (
              <ActualEditorCard
                key={plan.id}
                plan={plan}
                actual={actualByPlanId.get(plan.id)}
                onEditPlan={onEditPlan}
                onDeletePlan={onDeletePlan}
                onSaveActual={onSaveActual}
                onDeleteActual={onDeleteActual}
              />
            ))
          ) : (
            <p className="empty-copy">
              この日の予定はまだありません。まずは1件追加してください。
            </p>
          )}
        </section>

        <div className="section-stack">
          <NaturalLanguageAssistant
            selectedDate={selectedDate}
            userId={userId}
            plans={plans}
            onApplyDraft={onApplyDraft}
          />
        </div>
      </div>
    </section>
  );
}
