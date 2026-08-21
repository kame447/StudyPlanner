import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, NotebookPen, Pencil, Trash2, X } from 'lucide-react';
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

type PlanSheetMode = 'menu' | 'record';

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
  const [planSheetMode, setPlanSheetMode] = useState<PlanSheetMode>('menu');

  useEffect(() => {
    setPlanSheetMode('menu');
  }, [detailPlan?.id, standaloneActual?.id]);

  if (detailPlan) {
    if (planSheetMode === 'menu') {
      return (
        <div className="overlay modal-overlay daily-detail-modal-overlay schedule-action-overlay" onClick={onClose}>
          <section
            className="modal-card daily-detail-modal schedule-action-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={`${detailPlan.title}の操作`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="schedule-action-handle" aria-hidden="true" />
            <div className="schedule-action-topline">
              <button className="schedule-action-close" onClick={onClose} type="button" aria-label="閉じる">
                <X aria-hidden="true" size={22} />
              </button>
              <div>
                <strong>{detailPlan.title}</strong>
                <span>{detailPlan.startTime} - {detailPlan.endTime}</span>
              </div>
            </div>

            <div className="schedule-action-list">
              {!monthEvent ? (
                <button
                  className="schedule-action-item"
                  onClick={() => {
                    onClose();
                    window.requestAnimationFrame(() => onEditPlan(detailPlan));
                  }}
                  type="button"
                >
                  <span className="schedule-action-icon"><Pencil aria-hidden="true" size={24} /></span>
                  <span className="schedule-action-copy">
                    <strong>予定を編集</strong>
                    <small>時間や内容を変更</small>
                  </span>
                  <ChevronRight aria-hidden="true" size={22} />
                </button>
              ) : null}

              <button
                className="schedule-action-item"
                onClick={() => setPlanSheetMode('record')}
                type="button"
              >
                <span className="schedule-action-icon"><NotebookPen aria-hidden="true" size={24} /></span>
                <span className="schedule-action-copy">
                  <strong>{detailActual ? '記録を編集' : '記録を保存'}</strong>
                  <small>実際の内容を保存</small>
                </span>
                <ChevronRight aria-hidden="true" size={22} />
              </button>

              {!monthEvent ? (
                <button
                  className="schedule-action-item danger"
                  onClick={() => {
                    void onDeletePlan(detailPlan).finally(onClose);
                  }}
                  type="button"
                >
                  <span className="schedule-action-icon"><Trash2 aria-hidden="true" size={24} /></span>
                  <span className="schedule-action-copy">
                    <strong>削除</strong>
                    <small>この予定を削除</small>
                  </span>
                  <ChevronRight aria-hidden="true" size={22} />
                </button>
              ) : null}
            </div>
          </section>
        </div>
      );
    }

    return (
      <div className="overlay modal-overlay daily-detail-modal-overlay" onClick={onClose}>
        <div
          className="modal-card daily-detail-modal schedule-record-sheet"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="schedule-action-handle" aria-hidden="true" />
          <div className="daily-detail-modal-header">
            <button className="schedule-action-back" onClick={() => setPlanSheetMode('menu')} type="button" aria-label="戻る">
              <ChevronLeft aria-hidden="true" size={22} />
            </button>
            <div className="daily-detail-modal-heading">
              <h2>{detailActual ? '記録を編集' : '記録を保存'}</h2>
              <p>
                {detailPlan.startTime} - {detailPlan.endTime} / {detailPlan.title}
              </p>
            </div>
            <button className="schedule-action-close" onClick={onClose} type="button" aria-label="閉じる">
              <X aria-hidden="true" size={21} />
            </button>
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
              hidePlanActions
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
        className="modal-card daily-detail-modal schedule-record-sheet"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="schedule-action-handle" aria-hidden="true" />
        <div className="daily-detail-modal-header">
          <span className="schedule-action-header-spacer" />
          <div className="daily-detail-modal-heading">
            <h2>記録を編集</h2>
            <p>
              {standaloneActual.actualStartTime} - {standaloneActual.actualEndTime} /{' '}
              {standaloneActual.title || '記録'}
            </p>
          </div>
          <button className="schedule-action-close" onClick={onClose} type="button" aria-label="閉じる">
            <X aria-hidden="true" size={21} />
          </button>
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
