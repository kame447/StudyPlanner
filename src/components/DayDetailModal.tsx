import { buildPlanOccurrenceKey } from '../lib/planRecurrence';
import { ActualEditorCard } from './ActualEditorCard';
import { StandaloneActualEditorCard } from './StandaloneActualEditorCard';
import type { Actual, ActualDraft, MonthEvent, Plan } from '../types/domain';

interface DayDetailModalProps {
  detailPlan: Plan | null;
  monthEvent: MonthEvent | null;
  detailActual?: Actual;
  standaloneActual: Actual | null;
  plans: Plan[];
  actuals: Actual[];
  onEditPlan: (plan: Plan) => void;
  onDeletePlan: (plan: Plan) => Promise<void>;
  onSaveActual: (plan: Plan, draft: ActualDraft, targetActualId?: string) => Promise<void>;
  onSaveStandaloneActual: (draft: ActualDraft, targetActualId?: string) => Promise<void>;
  onLinkStandaloneActualToPlan: (actual: Actual, plan: Plan) => Promise<void>;
  onDeleteActual: (actual: Actual) => Promise<void>;
  onClose: () => void;
}

export function DayDetailModal({
  detailPlan,
  monthEvent,
  detailActual,
  standaloneActual,
  plans,
  actuals,
  onEditPlan,
  onDeletePlan,
  onSaveActual,
  onSaveStandaloneActual,
  onLinkStandaloneActualToPlan,
  onDeleteActual,
  onClose,
}: DayDetailModalProps) {
  if (detailPlan) {
    return (
      <div className="overlay modal-overlay daily-detail-modal-overlay" onClick={onClose}>
        <div
          className="modal-card daily-detail-modal"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="daily-detail-modal-header">
            <button className="ghost-button" onClick={onClose} type="button">
              閉じる
            </button>
            <div className="daily-detail-modal-heading">
              <h2>{monthEvent ? '主要予定を記録登録' : '詳細入力'}</h2>
              <p>
                {detailPlan.startTime} - {detailPlan.endTime} / {detailPlan.title}
              </p>
            </div>
          </div>

          <div className="daily-detail-modal-body">
            <ActualEditorCard
              key={buildPlanOccurrenceKey(detailPlan.id, detailPlan.date)}
              plan={detailPlan}
              plans={plans}
              actuals={actuals}
              actual={detailActual}
              onEditPlan={onEditPlan}
              onDeletePlan={onDeletePlan}
              onSaveActual={onSaveActual}
              onDeleteActual={onDeleteActual}
              onClose={onClose}
              forceOpen
              hideToggleButton
              hidePlanActions={Boolean(monthEvent)}
            />
          </div>
        </div>
      </div>
    );
  }

  if (!standaloneActual) {
    return null;
  }

  return (
    <div className="overlay modal-overlay daily-detail-modal-overlay" onClick={onClose}>
      <div
        className="modal-card daily-detail-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="daily-detail-modal-header">
          <button className="ghost-button" onClick={onClose} type="button">
            閉じる
          </button>
          <div className="daily-detail-modal-heading">
            <h2>記録を編集</h2>
            <p>
              {standaloneActual.actualStartTime} - {standaloneActual.actualEndTime} /{' '}
              {standaloneActual.title || '記録'}
            </p>
          </div>
        </div>

        <div className="daily-detail-modal-body">
          <StandaloneActualEditorCard
            key={standaloneActual.id}
            actual={standaloneActual}
            plans={plans}
            actuals={actuals}
            onSaveStandaloneActual={onSaveStandaloneActual}
            onLinkStandaloneActualToPlan={onLinkStandaloneActualToPlan}
            onDeleteActual={onDeleteActual}
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  );
}
